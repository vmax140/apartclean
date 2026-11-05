import postgres, { type Sql } from 'postgres';

// Lokalna baza koju diže `supabase start` (port iz supabase/config.toml).
const LOCAL_DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

/** Veza kao postgres: zaobilazi RLS. Koristi se samo za pripremu podataka. */
export const admin: Sql = postgres(LOCAL_DB_URL, { max: 4, onnotice: () => {} });

/**
 * Pokreće upite kao prijavljeni korisnik, tačno onako kako to radi PostgREST:
 * uloga `authenticated` i `request.jwt.claims` iz kojih auth.uid() čita korisnika.
 *
 * Sve se odvija u transakciji koja se na kraju poništava, pa testovi ne ostavljaju
 * trag jedan drugom.
 */
export async function asUser<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  const connection = await admin.reserve();
  try {
    await connection`begin`;
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await connection`select set_config('request.jwt.claims', ${claims}, true)`;
    await connection`select set_config('role', 'authenticated', true)`;
    return await fn(connection as unknown as Sql);
  } finally {
    try {
      await connection`rollback`;
    } finally {
      connection.release();
    }
  }
}

/** Isto, ali za neprijavljenog posetioca (uloga `anon`). */
export async function asAnon<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const connection = await admin.reserve();
  try {
    await connection`begin`;
    await connection`select set_config('role', 'anon', true)`;
    return await fn(connection as unknown as Sql);
  } finally {
    try {
      await connection`rollback`;
    } finally {
      connection.release();
    }
  }
}

/** Nalozi iz supabase/seed.sql. */
export const SEED = {
  admin: '00000000-0000-4000-a000-000000000001',
  ownerA: '00000000-0000-4000-a000-000000000002',
  ownerB: '00000000-0000-4000-a000-000000000003',
  cleaner1: '00000000-0000-4000-a000-000000000004',
  cleaner2: '00000000-0000-4000-a000-000000000005',
  cleaner3: '00000000-0000-4000-a000-000000000006',
} as const;
