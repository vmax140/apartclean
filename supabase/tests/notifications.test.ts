import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, localApi, SEED } from './helpers';
import type { Sql } from 'postgres';

// Faza 2C: dostava obaveštenja (SPEC sekcija 6, koraci 3–4).

let api: string;
let serviceKey: string;

async function callAs<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  const connection = await admin.reserve();
  try {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await connection`select set_config('request.jwt.claims', ${claims}, false)`;
    await connection`select set_config('role', 'authenticated', false)`;
    return await run(connection as unknown as Sql);
  } finally {
    await connection`reset role`;
    await connection`select set_config('request.jwt.claims', '', false)`;
    connection.release();
  }
}

beforeAll(() => {
  const status = localApi();
  api = status.API_URL;
  serviceKey = status.SERVICE_ROLE_KEY;
});

afterAll(async () => {
  await admin`delete from push_devices where expo_push_token like 'test-%'`;
  await admin.end();
});

describe('prijava uređaja za push', () => {
  it('upisuje token i pamti platformu', async () => {
    await callAs(SEED.cleaner1, (tx) =>
      tx`select register_push_device('test-token-1', 'android')`);
    const [row] = await admin`
      select user_id, platform from push_devices where expo_push_token = 'test-token-1'`;
    expect(row?.user_id).toBe(SEED.cleaner1);
    expect(row?.platform).toBe('android');
  });

  it('isti telefon kod drugog korisnika menja vlasnika tokena', async () => {
    // Spremačica se odjavi, druga se prijavi na istom telefonu.
    await callAs(SEED.cleaner2, (tx) =>
      tx`select register_push_device('test-token-1', 'android')`);
    const rows = await admin`
      select user_id from push_devices where expo_push_token = 'test-token-1'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(SEED.cleaner2);
  });

  it('odbija nepoznatu platformu', async () => {
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select register_push_device('test-token-2', 'symbian')`),
    ).rejects.toThrow(/NEISPRAVAN_URED/);
  });

  it('korisnik vidi samo svoje uređaje', async () => {
    await callAs(SEED.cleaner1, (tx) => tx`select register_push_device('test-token-3', 'ios')`);
    const mine = await asUser(SEED.cleaner1, (tx) => tx`select expo_push_token from push_devices`);
    expect(mine.map((row) => row.expo_push_token)).toContain('test-token-3');

    const theirs = await asUser(SEED.ownerA, (tx) => tx`select expo_push_token from push_devices`);
    expect(theirs.map((row) => row.expo_push_token)).not.toContain('test-token-3');
  });

  it('uređaji koji se nisu javili tri meseca se brišu', async () => {
    await admin`
      insert into push_devices (user_id, expo_push_token, platform, last_seen_at)
      values (${SEED.cleaner1}, 'test-stari', 'android', now() - interval '100 days')`;
    const [result] = await admin`select purge_stale_devices() as n`;
    expect(Number(result!.n)).toBeGreaterThanOrEqual(1);
    const left = await admin`select 1 from push_devices where expo_push_token = 'test-stari'`;
    expect(left).toHaveLength(0);
  });
});

describe('okidač za dostavu', () => {
  it('neuspelo slanje ne obara upis obaveštenja', async () => {
    // Lokalno nema vault tajni, pa poziv Edge Function-a puca — a red mora da ostane.
    await admin`select notify(${SEED.ownerA}, 'test_type', 'Naslov', 'Telo')`;
    const [row] = await admin`
      select id from notifications where user_id = ${SEED.ownerA} and type = 'test_type'
      order by created_at desc limit 1`;
    expect(row?.id).toBeTruthy();

    const [trail] = await admin`
      select action from audit_log where action = 'notification_dispatch_failed'
      order by created_at desc limit 1`;
    expect(trail?.action).toBe('notification_dispatch_failed');

    await admin`delete from notifications where type = 'test_type'`;
  });

  it('korisnik čita i označava samo svoja obaveštenja', async () => {
    await admin`select notify(${SEED.cleaner1}, 'test_read', 'Za spremačicu', 'Telo')`;
    const [row] = await admin`
      select id from notifications where type = 'test_read' order by created_at desc limit 1`;

    const theirs = await asUser(
      SEED.ownerB,
      (tx) => tx`select id from notifications where id = ${row!.id}`,
    );
    expect(theirs).toHaveLength(0);

    const updated = await asUser(
      SEED.cleaner1,
      (tx) => tx`update notifications set read_at = now() where id = ${row!.id} returning id`,
    );
    expect(updated).toHaveLength(1);

    await admin`delete from notifications where type = 'test_read'`;
  });
});

describe('send-notification', () => {
  function send(body: object, key: string) {
    return fetch(api + '/functions/v1/send-notification', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('traži service ključ', async () => {
    expect((await send({ notificationId: SEED.ownerA }, 'nije-kljuc')).status).toBe(401);
  }, 20000);

  it('bez prijavljenog uređaja javlja no_devices i ne puca', async () => {
    await admin`delete from push_devices where user_id = ${SEED.ownerB}`;
    await admin`select notify(${SEED.ownerB}, 'test_send', 'Naslov', 'Telo')`;
    const [row] = await admin`
      select id from notifications where type = 'test_send' order by created_at desc limit 1`;

    const response = await send({ notificationId: row!.id }, serviceKey);
    const payload = (await response.json()) as { delivery: { push: unknown; email: unknown } };
    expect(response.ok, JSON.stringify(payload)).toBe(true);
    expect(payload.delivery.push).toBe('no_devices');
    // Mejl se ne šalje za vrstu koja nije na spisku važnih.
    expect(payload.delivery.email).toBe('not_needed');

    // Ishod dostave je zapisan uz samo obaveštenje.
    const [saved] = await admin`select data from notifications where id = ${row!.id}`;
    expect((saved?.data as { delivery?: unknown })?.delivery).toBeTruthy();

    await admin`delete from notifications where type = 'test_send'`;
  }, 30000);

  it('token koji nije Expo oblika se preskače', async () => {
    await admin`
      insert into push_devices (user_id, expo_push_token, platform)
      values (${SEED.ownerB}, 'test-nije-expo-token', 'android')`;
    await admin`select notify(${SEED.ownerB}, 'test_skip', 'Naslov', 'Telo')`;
    const [row] = await admin`
      select id from notifications where type = 'test_skip' order by created_at desc limit 1`;

    const response = await send({ notificationId: row!.id }, serviceKey);
    const payload = (await response.json()) as { delivery: { push: unknown } };
    expect(payload.delivery.push).toBe('no_devices');

    await admin`delete from notifications where type = 'test_skip'`;
    await admin`delete from push_devices where expo_push_token = 'test-nije-expo-token'`;
  }, 30000);
});

describe('ponude vidi samo onaj kome su upućene', () => {
  it('spremačica ne vidi tuđu ponudu', async () => {
    const [property] = await admin`
      insert into properties (owner_id, region_id, name, address, lat, lng)
      values (${SEED.ownerA}, 1, 'Apartman za ponude', 'Kopaonik bb', 43.28, 20.81)
      returning id`;
    const [task] = await admin`
      insert into cleaning_tasks (property_id, owner_id, status, window_start, window_end)
      values (${property!.id}, ${SEED.ownerA}, 'offered', now() + interval '2 hours',
              now() + interval '6 hours')
      returning id`;
    await admin`
      insert into task_offers (task_id, cleaner_id, status, expires_at)
      values (${task!.id}, ${SEED.cleaner1}, 'offered', now() + interval '2 hours')`;

    const mine = await asUser(SEED.cleaner1, (tx) => tx`select id from task_offers`);
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await asUser(
      SEED.cleaner2,
      (tx) => tx`select id from task_offers where task_id = ${task!.id}`,
    );
    expect(theirs).toHaveLength(0);

    await admin`delete from cleaning_tasks where id = ${task!.id}`;
    await admin`delete from properties where id = ${property!.id}`;
  });
});
