import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, asUser, SEED } from './helpers';
import type { Sql } from 'postgres';

// Faza 2E: zatvaranje, ocene i poruke (SPEC sekcija 6, koraci 10–11).

const PROPERTY = '00000000-0000-4000-e000-000000000030';

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

async function completedTask(status = 'completed') {
  const [row] = await admin`
    insert into cleaning_tasks
      (property_id, owner_id, cleaner_id, status, window_start, window_end, completed_at)
    values (${PROPERTY}, ${SEED.ownerA}, ${SEED.cleaner1}, ${status},
            now() - interval '1 day', now() - interval '20 hours',
            ${status === 'completed' ? new Date() : null})
    returning id`;
  return row!.id as string;
}

beforeEach(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`
    insert into properties (id, owner_id, region_id, name, address, lat, lng)
    values (${PROPERTY}, ${SEED.ownerA}, 1, 'Apartman za zatvaranje', 'Kopaonik bb', 43.28, 20.81)
    on conflict (id) do nothing`;
  await admin`update profiles set rating_avg = null, rating_count = 0 where id = ${SEED.cleaner1}`;
});

afterAll(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from property_reports where property_id = ${PROPERTY}`;
  await admin`delete from properties where id = ${PROPERTY}`;
  await admin.end();
});

describe('ocene su dvostruko slepe (SPEC sekcija 6, korak 10)', () => {
  it('dok druga strana ne oceni, svako vidi samo svoju', async () => {
    const task = await completedTask();
    await callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 5, 5, 4, 5, 'Sjajno')`);

    const ownerSees = await asUser(
      SEED.ownerA,
      (tx) => tx`select id, published_at from reviews where task_id = ${task}`,
    );
    expect(ownerSees).toHaveLength(1);
    expect(ownerSees[0]?.published_at).toBeNull();

    // Spremačica još nije ocenila i ne sme da vidi ocenu o sebi.
    const cleanerSees = await asUser(
      SEED.cleaner1,
      (tx) => tx`select id from reviews where task_id = ${task}`,
    );
    expect(cleanerSees).toHaveLength(0);
  });

  it('kada obe strane ocene, ocene se objave i prosek se izračuna', async () => {
    const task = await completedTask();
    await callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 4, null, null, null, 'Uredno')`);
    await callAs(SEED.cleaner1, (tx) => tx`select submit_review(${task}, 5, null, null, null, 'Lep apartman')`);

    const published = await admin`
      select published_at from reviews where task_id = ${task}`;
    expect(published).toHaveLength(2);
    expect(published.every((row) => row.published_at !== null)).toBe(true);

    // Sada obe strane vide obe ocene.
    const cleanerSees = await asUser(
      SEED.cleaner1,
      (tx) => tx`select id from reviews where task_id = ${task}`,
    );
    expect(cleanerSees).toHaveLength(2);

    const [profile] = await admin`
      select rating_avg, rating_count from profiles where id = ${SEED.cleaner1}`;
    expect(Number(profile?.rating_avg)).toBe(4);
    expect(Number(profile?.rating_count)).toBe(1);
  });

  it('isti učesnik ne može da oceni dvaput', async () => {
    const task = await completedTask();
    await callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 5)`);
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 1)`),
    ).rejects.toThrow(/VEC_OCENJENO/);
  });

  it('smer se izvodi iz toga ko ocenjuje, ne iz onoga što klijent pošalje', async () => {
    const task = await completedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select submit_review(${task}, 5)`);
    const [review] = await admin`select direction, reviewee_id from reviews where task_id = ${task}`;
    expect(review?.direction).toBe('cleaner_to_owner');
    expect(review?.reviewee_id).toBe(SEED.ownerA);
  });

  it('nezavršen posao se ne ocenjuje', async () => {
    const task = await completedTask('ready');
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 5)`),
    ).rejects.toThrow(/POGRESAN_STATUS/);
  });

  it('ocenu daje samo učesnik', async () => {
    const task = await completedTask();
    await expect(
      callAs(SEED.ownerB, (tx) => tx`select submit_review(${task}, 1)`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('ocena van opsega se odbija', async () => {
    const task = await completedTask();
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select submit_review(${task}, 6)`),
    ).rejects.toThrow(/OCENA_NEISPRAVNA/);
  });
});

describe('oznaka plaćanja (SPEC sekcija 1: bez online naplate)', () => {
  it('vlasnik označava plaćeno i spremačica dobija obaveštenje', async () => {
    const task = await completedTask();
    const [result] = await callAs(
      SEED.ownerA,
      (tx) => tx`select mark_task_paid(${task}, true) as s`,
    );
    expect(result!.s).toBe('paid_offline');

    const [message] = await admin`
      select type from notifications where user_id = ${SEED.cleaner1} and type = 'task_paid'
      order by created_at desc limit 1`;
    expect(message?.type).toBe('task_paid');
  });

  it('oznaka se može poništiti', async () => {
    const task = await completedTask();
    await callAs(SEED.ownerA, (tx) => tx`select mark_task_paid(${task}, true)`);
    const [result] = await callAs(
      SEED.ownerA,
      (tx) => tx`select mark_task_paid(${task}, false) as s`,
    );
    expect(result!.s).toBe('unpaid');
  });

  it('tuđi posao ne označava drugi vlasnik', async () => {
    const task = await completedTask();
    await expect(
      callAs(SEED.ownerB, (tx) => tx`select mark_task_paid(${task}, true)`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });
});

describe('poruke po zadatku', () => {
  it('vide ih i pišu samo učesnici', async () => {
    const task = await completedTask();

    await callAs(SEED.ownerA, (tx) =>
      tx`insert into messages (task_id, sender_id, body) values (${task}, ${SEED.ownerA}, 'Hvala!')`);

    const participants = await asUser(
      SEED.cleaner1,
      (tx) => tx`select body from messages where task_id = ${task}`,
    );
    expect(participants.map((row) => row.body)).toEqual(['Hvala!']);

    const outsider = await asUser(
      SEED.ownerB,
      (tx) => tx`select body from messages where task_id = ${task}`,
    );
    expect(outsider).toHaveLength(0);

    const written = await asUser(
      SEED.ownerB,
      (tx) =>
        tx`insert into messages (task_id, sender_id, body) values (${task}, ${SEED.ownerB}, 'Upad') returning id`,
    ).catch(() => []);
    expect(written).toHaveLength(0);
  });

  it('poruke su u Realtime publikaciji', async () => {
    const [row] = await admin`
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'messages'`;
    expect(row?.tablename).toBe('messages');
  });
});

describe('prijave štete kod vlasnika', () => {
  it('vlasnik menja status, drugi ne', async () => {
    const task = await completedTask();
    await callAs(SEED.cleaner1, (tx) =>
      tx`select report_property_issue(${task}, 'maintenance', 'Slavina curi')`);
    const [report] = await admin`select id, status from property_reports where task_id = ${task}`;
    expect(report?.status).toBe('open');

    await callAs(SEED.ownerA, (tx) => tx`select set_report_status(${report!.id}, 'acknowledged')`);
    const [after] = await admin`select status from property_reports where id = ${report!.id}`;
    expect(after?.status).toBe('acknowledged');

    await expect(
      callAs(SEED.ownerB, (tx) => tx`select set_report_status(${report!.id}, 'resolved')`),
    ).rejects.toThrow(/NIJE_VAS_APARTMAN/);
  });

  it('nepoznat status se odbija', async () => {
    const task = await completedTask();
    await callAs(SEED.cleaner1, (tx) =>
      tx`select report_property_issue(${task}, 'damage', 'Ogledalo')`);
    const [report] = await admin`select id from property_reports where task_id = ${task}`;
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select set_report_status(${report!.id}, 'izmisljeno')`),
    ).rejects.toThrow(/NEPOZNAT_STATUS/);
  });
});

describe('zaštićena polja profila', () => {
  it('korisnik ne može sam sebi da podigne ocenu ni status', async () => {
    // Zaštita je prešla sa trigera na prava nad kolonama: proveravaju se pre
    // RLS-a, pa upit pada na nivou dozvola, a ne na nivou reda.
    for (const column of ['rating_avg = 5', 'rating_count = 99', "status = 'active'"]) {
      await expect(
        asUser(SEED.cleaner1, (tx) =>
          tx.unsafe(`update profiles set ${column} where id = '${SEED.cleaner1}'`)),
        column,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('ime i telefon korisnik i dalje menja', async () => {
    const rows = await asUser(
      SEED.cleaner1,
      (tx) => tx`update profiles set full_name = 'Ana S.' where id = ${SEED.cleaner1} returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('potvrdu telefona upisuje samo administrator', async () => {
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select set_phone_verified(${SEED.cleaner1}, true)`),
    ).rejects.toThrow(/SAMO_ADMIN/);

    await callAs(SEED.admin, (tx) => tx`select set_phone_verified(${SEED.cleaner1}, true)`);
    const [row] = await admin`select phone_verified_at from profiles where id = ${SEED.cleaner1}`;
    expect(row?.phone_verified_at).not.toBeNull();
    await admin`update profiles set phone_verified_at = null where id = ${SEED.cleaner1}`;
  });
});
