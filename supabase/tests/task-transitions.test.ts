import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, SEED } from './helpers';
import type { Sql } from 'postgres';

// Faza 2A: tabela prelaza iz SPEC sekcije 5.
// Pokriveni su svi dozvoljeni prelazi i niz nedozvoljenih, jer je tiho propušten
// prelaz gori od onog koji pukne — zadatak bi završio u stanju koje niko ne očekuje.

const PROPERTY = '00000000-0000-4000-e000-00000000000a';
const madeTasks: string[] = [];

/** RPC poziv kao prijavljeni korisnik; rezultat ostaje u bazi. */
async function callAs<T>(userId: string | null, run: (tx: Sql) => Promise<T>): Promise<T> {
  const connection = await admin.reserve();
  try {
    const claims = userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : '';
    await connection`select set_config('request.jwt.claims', ${claims}, false)`;
    await connection`select set_config('role', ${userId ? 'authenticated' : 'postgres'}, false)`;
    return await run(connection as unknown as Sql);
  } finally {
    await connection`reset role`;
    await connection`select set_config('request.jwt.claims', '', false)`;
    connection.release();
  }
}

// Vreme se računa ovde, a ne kao SQL izraz: izraz poslat kao parametar stiže kao
// običan tekst i Postgres ga ne ume pročitati kao vreme.
function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 3_600_000);
}

async function makeTask(overrides: { status?: string; startsInHours?: number; cleaner?: string } = {}) {
  const start = hoursFromNow(overrides.startsInHours ?? 1);
  const end = new Date(start.getTime() + 5 * 3_600_000);
  const [row] = await admin`
    insert into cleaning_tasks (property_id, owner_id, cleaner_id, status, window_start, window_end, price_rsd)
    values (
      ${PROPERTY}, ${SEED.ownerA}, ${overrides.cleaner ?? null},
      ${overrides.status ?? 'draft'}, ${start}, ${end}, 3500
    )
    returning id`;
  const id = row!.id as string;
  madeTasks.push(id);
  return id;
}

async function statusOf(taskId: string) {
  const [row] = await admin`select status from cleaning_tasks where id = ${taskId}`;
  return row?.status as string;
}

async function setTeam(members: [string, number][]) {
  await admin`delete from preferred_cleaners where owner_id = ${SEED.ownerA}`;
  for (const [cleanerId, priority] of members) {
    await admin`
      insert into preferred_cleaners (owner_id, cleaner_id, priority)
      values (${SEED.ownerA}, ${cleanerId}, ${priority})`;
  }
}

beforeEach(async () => {
  await admin`
    insert into properties (id, owner_id, region_id, name, address, lat, lng, geofence_m)
    values (${PROPERTY}, ${SEED.ownerA}, 1, 'Apartman za prelaze', 'Kopaonik bb', 43.2847, 20.8103, 150)
    on conflict (id) do nothing`;
});

afterAll(async () => {
  await admin`delete from preferred_cleaners where owner_id = ${SEED.ownerA}`;
  // cleaning_tasks drži apartman stranim ključem bez kaskade (SPEC sekcija 3),
  // pa zadaci moraju prvi.
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from properties where id = ${PROPERTY}`;
  await admin.end();
});

describe('ceo put draft → completed (kriterijum završetka 2A)', () => {
  it('prolazi kroz svih sedam statusa samo preko RPC poziva', async () => {
    await setTeam([[SEED.cleaner1, 1]]);
    const task = await makeTask();
    const seen: string[] = ['draft'];

    seen.push(await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task}) as s`).then((r) => r[0]!.s));
    seen.push(await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task}) as s`).then((r) => r[0]!.s));
    seen.push(
      await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null) as s`)
        .then((r) => r[0]!.s),
    );

    // Predaja traži završenu checklistu i bar jednu sliku.
    await admin`
      insert into task_photos (task_id, storage_path, sha256, captured_at, created_by)
      values (${task}, ${task + '/a.jpg'}, 'abc', now(), ${SEED.cleaner1})`;
    seen.push(await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task}) as s`).then((r) => r[0]!.s));
    seen.push(await callAs(SEED.ownerA, (tx) => tx`select mark_ready(${task}) as s`).then((r) => r[0]!.s));
    seen.push(await callAs(SEED.ownerA, (tx) => tx`select complete_task(${task}) as s`).then((r) => r[0]!.s));

    expect(seen).toEqual([
      'draft', 'offered', 'accepted', 'in_progress', 'submitted', 'ready', 'completed',
    ]);

    // Svaki prelaz je ostavio trag (SPEC sekcija 5).
    const trail = await admin`
      select action from audit_log where entity = 'cleaning_tasks' and entity_id = ${task}
      order by created_at`;
    expect(trail.map((row) => row.action)).toEqual([
      'offer_task', 'accept_offer', 'check_in', 'submit_task', 'mark_ready', 'complete_task',
    ]);

    // I vremenske kolone su popunjene.
    const [times] = await admin`
      select accepted_at, arrived_at, submitted_at, ready_at, completed_at
      from cleaning_tasks where id = ${task}`;
    for (const column of ['accepted_at', 'arrived_at', 'submitted_at', 'ready_at', 'completed_at']) {
      expect(times?.[column], column).not.toBeNull();
    }
  }, 30000);
});

describe('dodela: tim pa tržište (SPEC sekcija 6, korak 2)', () => {
  it('draft → offered kada vlasnik ima glavnu spremačicu', async () => {
    await setTeam([[SEED.cleaner1, 1]]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    expect(await statusOf(task)).toBe('offered');

    const [offer] = await admin`select cleaner_id, expires_at from task_offers where task_id = ${task}`;
    expect(offer?.cleaner_id).toBe(SEED.cleaner1);
    expect(offer?.expires_at).not.toBeNull();
  });

  it('draft → open kada tima nema', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    expect(await statusOf(task)).toBe('open');
  });

  it('offered → offered: odbijanje glavne prebacuje na rezervnu', async () => {
    await setTeam([[SEED.cleaner1, 1], [SEED.cleaner2, 2]]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select decline_offer(${task})`);

    expect(await statusOf(task)).toBe('offered');
    const [second] = await admin`
      select cleaner_id from task_offers where task_id = ${task} and status = 'offered'`;
    expect(second?.cleaner_id).toBe(SEED.cleaner2);
  });

  it('offered → open kada nema više rezervnih', async () => {
    await setTeam([[SEED.cleaner1, 1]]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select decline_offer(${task})`);
    expect(await statusOf(task)).toBe('open');
  });

  it('open → accepted samo za verifikovanu spremačicu iz regiona', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);

    // Spremačica 3 nije verifikovana (seed).
    await expect(
      callAs(SEED.cleaner3, (tx) => tx`select accept_offer(${task})`),
    ).rejects.toThrow(/NISTE_VERIFIKOVANI/);

    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    expect(await statusOf(task)).toBe('accepted');
  });

  it('prvi koji prihvati dobija posao, drugi dobija grešku', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);

    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    await expect(
      callAs(SEED.cleaner2, (tx) => tx`select accept_offer(${task})`),
    ).rejects.toThrow(/POGRESAN_STATUS/);
  });
});

describe('odustajanje, otkazivanje i istek', () => {
  it('accepted → open: spremačica odustaje, pouzdanost pada', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);

    const [before] = await admin`select reliability_pct from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    await callAs(SEED.cleaner1, (tx) => tx`select withdraw_task(${task})`);

    expect(await statusOf(task)).toBe('open');
    const [after] = await admin`select reliability_pct from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    expect(Number(after?.reliability_pct)).toBeLessThan(Number(before?.reliability_pct ?? 100));

    const [row] = await admin`select cleaner_id from cleaning_tasks where id = ${task}`;
    expect(row?.cleaner_id).toBeNull();
  });

  it('otkazivanje radi iz sva četiri dozvoljena statusa', async () => {
    for (const status of ['draft', 'offered', 'open', 'accepted'] as const) {
      const task = await makeTask({
        status,
        cleaner: status === 'accepted' ? SEED.cleaner1 : undefined,
      });
      await callAs(SEED.ownerA, (tx) => tx`select cancel_task(${task}, 'Gost je otkazao')`);
      expect(await statusOf(task), status).toBe('cancelled');
    }
  });

  it('open → expired preko posla za cron', async () => {
    const task = await makeTask({ status: 'open', startsInHours: -1 });
    const [result] = await callAs(null, (tx) => tx`select expire_tasks() as n`);
    expect(Number(result!.n)).toBeGreaterThanOrEqual(1);
    expect(await statusOf(task)).toBe('expired');

    // Odluka 10: i istek ostavlja trag.
    const [trail] = await admin`
      select action from audit_log where entity_id = ${task} and action = 'expire_task'`;
    expect(trail?.action).toBe('expire_task');
  });

  it('istek ponude prebacuje zadatak dalje', async () => {
    await setTeam([[SEED.cleaner1, 1], [SEED.cleaner2, 2]]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await admin`update task_offers set expires_at = now() - interval '1 minute' where task_id = ${task}`;

    await callAs(null, (tx) => tx`select expire_offers()`);
    expect(await statusOf(task)).toBe('offered');
    const [next] = await admin`
      select cleaner_id from task_offers where task_id = ${task} and status = 'offered'`;
    expect(next?.cleaner_id).toBe(SEED.cleaner2);
  });
});

describe('rad na terenu', () => {
  async function accepted() {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    return task;
  }

  it('dolazak van kruga traži razlog, sa razlogom prolazi', async () => {
    const task = await accepted();
    // Oko 1,5 km od apartmana.
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2980, 20.8103, null)`),
    ).rejects.toThrow(/VAN_KRUGA/);

    await callAs(SEED.cleaner1, (tx) =>
      tx`select check_in(${task}, 43.2980, 20.8103, 'Parking je zatvoren, ušla sam sa druge strane')`);
    const [row] = await admin`select arrival_distance_m, status from cleaning_tasks where id = ${task}`;
    expect(row?.status).toBe('in_progress');
    expect(Number(row?.arrival_distance_m)).toBeGreaterThan(150);
  });

  it('dolazak unutar kruga ne traži razlog', async () => {
    const task = await accepted();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2848, 20.8104, null)`);
    const [row] = await admin`select arrival_distance_m from cleaning_tasks where id = ${task}`;
    expect(Number(row?.arrival_distance_m)).toBeLessThan(150);
  });

  it('predaja traži završenu checklistu', async () => {
    const task = await accepted();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await admin`
      insert into task_checklist (task_id, label, is_done) values (${task}, 'Kupatilo', false)`;
    await admin`
      insert into task_photos (task_id, storage_path, sha256, captured_at, created_by)
      values (${task}, ${task + '/b.jpg'}, 'def', now(), ${SEED.cleaner1})`;

    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`),
    ).rejects.toThrow(/CHECKLISTA_NEPOTPUNA/);

    await admin`update task_checklist set is_done = true where task_id = ${task}`;
    await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`);
    expect(await statusOf(task)).toBe('submitted');

    // Predaja otvara red za AI proveru (Faza 3A).
    const [inspection] = await admin`select status from ai_inspections where task_id = ${task}`;
    expect(inspection?.status).toBe('queued');
  });

  it('predaja bez ijedne slike se odbija', async () => {
    const task = await accepted();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`),
    ).rejects.toThrow(/NEMA_SLIKA/);
  });

  it('needs_fixes → submitted: ispravka pa ponovna predaja', async () => {
    const task = await accepted();
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await admin`
      insert into task_photos (task_id, storage_path, sha256, captured_at, created_by)
      values (${task}, ${task + '/c.jpg'}, 'ghi', now(), ${SEED.cleaner1})`;
    await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`);

    await callAs(SEED.ownerA, (tx) => tx`select request_fixes(${task}, 'Ogledalo u kupatilu')`);
    expect(await statusOf(task)).toBe('needs_fixes');

    await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`);
    expect(await statusOf(task)).toBe('submitted');
  });
});

describe('zatvaranje i spor', () => {
  async function ready() {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await admin`
      insert into task_photos (task_id, storage_path, sha256, captured_at, created_by)
      values (${task}, ${task + '/d.jpg'}, 'jkl', now(), ${SEED.cleaner1})`;
    await callAs(SEED.cleaner1, (tx) => tx`select submit_task(${task})`);
    await callAs(SEED.ownerA, (tx) => tx`select mark_ready(${task})`);
    return task;
  }

  it('zatvaranje uvećava broj završenih poslova', async () => {
    const task = await ready();
    const [before] = await admin`select completed_jobs from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    await callAs(SEED.ownerA, (tx) => tx`select complete_task(${task})`);
    const [after] = await admin`select completed_jobs from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    expect(Number(after?.completed_jobs)).toBe(Number(before?.completed_jobs) + 1);
  });

  it('automatsko zatvaranje tek posle 12 h (odluka 11)', async () => {
    const task = await ready();
    await callAs(null, (tx) => tx`select auto_complete_tasks()`);
    expect(await statusOf(task)).toBe('ready');

    await admin`update cleaning_tasks set ready_at = now() - interval '13 hours' where id = ${task}`;
    await callAs(null, (tx) => tx`select auto_complete_tasks()`);
    expect(await statusOf(task)).toBe('completed');
  });

  it('spor se otvara u roku od 24 h, posle toga ne', async () => {
    const task = await ready();
    const [dispute] = await callAs(
      SEED.ownerA,
      (tx) => tx`select open_dispute(${task}, 'Kupatilo nije očišćeno') as id`,
    );
    expect(await statusOf(task)).toBe('disputed');

    const late = await ready();
    await admin`update cleaning_tasks set ready_at = now() - interval '25 hours' where id = ${late}`;
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select open_dispute(${late}, 'Kasno')`),
    ).rejects.toThrow(/ROK_ISTEKAO/);

    // Admin rešava u korist spremačice: posao ostaje završen (odluka 12).
    await callAs(SEED.admin, (tx) =>
      tx`select resolve_dispute(${dispute!.id}, 'resolved_cleaner', 'Slike pokazuju uredno kupatilo')`);
    expect(await statusOf(task)).toBe('completed');
  }, 20000);

  it('u korist vlasnika zadatak se poništava', async () => {
    const task = await ready();
    const [dispute] = await callAs(
      SEED.ownerA,
      (tx) => tx`select open_dispute(${task}, 'Nije dolazila') as id`,
    );
    await callAs(SEED.admin, (tx) =>
      tx`select resolve_dispute(${dispute!.id}, 'resolved_owner', 'Nema slika iz objekta')`);
    expect(await statusOf(task)).toBe('cancelled');
  }, 20000);
});

describe('nedozvoljeni prelazi se odbijaju', () => {
  it('prihvatanje zadatka koji je još nacrt', async () => {
    const task = await makeTask();
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`),
    ).rejects.toThrow(/POGRESAN_STATUS/);
  });

  it('dolazak pre prihvatanja', async () => {
    const task = await makeTask({ status: 'open' });
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK|POGRESAN_STATUS/);
  });

  it('dolazak ranije od 2 h pre termina', async () => {
    await setTeam([]);
    const task = await makeTask({ startsInHours: 72 });
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`),
    ).rejects.toThrow(/PRERANO/);
  });

  it('otkazivanje pošto je čišćenje počelo', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select check_in(${task}, 43.2847, 20.8103, null)`);
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select cancel_task(${task}, 'Predomislio sam se')`),
    ).rejects.toThrow(/POGRESAN_STATUS/);
  });

  it('tuđi zadatak ne otkazuje drugi vlasnik', async () => {
    const task = await makeTask();
    await expect(
      callAs(SEED.ownerB, (tx) => tx`select cancel_task(${task}, 'Nije moje')`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('otkazivanje bez razloga', async () => {
    const task = await makeTask();
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select cancel_task(${task}, '   ')`),
    ).rejects.toThrow(/RAZLOG_OBAVEZAN/);
  });

  it('spremačica ne može da označi zadatak spremnim', async () => {
    await setTeam([]);
    const task = await makeTask();
    await callAs(SEED.ownerA, (tx) => tx`select offer_task(${task})`);
    await callAs(SEED.cleaner1, (tx) => tx`select accept_offer(${task})`);
    await expect(
      callAs(SEED.cleaner1, (tx) => tx`select mark_ready(${task})`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('spor ne rešava niko osim administratora', async () => {
    await setTeam([]);
    const task = await makeTask({ status: 'ready', cleaner: SEED.cleaner1 });
    await admin`update cleaning_tasks set ready_at = now() where id = ${task}`;
    const [dispute] = await callAs(
      SEED.ownerA,
      (tx) => tx`select open_dispute(${task}, 'Problem') as id`,
    );
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select resolve_dispute(${dispute!.id}, 'resolved_owner', 'Moja odluka')`),
    ).rejects.toThrow(/SAMO_ADMIN/);
  });

  it('nepostojeći zadatak', async () => {
    await expect(
      callAs(SEED.ownerA, (tx) => tx`select offer_task('00000000-0000-4000-f000-000000000999')`),
    ).rejects.toThrow(/ZADATAK_NE_POSTOJI/);
  });

  it('klijent i dalje ne može direktno da menja status', async () => {
    const task = await makeTask();
    const rows = await callAs(
      SEED.ownerA,
      (tx) => tx`update cleaning_tasks set status = 'completed' where id = ${task} returning id`,
    );
    expect(rows).toHaveLength(0);
    expect(await statusOf(task)).toBe('draft');
  });
});
