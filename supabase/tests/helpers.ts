import { execSync } from 'node:child_process';
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

/** Adrese i ključevi lokalnog stacka, iz `supabase status`. */
export function localApi() {
  const status = JSON.parse(
    execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
  ) as { API_URL: string; ANON_KEY: string; MAILPIT_URL: string };
  if (new URL(status.API_URL).hostname !== '127.0.0.1') {
    throw new Error('Integracioni test traži lokalni Supabase');
  }
  return status;
}

/** Prijava seedovanog naloga; vraća pristupni token. */
export async function signIn(api: string, anon: string, email: string, password = 'Lozinka123!') {
  const response = await fetch(api + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = (await response.json()) as { access_token?: string };
  if (!session.access_token) throw new Error('Prijava nije uspela za ' + email);
  return session.access_token;
}
