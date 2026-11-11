import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, localApi, signIn, SEED } from './helpers';

// Dnevno čišćenje dokumenata za verifikaciju.
// SPEC sekcija 9 pokriva brisanje posle odluke; ovo pokriva zahteve o kojima se
// nikad ne odluči, zahteve zamenjene novijim, i fajlove zaostale posle greške.

const BUCKET = 'verification-docs';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

let api: string;
let anon: string;
let serviceKey: string;
let cleanerToken: string;

const madeRequests: string[] = [];

beforeAll(async () => {
  const status = localApi();
  api = status.API_URL;
  anon = status.ANON_KEY;
  serviceKey = status.SERVICE_ROLE_KEY;
  cleanerToken = await signIn(api, anon, 'spremacica3@apartclean.test');
}, 30000);

afterAll(async () => {
  if (madeRequests.length) {
    await admin`delete from verification_requests where id in ${admin(madeRequests)}`;
  }
  await admin`
    update cleaner_profiles set verification = 'pending', verified_at = null, verified_by = null
    where user_id = ${SEED.cleaner3}`;
  await admin.end();
});

async function upload(path: string) {
  const response = await fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + cleanerToken, 'Content-Type': 'image/jpeg' },
    body: JPEG,
  });
  expect(response.ok, 'slanje ' + path).toBe(true);
}

function fileExists(path: string) {
  return fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
  }).then((response) => response.ok);
}

function purge(key = serviceKey) {
  return fetch(api + '/functions/v1/purge-verification-docs', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  });
}

async function makeRequest(createdDaysAgo: number) {
  const id = crypto.randomUUID();
  const front = `${SEED.cleaner3}/${id}-front.jpg`;
  const selfie = `${SEED.cleaner3}/${id}-selfie.jpg`;
  await upload(front);
  await upload(selfie);
  await admin`
    insert into verification_requests (id, user_id, document_type, doc_front_path, selfie_path, created_at)
    values (${id}, ${SEED.cleaner3}, 'licna_karta', ${front}, ${selfie},
            now() - make_interval(days => ${createdDaysAgo}))`;
  madeRequests.push(id);
  return { id, front, selfie };
}

it('posao ne prolazi bez service ključa', async () => {
  expect((await purge(cleanerToken)).status).toBe(401);
  expect((await purge(anon)).status).toBe(401);
}, 20000);

it('briše dokumente zahteva koji predugo čeka i označava ga isteklim', async () => {
  const stale = await makeRequest(10);
  expect(await fileExists(stale.front)).toBe(true);

  const response = await purge();
  const payload = (await response.json()) as { expiredRequests: number; deletedFiles: number };
  expect(response.ok, JSON.stringify(payload)).toBe(true);
  expect(payload.expiredRequests).toBeGreaterThanOrEqual(1);

  expect(await fileExists(stale.front)).toBe(false);
  expect(await fileExists(stale.selfie)).toBe(false);

  const [row] = await admin`
    select status, rejection_reason, doc_front_path, files_deleted_at
    from verification_requests where id = ${stale.id}`;
  expect(row?.status).toBe('rejected');
  expect(String(row?.rejection_reason)).toContain('istekao');
  expect(row?.doc_front_path).toBeNull();
  expect(row?.files_deleted_at).not.toBeNull();
}, 40000);

it('svež zahtev ostaje netaknut', async () => {
  const fresh = await makeRequest(1);
  await purge();
  expect(await fileExists(fresh.front)).toBe(true);

  const [row] = await admin`select status from verification_requests where id = ${fresh.id}`;
  expect(row?.status).toBe('pending');
}, 40000);

it('nov zahtev poništava stari koji još čeka', async () => {
  const older = await makeRequest(1);
  const newer = await makeRequest(0);

  const [oldRow] = await admin`
    select status, rejection_reason from verification_requests where id = ${older.id}`;
  expect(oldRow?.status).toBe('rejected');
  expect(String(oldRow?.rejection_reason)).toContain('Zamenjen');

  const [newRow] = await admin`select status from verification_requests where id = ${newer.id}`;
  expect(newRow?.status).toBe('pending');

  // Fajlove poništenog zahteva pokupi isti dnevni posao.
  const response = await purge();
  const payload = (await response.json()) as { cleanedRequests: number };
  expect(payload.cleanedRequests).toBeGreaterThanOrEqual(1);
  expect(await fileExists(older.front)).toBe(false);
  expect(await fileExists(newer.front)).toBe(true);
}, 40000);

it('briše i fajl koji nema nijedan zahtev', async () => {
  const orphan = `${SEED.cleaner3}/${crypto.randomUUID()}-front.jpg`;
  await upload(orphan);
  expect(await fileExists(orphan)).toBe(true);

  await purge();
  expect(await fileExists(orphan)).toBe(false);
}, 40000);

it('cron posao je zakazan jednom dnevno', async () => {
  const [job] = await admin`
    select schedule, active from cron.job where jobname = 'purge-verification-docs'`;
  expect(job?.schedule).toBe('15 3 * * *');
  expect(job?.active).toBe(true);
});
