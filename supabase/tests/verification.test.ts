import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, localApi, signIn, SEED } from './helpers';

// Faza 1D, kriterijum završetka: spremačica prođe verifikaciju, fajlovi su
// obrisani iz storage-a, a vlasnik je vidi kao „Verifikovan" (SPEC sekcija 10).
// Brisanje slika odmah po odluci traži SPEC sekcija 9.

const BUCKET = 'verification-docs';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

let api: string;
let anon: string;
let cleanerToken: string;
let adminToken: string;
let ownerToken: string;
let requestId: string;
let frontPath: string;
let selfiePath: string;

beforeAll(async () => {
  const status = localApi();
  api = status.API_URL;
  anon = status.ANON_KEY;
  cleanerToken = await signIn(api, anon, 'spremacica3@apartclean.test');
  adminToken = await signIn(api, anon, 'admin@apartclean.test');
  ownerToken = await signIn(api, anon, 'vlasnik.a@apartclean.test');

  requestId = crypto.randomUUID();
  // Putanje po docs/DECISIONS.md, odluka 5.
  frontPath = `${SEED.cleaner3}/${requestId}-front.jpg`;
  selfiePath = `${SEED.cleaner3}/${requestId}-selfie.jpg`;

  for (const path of [frontPath, selfiePath]) {
    const upload = await fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + cleanerToken, 'Content-Type': 'image/jpeg' },
      body: JPEG,
    });
    expect(upload.ok, 'slanje ' + path + ': ' + (await upload.text())).toBe(true);
  }

  await admin`
    insert into verification_requests (id, user_id, document_type, doc_front_path, selfie_path)
    values (${requestId}, ${SEED.cleaner3}, 'licna_karta', ${frontPath}, ${selfiePath})`;
}, 40000);

afterAll(async () => {
  await admin`delete from verification_requests where id = ${requestId}`;
  await admin`
    update cleaner_profiles
    set verification = 'pending', verified_at = null, verified_by = null
    where user_id = ${SEED.cleaner3}`;
  await admin.end();
});

function decide(body: object, token: string) {
  return fetch(api + '/functions/v1/verify-decision', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function exists(path: string) {
  return fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: anon, Authorization: 'Bearer ' + adminToken },
  }).then((response) => response.ok);
}

it('spremačica ne vidi tuđe dokumente, ni svoje posle slanja', async () => {
  // SPEC sekcija 4: verification-docs čita samo admin.
  const own = await fetch(`${api}/storage/v1/object/${BUCKET}/${frontPath}`, {
    headers: { apikey: anon, Authorization: 'Bearer ' + cleanerToken },
  });
  expect(own.ok).toBe(false);
});

it('o verifikaciji ne odlučuje niko osim administratora', async () => {
  expect((await decide({ requestId, approve: true }, cleanerToken)).status).toBe(403);
  expect((await decide({ requestId, approve: true }, ownerToken)).status).toBe(403);

  const [row] = await admin`select status from verification_requests where id = ${requestId}`;
  expect(row?.status).toBe('pending');
}, 20000);

it('odbijanje bez razloga se ne prihvata', async () => {
  const response = await decide({ requestId, approve: false, reason: '   ' }, adminToken);
  expect(response.status).toBe(400);
}, 20000);

it('posle odobrenja fajlovi više ne postoje', async () => {
  expect(await exists(frontPath)).toBe(true);
  expect(await exists(selfiePath)).toBe(true);

  const response = await decide({ requestId, approve: true }, adminToken);
  const payload = (await response.json()) as { ok?: boolean; filesDeleted?: number };
  expect(response.ok, JSON.stringify(payload)).toBe(true);
  expect(payload.filesDeleted).toBe(2);

  // Ovo je suština SPEC sekcije 9: lični dokumenti su stvarno nestali.
  expect(await exists(frontPath)).toBe(false);
  expect(await exists(selfiePath)).toBe(false);

  const [request] = await admin`
    select status, doc_front_path, selfie_path, files_deleted_at, reviewed_by
    from verification_requests where id = ${requestId}`;
  expect(request?.status).toBe('verified');
  expect(request?.doc_front_path).toBeNull();
  expect(request?.selfie_path).toBeNull();
  expect(request?.files_deleted_at).not.toBeNull();
  expect(request?.reviewed_by).toBe(SEED.admin);

  const [profile] = await admin`
    select verification, verified_by from cleaner_profiles where user_id = ${SEED.cleaner3}`;
  expect(profile?.verification).toBe('verified');
  expect(profile?.verified_by).toBe(SEED.admin);

  const [trail] = await admin`
    select action from audit_log
    where entity = 'verification_requests' and entity_id = ${requestId}`;
  expect(trail?.action).toBe('verification_approved');
}, 30000);

it('druga odluka o istom zahtevu se odbija', async () => {
  const response = await decide({ requestId, approve: true }, adminToken);
  expect(response.status).toBe(409);
}, 20000);

it('vlasnik vidi spremačicu kao verifikovanu', async () => {
  const response = await fetch(
    `${api}/rest/v1/cleaner_directory?user_id=eq.${SEED.cleaner3}&select=full_name,is_verified`,
    { headers: { apikey: anon, Authorization: 'Bearer ' + ownerToken } },
  );
  const [row] = (await response.json()) as { full_name: string; is_verified: boolean }[];
  expect(row?.is_verified).toBe(true);
}, 20000);
