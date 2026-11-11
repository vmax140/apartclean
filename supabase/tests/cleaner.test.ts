import { afterAll, describe, expect, it } from 'vitest';
import { admin, asUser, SEED } from './helpers';

// Faza 1D: profil spremačice i tim vlasnika (SPEC sekcije 6 i 7).

async function callAs<T>(userId: string, run: (tx: Awaited<ReturnType<typeof admin.reserve>>) => Promise<T>) {
  const connection = await admin.reserve();
  try {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await connection`select set_config('request.jwt.claims', ${claims}, false)`;
    await connection`select set_config('role', 'authenticated', false)`;
    return await run(connection);
  } finally {
    await connection`reset role`;
    await connection`select set_config('request.jwt.claims', '', false)`;
    connection.release();
  }
}

afterAll(async () => {
  await admin`delete from preferred_cleaners where owner_id in (${SEED.ownerA}, ${SEED.ownerB})`;
  await admin`delete from cleaner_regions where cleaner_id = ${SEED.cleaner1}`;
  await admin`insert into cleaner_regions (cleaner_id, region_id) values (${SEED.cleaner1}, 1)
              on conflict do nothing`;
  await admin.end();
});

describe('save_cleaner_profile (SPEC sekcija 6)', () => {
  it('čuva profil i zamenjuje regione', async () => {
    await callAs(SEED.cleaner1, (tx) =>
      tx`select save_cleaner_profile(${tx.json({
        bio: 'Radim brzo i uredno.',
        region_ids: [1, 2],
        languages: ['sr', 'en'],
        base_price_rsd: 4200,
        has_car: true,
        brings_supplies: false,
        max_jobs_per_day: 4,
      })})`,
    );

    const [profile] = await admin`
      select bio, base_price_rsd, has_car, brings_supplies, max_jobs_per_day, languages
      from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    expect(profile?.bio).toBe('Radim brzo i uredno.');
    expect(profile?.base_price_rsd).toBe(4200);
    expect(profile?.has_car).toBe(true);
    expect(profile?.max_jobs_per_day).toBe(4);

    const regions = await admin`
      select region_id from cleaner_regions where cleaner_id = ${SEED.cleaner1} order by region_id`;
    expect(regions.map((row) => row.region_id)).toEqual([1, 2]);

    // Ponovno čuvanje sa jednim regionom mora da ukloni prethodni, ne da doda.
    await callAs(SEED.cleaner1, (tx) =>
      tx`select save_cleaner_profile(${tx.json({ region_ids: [2], languages: ['sr'] })})`,
    );
    const after = await admin`
      select region_id from cleaner_regions where cleaner_id = ${SEED.cleaner1}`;
    expect(after.map((row) => row.region_id)).toEqual([2]);
  });

  it('traži bar jedan region', async () => {
    await expect(
      callAs(SEED.cleaner1, (tx) =>
        tx`select save_cleaner_profile(${tx.json({ region_ids: [], languages: ['sr'] })})`,
      ),
    ).rejects.toThrow(/REGION_OBAVEZAN/);
  });

  it('vlasnik ne može da popuni profil spremačice', async () => {
    await expect(
      callAs(SEED.ownerA, (tx) =>
        tx`select save_cleaner_profile(${tx.json({ region_ids: [1], languages: ['sr'] })})`,
      ),
    ).rejects.toThrow(/NIJE_SPREMACICA/);
  });

  it('verifikaciju ne može da promeni ni kroz profil', async () => {
    // Mora biti stvarna promena vrednosti: spremačica 1 je u seed-u već 'verified',
    // pa upis iste vrednosti nije izmena i triger s pravom ćuti.
    await expect(
      asUser(
        SEED.cleaner1,
        (tx) => tx`update cleaner_profiles set verification = 'rejected' where user_id = ${SEED.cleaner1}`,
      ),
    ).rejects.toThrow(/VERIFIKACIJA_ZAKLJUCANA/);
  });

  it('ni datum verifikacije ne može sama da postavi', async () => {
    await expect(
      asUser(
        SEED.cleaner1,
        (tx) => tx`update cleaner_profiles set verified_at = now() where user_id = ${SEED.cleaner1}`,
      ),
    ).rejects.toThrow(/VERIFIKACIJA_ZAKLJUCANA/);
  });
});

describe('tim vlasnika (SPEC sekcija 5: glavni i rezervni)', () => {
  it('dozvoljava samo jednu glavnu spremačicu', async () => {
    await admin`
      insert into preferred_cleaners (owner_id, cleaner_id, priority)
      values (${SEED.ownerA}, ${SEED.cleaner1}, 1)`;

    await expect(
      admin`
        insert into preferred_cleaners (owner_id, cleaner_id, priority)
        values (${SEED.ownerA}, ${SEED.cleaner2}, 1)`,
    ).rejects.toThrow();

    // Rezervnih može više.
    await admin`
      insert into preferred_cleaners (owner_id, cleaner_id, priority)
      values (${SEED.ownerA}, ${SEED.cleaner2}, 2), (${SEED.ownerA}, ${SEED.cleaner3}, 2)`;
    const [count] = await admin`
      select count(*)::int as n from preferred_cleaners where owner_id = ${SEED.ownerA}`;
    expect(count?.n).toBe(3);
  });

  it('drugi vlasnik ne vidi tuđi tim', async () => {
    const mine = await asUser(SEED.ownerA, (tx) => tx`select cleaner_id from preferred_cleaners`);
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await asUser(SEED.ownerB, (tx) => tx`select cleaner_id from preferred_cleaners`);
    expect(theirs).toHaveLength(0);
  });

  it('spremačica vidi da je u nečijem timu, ali ne i ko je još u njemu', async () => {
    const rows = await asUser(SEED.cleaner1, (tx) => tx`select owner_id, priority from preferred_cleaners`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owner_id).toBe(SEED.ownerA);
  });
});

describe('spisak spremačica', () => {
  it('vlasnik vidi spremačice i oznaku verifikacije', async () => {
    const rows = await asUser(
      SEED.ownerA,
      (tx) => tx`select user_id, full_name, is_verified from cleaner_directory order by full_name`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((row) => typeof row.full_name === 'string' && row.full_name !== '')).toBe(true);
  });

  it('spisak ne otkriva telefon ni status naloga', async () => {
    const columns = await admin`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'cleaner_directory'`;
    const names = columns.map((row) => row.column_name);
    expect(names).not.toContain('phone');
    expect(names).not.toContain('status');
  });
});
