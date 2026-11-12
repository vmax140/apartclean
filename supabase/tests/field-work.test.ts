import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, SEED } from './helpers';
import type { Sql } from 'postgres';

// Faza 2D: checklista zadatka, stroža predaja i prijava štete.
//
// Checklista je rupa iz Faze 2A: nijedna funkcija je nije popunjavala, pa je
// provera u submit_task prolazila prazna.

const PROPERTY = '00000000-0000-4000-e000-000000000020';
const ROOMS = {
  bedroom: '00000000-0000-4000-e000-000000000021',
  bath1: '00000000-0000-4000-e000-000000000022',
  bath2: '00000000-0000-4000-e000-000000000023',
};

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

async function makeAcceptedTask(startsInHours = 1) {
  const start = new Date(Date.now() + startsInHours * 3_600_000);
  const [row] = await admin`
    insert into cleaning_tasks (property_id, owner_id, cleaner_id, status, window_start, window_end)
    values (${PROPERTY}, ${SEED.ownerA}, ${SEED.cleaner1}, 'accepted', ${start},
            ${new Date(start.getTime() + 5 * 3_600_000)})
    returning id`;
  return row!.id as string;
}

beforeEach(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`
    insert into properties (id, owner_id, region_id, name, address, lat, lng, geofence_m)
    values (${PROPERTY}, ${SEED.ownerA}, 1, 'Apartman sa dva kupatila', 'Kopaonik bb',
            43.2847, 20.8103, 150)
    on conflict (id) do nothing`;
  await admin`
    insert into property_rooms (id, property_id, type, name, sort_order)
    values
      (${ROOMS.bedroom}, ${PROPERTY}, 'bedroom', 'Spavaća soba', 0),
      (${ROOMS.bath1}, ${PROPERTY}, 'bathroom', 'Kupatilo 1', 1),
      (${ROOMS.bath2}, ${PROPERTY}, 'bathroom', 'Kupatilo 2', 2)
    on conflict (id) do nothing`;
});

afterAll(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from property_rooms where property_id = ${PROPERTY}`;
  await admin`delete from properties where id = ${PROPERTY}`;
  await admin.end();
});

describe('checklista zadatka', () => {
  it('dolazak prepisuje checklistu iz šablona', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);

    const rows = await admin`select room_id, label from task_checklist where task_id = ${task}`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('soba koja se ponavlja dobija svoju listu', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);

    const [first] = await admin`
      select count(*)::int as n from task_checklist where task_id = ${task} and room_id = ${ROOMS.bath1}`;
    const [second] = await admin`
      select count(*)::int as n from task_checklist where task_id = ${task} and room_id = ${ROOMS.bath2}`;
    // Apartman sa dva kupatila dobija obe liste, a ne jednu.
    expect(first!.n).toBeGreaterThan(0);
    expect(first!.n).toBe(second!.n);
  });

  it('opšte stavke nemaju sobu', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    const [general] = await admin`
      select count(*)::int as n from task_checklist where task_id = ${task} and room_id is null`;
    expect(general!.n).toBeGreaterThan(0);
  });

  it('ponovni poziv ne udvostručava stavke', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    const [before] = await admin`select count(*)::int as n from task_checklist where task_id = ${task}`;

    await admin`select materialize_checklist(${task})`;
    const [after] = await admin`select count(*)::int as n from task_checklist where task_id = ${task}`;
    expect(after!.n).toBe(before!.n);
  });
});

describe('predaja traži i slike, ne samo štiklirane stavke', () => {
  it('stavka koja traži sliku bez slike zaustavlja predaju', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await admin`update task_checklist set is_done = true where task_id = ${task}`;
    // Jedna slika postoji, ali ne za sobu koja je traži.
    await admin`
      insert into task_photos (task_id, storage_path, sha256, captured_at, created_by)
      values (${task}, ${task + '/x.jpg'}, 'x', now(), ${SEED.cleaner1})`;

    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`),
    ).rejects.toThrow(/FALE_SLIKE/);
  });

  it('kada svaka tražena soba ima sliku, predaja prolazi', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await admin`update task_checklist set is_done = true where task_id = ${task}`;

    const rooms = await admin`
      select distinct room_id from task_checklist
      where task_id = ${task} and requires_photo and room_id is not null`;
    for (const row of rooms) {
      await admin`
        insert into task_photos (task_id, room_id, storage_path, sha256, captured_at, created_by)
        values (${task}, ${row.room_id}, ${task + '/' + row.room_id + '.jpg'}, 'h', now(), ${SEED.cleaner1})`;
    }
    const general = await admin`
      select id from task_checklist where task_id = ${task} and requires_photo and room_id is null`;
    for (const row of general) {
      await admin`
        insert into task_photos (task_id, checklist_row_id, storage_path, sha256, captured_at, created_by)
        values (${task}, ${row.id}, ${task + '/' + row.id + '.jpg'}, 'h', now(), ${SEED.cleaner1})`;
    }

    await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`);
    const [after] = await admin`select status from cleaning_tasks where id = ${task}`;
    expect(after?.status).toBe('submitted');
  });
});

describe('prijava štete (SPEC sekcija 6, korak 6)', () => {
  it('vlasnik dobija obaveštenje odmah', async () => {
    const task = await makeAcceptedTask();
    await callAs(SEED.cleaner1, (tx) =>
      tx`select report_property_issue(${task}, 'damage', 'Napuklo ogledalo u kupatilu')`);

    const [report] = await admin`
      select category, description, reported_by from property_reports where task_id = ${task}`;
    expect(report?.category).toBe('damage');
    expect(report?.reported_by).toBe(SEED.cleaner1);

    const [message] = await admin`
      select title, body from notifications
      where user_id = ${SEED.ownerA} and type = 'property_report'
      order by created_at desc limit 1`;
    expect(String(message?.body)).toContain('ogledalo');
  });

  it('prijava bez opisa se odbija', async () => {
    const task = await makeAcceptedTask();
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select report_property_issue(${task}, 'damage', '  ')`),
    ).rejects.toThrow(/OPIS_OBAVEZAN/);
  });

  it('prijavu podnosi samo učesnik zadatka', async () => {
    const task = await makeAcceptedTask();
    await expect(
      callAs(SEED.cleaner2, (tx) =>
        tx`select report_property_issue(${task}, 'damage', 'Nisam na ovom zadatku')`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });
});

describe('pristupni podaci za spremačicu', () => {
  beforeEach(async () => {
    await admin`
      insert into property_access (property_id, key_instructions, lockbox_code_encrypted, wifi_name)
      values (${PROPERTY}, 'Sef levo od ulaza', 'sifrovano:AAA', 'Mreza')
      on conflict (property_id) do update set key_instructions = excluded.key_instructions`;
  });

  it('dodeljena spremačica ih dobija', async () => {
    const task = await makeAcceptedTask();
    const rows = await admin`select * from get_access_info_for(${task}, ${SEED.cleaner1})`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key_instructions).toBe('Sef levo od ulaza');
    // Šifra i dalje izlazi šifrovana; dešifruje je Edge Function.
    expect(rows[0]?.lockbox_code_encrypted).toBe('sifrovano:AAA');
  });

  it('druga spremačica ih ne dobija', async () => {
    const task = await makeAcceptedTask();
    await expect(
      admin`select * from get_access_info_for(${task}, ${SEED.cleaner2})`,
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('van vremenskog okvira ih ne dobija ni dodeljena', async () => {
    const task = await makeAcceptedTask(72);
    await expect(
      admin`select * from get_access_info_for(${task}, ${SEED.cleaner1})`,
    ).rejects.toThrow(/VAN_VREMENSKOG_OKVIRA/);
  });

  it('svako gledanje ostavlja trag', async () => {
    const task = await makeAcceptedTask();
    await admin`select * from get_access_info_for(${task}, ${SEED.cleaner1})`;
    const [trail] = await admin`
      select actor_id from audit_log
      where entity_id = ${task} and action = 'get_access_info' order by created_at desc limit 1`;
    expect(trail?.actor_id).toBe(SEED.cleaner1);
  });
});
