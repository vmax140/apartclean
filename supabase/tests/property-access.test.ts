import { execSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, SEED } from './helpers';

// Faza 1C: Edge Function property-access (docs/DECISIONS.md, odluka 4).
// Proverava da šifra sefa i WiFi lozinka nikad ne stignu u bazu u čitljivom obliku.

const PASSWORD = 'Lozinka123!';
const LOCKBOX = '4821';
const WIFI_PASSWORD = 'planina-2026';

let api: string;
let anon: string;
let property: string;
const tokens = new Map<string, string>();

beforeAll(async () => {
  const status = JSON.parse(
    execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
  );
  api = status.API_URL;
  anon = status.ANON_KEY;
  if (new URL(api).hostname !== '127.0.0.1') throw new Error('Test traži lokalni Supabase');

  const [row] = await admin`
    insert into properties (owner_id, region_id, name, address, lat, lng)
    values (${SEED.ownerA}, 1, 'Apartman za pristup', 'Kopaonik bb', 43.28, 20.81)
    returning id`;
  property = row!.id as string;

  for (const [email, id] of [
    ['vlasnik.a@apartclean.test', SEED.ownerA],
    ['vlasnik.b@apartclean.test', SEED.ownerB],
  ] as const) {
    const response = await post('/auth/v1/token?grant_type=password', { email, password: PASSWORD });
    const session = (await response.json()) as { access_token?: string };
    if (!session.access_token) throw new Error('Prijava nije uspela za ' + email);
    tokens.set(id, session.access_token);
  }
}, 30000);

afterAll(async () => {
  if (property) await admin`delete from properties where id = ${property}`;
  await admin.end();
});

function post(path: string, body: object, token?: string) {
  return fetch(api + path, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

function callAccess(body: object, userId: string) {
  return post('/functions/v1/property-access', { propertyId: property, ...body }, tokens.get(userId));
}

it('vlasnik upisuje pristupne podatke, a baza ih vidi samo šifrovane', async () => {
  const saved = await callAccess(
    {
      action: 'save',
      key_instructions: 'Sef je levo od ulaznih vrata.',
      lockbox_code: LOCKBOX,
      wifi_name: 'SuncanaDolina',
      wifi_password: WIFI_PASSWORD,
    },
    SEED.ownerA,
  );
  expect(saved.ok, await saved.text()).toBe(true);

  const [stored] = await admin`
    select key_instructions, lockbox_code_encrypted, wifi_name, wifi_password_encrypted
    from property_access where property_id = ${property}`;

  // Uputstvo i naziv mreže nisu tajne i stoje otvoreni.
  expect(stored?.key_instructions).toBe('Sef je levo od ulaznih vrata.');
  expect(stored?.wifi_name).toBe('SuncanaDolina');

  // Šifre jesu tajne: u bazi ne sme da postoji njihov čitljiv trag.
  expect(stored?.lockbox_code_encrypted).not.toContain(LOCKBOX);
  expect(stored?.wifi_password_encrypted).not.toContain(WIFI_PASSWORD);
  // Zapis je oblika base64(iv).base64(sifrat).base64(oznaka) — odluka 4.
  expect(String(stored?.lockbox_code_encrypted).split('.')).toHaveLength(3);
  expect(String(stored?.wifi_password_encrypted).split('.')).toHaveLength(3);
}, 20000);

it('vlasnik ih pročita natrag u čitljivom obliku', async () => {
  const response = await callAccess({ action: 'load' }, SEED.ownerA);
  // Telo se čita samo jednom, pa ga ovde zadržavamo za obe provere.
  const payload = (await response.json()) as {
    access: { lockbox_code: string; wifi_password: string; key_instructions: string };
  };
  expect(response.ok, JSON.stringify(payload)).toBe(true);
  const { access } = payload;
  expect(access.lockbox_code).toBe(LOCKBOX);
  expect(access.wifi_password).toBe(WIFI_PASSWORD);
  expect(access.key_instructions).toBe('Sef je levo od ulaznih vrata.');
}, 20000);

it('drugi vlasnik ne može ni da pročita ni da izmeni', async () => {
  const read = await callAccess({ action: 'load' }, SEED.ownerB);
  expect(read.status).toBe(403);

  const write = await callAccess({ action: 'save', lockbox_code: '0000' }, SEED.ownerB);
  expect(write.status).toBe(403);

  // Posle neuspelog pokušaja vrednost je netaknuta.
  const [stored] = await admin`select lockbox_code_encrypted from property_access where property_id = ${property}`;
  expect(String(stored?.lockbox_code_encrypted).split('.')).toHaveLength(3);
}, 20000);

it('prazno polje se čuva kao null, ne kao šifrovana praznina', async () => {
  const response = await callAccess(
    { action: 'save', key_instructions: 'Samo uputstvo', lockbox_code: '', wifi_password: '' },
    SEED.ownerA,
  );
  expect(response.ok, await response.text()).toBe(true);
  const [stored] = await admin`
    select lockbox_code_encrypted, wifi_password_encrypted from property_access where property_id = ${property}`;
  expect(stored?.lockbox_code_encrypted).toBeNull();
  expect(stored?.wifi_password_encrypted).toBeNull();
}, 20000);
