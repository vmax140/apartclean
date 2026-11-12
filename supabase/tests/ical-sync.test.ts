import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, localApi, SEED } from './helpers';

// Edge Function ical-sync, s kraja na kraj: skine fajl, raščlani ga i upiše.
//
// iCal se služi iz javnog bucket-a, ali preko adrese `kong:8000` — to je ime
// koje edge runtime vidi unutar Docker mreže. Spoljna 127.0.0.1 adresa mu nije
// dostupna, pa bi test sa njom proveravao samo da li funkcija ume da zabeleži grešku.

const PROPERTY = '00000000-0000-4000-e000-00000000000e';
const GOOD_CALENDAR = '00000000-0000-4000-e000-00000000000f';
const BAD_CALENDAR = '00000000-0000-4000-e000-000000000010';
// Bucket avatars prima samo slike, a sadržaj nam je tekst. Za ovaj test je to
// svejedno: ical-sync čita telo odgovora kao tekst i ne gleda content-type.
const FILE = 'kalendar-test.jpg';

let api: string;
let serviceKey: string;

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270105',
  'DTEND;VALUE=DATE:20270109',
  'UID:airbnb-1',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270110',
  'DTEND;VALUE=DATE:20270112',
  'UID:airbnb-2',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

beforeAll(async () => {
  const status = localApi();
  api = status.API_URL;
  serviceKey = status.SERVICE_ROLE_KEY;

  await fetch(`${api}/storage/v1/object/avatars/${FILE}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: ICS,
  });

  await admin`
    insert into properties (id, owner_id, region_id, name, address, lat, lng)
    values (${PROPERTY}, ${SEED.ownerA}, 1, 'Apartman za sync', 'Kopaonik bb', 43.28, 20.81)
    on conflict (id) do nothing`;
  await admin`
    insert into property_calendars (id, property_id, source, ical_url)
    values
      (${GOOD_CALENDAR}, ${PROPERTY}, 'airbnb',
       ${'http://kong:8000/storage/v1/object/public/avatars/' + FILE}),
      (${BAD_CALENDAR}, ${PROPERTY}, 'other', 'http://kong:8000/nema-ovoga.ics')
    on conflict (id) do nothing`;
}, 30000);

afterAll(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from property_calendars where property_id = ${PROPERTY}`;
  await admin`delete from reservations where property_id = ${PROPERTY}`;
  await admin`delete from properties where id = ${PROPERTY}`;
  await fetch(`${api}/storage/v1/object/avatars/${FILE}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
  });
  await admin.end();
});

function sync(body: object, key = serviceKey) {
  return fetch(api + '/functions/v1/ical-sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('bez service ključa ne radi', async () => {
  expect((await sync({}, 'pogresan-kljuc')).status).toBe(401);
}, 20000);

it('skine iCal i napravi rezervacije i zadatke', async () => {
  const response = await sync({ calendarId: GOOD_CALENDAR });
  const payload = (await response.json()) as { created: number; failed: string[] };
  expect(response.ok, JSON.stringify(payload)).toBe(true);
  expect(payload.failed).toEqual([]);
  expect(payload.created).toBe(2);

  const reservations = await admin`
    select external_uid, check_out from reservations where calendar_id = ${GOOD_CALENDAR}
    order by check_in`;
  expect(reservations.map((row) => row.external_uid)).toEqual(['airbnb-1', 'airbnb-2']);

  const tasks = await admin`
    select status from cleaning_tasks where property_id = ${PROPERTY}`;
  expect(tasks).toHaveLength(2);

  const [calendar] = await admin`
    select last_synced_at, last_error from property_calendars where id = ${GOOD_CALENDAR}`;
  expect(calendar?.last_synced_at).not.toBeNull();
  expect(calendar?.last_error).toBeNull();
}, 40000);

it('pokvaren kalendar ne ruši ostale, greška se beleži uz njega', async () => {
  const response = await sync({});
  const payload = (await response.json()) as { failed: string[]; calendars: number };
  expect(response.ok).toBe(true);
  expect(payload.failed).toContain(BAD_CALENDAR);

  const [bad] = await admin`select last_error from property_calendars where id = ${BAD_CALENDAR}`;
  expect(String(bad?.last_error).length).toBeGreaterThan(0);

  // Ispravan kalendar je u istom prolazu i dalje sinhronizovan.
  const [good] = await admin`select last_error from property_calendars where id = ${GOOD_CALENDAR}`;
  expect(good?.last_error).toBeNull();
}, 40000);
