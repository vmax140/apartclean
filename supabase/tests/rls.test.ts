import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asAnon, asUser, SEED } from './helpers';

// Testovi iz SPEC sekcije 10 (kriterijum za Fazu 1A), plus provera da nijedna
// tabela nije ostala bez RLS — pravilo iz CLAUDE.md.

const PROPERTY_A = '00000000-0000-4000-c000-00000000000a';
const PROPERTY_B = '00000000-0000-4000-c000-00000000000b';
const TASK_ASSIGNED = '00000000-0000-4000-d000-000000000001';

beforeAll(async () => {
  await cleanupFixtures();

  await admin`
    insert into properties (id, owner_id, region_id, name, address, complex_name, lat, lng)
    values
      (${PROPERTY_A}, ${SEED.ownerA}, 1, 'Apartman Suncana dolina', 'Kopaonik bb', 'Suncana dolina', 43.2847, 20.8103),
      (${PROPERTY_B}, ${SEED.ownerB}, 1, 'Apartman Vidikovac', 'Kopaonik bb 2', 'Vidikovac', 43.2850, 20.8110)
  `;

  await admin`
    insert into property_access (property_id, key_instructions, lockbox_code_encrypted, wifi_name, wifi_password_encrypted)
    values (${PROPERTY_A}, 'Sef levo od ulaza', 'sifrovano:AAAA', 'SuncanaDolina', 'sifrovano:BBBB')
  `;

  // Zadatak dodeljen spremačici 1, u statusu accepted i unutar vremenskog okvira.
  await admin`
    insert into cleaning_tasks (id, property_id, owner_id, cleaner_id, status, window_start, window_end, accepted_at)
    values (
      ${TASK_ASSIGNED}, ${PROPERTY_A}, ${SEED.ownerA}, ${SEED.cleaner1}, 'accepted',
      now() - interval '30 minutes', now() + interval '3 hours', now()
    )
  `;
});

afterAll(async () => {
  await cleanupFixtures();
  await admin.end();
});

async function cleanupFixtures() {
  await admin`delete from cleaning_tasks where id = ${TASK_ASSIGNED}`;
  await admin`delete from properties where id in (${PROPERTY_A}, ${PROPERTY_B})`;
}

describe('apartmani su odvojeni po vlasniku (SPEC sekcija 4)', () => {
  it('neaktivan nalog čita svoj profil, ali ne i apartman', async () => {
    await admin`update profiles set status = 'suspended' where id = ${SEED.ownerA}`;
    try {
      const result = await asUser(SEED.ownerA, async (tx) => ({
        profiles: await tx`select id from profiles where id = ${SEED.ownerA}`,
        properties: await tx`select id from properties where id = ${PROPERTY_A}`,
      }));
      expect(result.profiles).toHaveLength(1);
      expect(result.properties).toHaveLength(0);
    } finally {
      await admin`update profiles set status = 'active' where id = ${SEED.ownerA}`;
    }
  });

  it('vlasnik vidi svoj apartman', async () => {
    const rows = await asUser(
      SEED.ownerA,
      (tx) => tx`select id from properties where id = ${PROPERTY_A}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('vlasnik B ne vidi apartman vlasnika A', async () => {
    const rows = await asUser(
      SEED.ownerB,
      (tx) => tx`select id from properties where id = ${PROPERTY_A}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('vlasnik B ne može da izmeni apartman vlasnika A', async () => {
    const rows = await asUser(
      SEED.ownerB,
      (tx) => tx`update properties set name = 'preuzeto' where id = ${PROPERTY_A} returning id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('administrator vidi oba apartmana', async () => {
    const rows = await asUser(
      SEED.admin,
      (tx) => tx`select id from properties where id in (${PROPERTY_A}, ${PROPERTY_B})`,
    );
    expect(rows).toHaveLength(2);
  });

  it('neprijavljeni posetilac ne vidi nijedan apartman', async () => {
    const rows = await asAnon((tx) => tx`select id from properties`);
    expect(rows).toHaveLength(0);
  });
});

describe('pristupni podaci se daju samo dodeljenom spremaču (SPEC sekcija 4)', () => {
  it('property_access se ne čita direktno ni za koga', async () => {
    for (const user of [SEED.ownerA, SEED.cleaner1, SEED.admin]) {
      const rows = await asUser(user, (tx) => tx`select property_id from property_access`);
      expect(rows, `korisnik ${user}`).toHaveLength(0);
    }
  });

  it('dodeljeni spremač dobija podatke kroz get_access_info', async () => {
    const rows = await asUser(
      SEED.cleaner1,
      (tx) => tx`select * from get_access_info(${TASK_ASSIGNED})`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key_instructions).toBe('Sef levo od ulaza');
    expect(rows[0]?.lockbox_code_encrypted).toBe('sifrovano:AAAA');
  });

  it('spremač bez zadatka ne dobija pristupne podatke', async () => {
    await expect(
      asUser(SEED.cleaner3, (tx) => tx`select * from get_access_info(${TASK_ASSIGNED})`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('ni vlasnik ne prolazi kroz get_access_info — funkcija je za spremača', async () => {
    await expect(
      asUser(SEED.ownerA, (tx) => tx`select * from get_access_info(${TASK_ASSIGNED})`),
    ).rejects.toThrow(/NIJE_VAS_ZADATAK/);
  });

  it('van vremenskog okvira se podaci ne vide', async () => {
    const FUTURE_TASK = '00000000-0000-4000-d000-000000000002';
    await admin`
      insert into cleaning_tasks (id, property_id, owner_id, cleaner_id, status, window_start, window_end)
      values (${FUTURE_TASK}, ${PROPERTY_A}, ${SEED.ownerA}, ${SEED.cleaner1}, 'accepted',
              now() + interval '5 days', now() + interval '5 days 4 hours')
    `;
    try {
      await expect(
        asUser(SEED.cleaner1, (tx) => tx`select * from get_access_info(${FUTURE_TASK})`),
      ).rejects.toThrow(/VAN_VREMENSKOG_OKVIRA/);
    } finally {
      await admin`delete from cleaning_tasks where id = ${FUTURE_TASK}`;
    }
  });
});

describe('evidencija prihvatanja uslova je nepromenljiva (SPEC sekcije 4 i 9)', () => {
  let acceptanceId: number;

  beforeAll(async () => {
    const [doc] =
      await admin`select id from legal_documents where kind = 'terms' and is_active limit 1`;
    // Namerno `do nothing`, ne `do update`: UPDATE bi pokrenuo trigger nepromenljivosti,
    // pa bi test pucao pri drugom pokretanju bez db:reset.
    await admin`
      insert into legal_acceptances (user_id, document_id, ip_address, user_agent, app_version)
      values (${SEED.ownerA}, ${doc!.id}, '127.0.0.1', 'vitest', '0.0.0')
      on conflict (user_id, document_id) do nothing
    `;
    const [row] = await admin`
      select id from legal_acceptances
      where user_id = ${SEED.ownerA} and document_id = ${doc!.id}
    `;
    acceptanceId = Number(row!.id);
  });

  it('korisnik čita samo svoje prihvatanje', async () => {
    const mine = await asUser(SEED.ownerA, (tx) => tx`select id from legal_acceptances`);
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await asUser(SEED.ownerB, (tx) => tx`select id from legal_acceptances`);
    expect(theirs).toHaveLength(0);
  });

  it('korisnik ne može da izmeni svoje prihvatanje', async () => {
    await expect(
      asUser(
        SEED.ownerA,
        (tx) => tx`update legal_acceptances set app_version = '9.9.9' where id = ${acceptanceId}`,
      ),
    ).rejects.toThrow();
  });

  it('ni administrator ne može da izmeni prihvatanje', async () => {
    await expect(
      asUser(
        SEED.admin,
        (tx) => tx`update legal_acceptances set app_version = '9.9.9' where id = ${acceptanceId}`,
      ),
    ).rejects.toThrow();
  });

  it('ni veza koja zaobilazi RLS ne može da obriše prihvatanje', async () => {
    // Trigger je jači od politika: važi i za service role i za postgres.
    await expect(admin`delete from legal_acceptances where id = ${acceptanceId}`).rejects.toThrow(
      /EVIDENCIJA_NEPROMENLJIVA/,
    );
  });
});

describe('uloge se ne dodeljuju iz klijenta (docs/DECISIONS.md, odluka 3)', () => {
  it('korisnik ne može sam da upiše ulogu', async () => {
    const rows = await asUser(
      SEED.ownerA,
      (tx) =>
        tx`insert into user_roles (user_id, role) values (${SEED.ownerA}, 'admin') returning role`,
    ).catch(() => []);
    expect(rows).toHaveLength(0);
  });

  it('set_initial_roles odbija admin ulogu', async () => {
    await expect(
      asUser(SEED.ownerA, (tx) => tx`select set_initial_roles(array['admin']::app_role[])`),
    ).rejects.toThrow(/ULOGA_NIJE_DOZVOLJENA/);
  });

  it('set_initial_roles odbija korisnika koji već ima ulogu', async () => {
    await expect(
      asUser(SEED.ownerA, (tx) => tx`select set_initial_roles(array['cleaner']::app_role[])`),
    ).rejects.toThrow(/ULOGE_VEC_POSTAVLJENE/);
  });

  it('spremač ne može da pošalje unapred odobren zahtev', async () => {
    await expect(
      asUser(
        SEED.cleaner3,
        (tx) => tx`
        insert into verification_requests (user_id, document_type, status)
        values (${SEED.cleaner3}, 'id', 'verified')
      `,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('spremač ne može da upiše već verifikovan profil', async () => {
    await expect(
      asUser(
        SEED.ownerB,
        (tx) => tx`
        insert into cleaner_profiles (user_id, verification) values (${SEED.ownerB}, 'verified')
      `,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('status verifikacije ne menja sam spremač', async () => {
    await expect(
      asUser(
        SEED.cleaner3,
        (tx) =>
          tx`update cleaner_profiles set verification = 'verified' where user_id = ${SEED.cleaner3}`,
      ),
    ).rejects.toThrow(/VERIFIKACIJA_ZAKLJUCANA/);
  });
});

describe('objavljivanje recenzija', () => {
  const completedTask = '00000000-0000-4000-d000-000000000003';

  beforeAll(async () => {
    await admin`
      insert into cleaning_tasks (
        id, property_id, owner_id, cleaner_id, status, window_start, window_end
      ) values (
        ${completedTask}, ${PROPERTY_A}, ${SEED.ownerA}, ${SEED.cleaner1},
        'completed', now() - interval '2 hours', now()
      )
    `;
  });

  afterAll(async () => {
    await admin`delete from cleaning_tasks where id = ${completedTask}`;
  });

  it('autor ne može da objavi recenziju prilikom upisa', async () => {
    await expect(
      asUser(
        SEED.ownerA,
        (tx) => tx`
        insert into reviews (task_id, reviewer_id, reviewee_id, direction, rating, published_at)
        values (${completedTask}, ${SEED.ownerA}, ${SEED.cleaner1}, 'owner_to_cleaner', 5, now())
      `,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('drugi učesnik i posetilac vide recenziju tek kad je sistem objavi', async () => {
    await admin`
      insert into reviews (task_id, reviewer_id, reviewee_id, direction, rating)
      values (${completedTask}, ${SEED.ownerA}, ${SEED.cleaner1}, 'owner_to_cleaner', 5)
    `;
    expect(await asUser(SEED.cleaner1, (tx) => tx`select id from reviews`)).toHaveLength(0);
    expect(await asAnon((tx) => tx`select id from reviews`)).toHaveLength(0);

    await admin`update reviews set published_at = now() where task_id = ${completedTask}`;
    expect(await asUser(SEED.cleaner1, (tx) => tx`select id from reviews`)).toHaveLength(1);
    expect(await asAnon((tx) => tx`select id from reviews`)).toHaveLength(1);
  });
});

describe('nijedna tabela nije ostala bez zaštite (pravilo iz CLAUDE.md)', () => {
  it('RLS je uključen na svakoj tabeli u public', async () => {
    const rows = await admin<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by c.relname
    `;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('svaka tabela ima RLS politiku', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
        )
      order by c.relname
    `;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seed je upisao oba regiona i pet pravnih dokumenata', async () => {
    const [regions] = await admin`select count(*)::int as n from regions`;
    const [docs] = await admin`select count(*)::int as n from legal_documents where is_active`;
    expect(regions!.n).toBe(2);
    expect(docs!.n).toBe(5);
  });
});
