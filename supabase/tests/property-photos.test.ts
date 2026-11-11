import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, localApi, signIn, SEED } from './helpers';

// Faza 1C, kriterijum završetka: vlasnik doda apartman sa tri sobe i tri
// referentne slike, a drugi vlasnik ga ne vidi (SPEC sekcija 10).
// Putanja je {property_id}/{room_id}/{photo_id}.jpg (docs/DECISIONS.md, odluka 5).

const BUCKET = 'reference-photos';

// Najmanji ispravan JPEG — dovoljno da Storage prihvati sadržaj tog tipa.
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x02, 0x02,
  0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06, 0x06, 0x05,
  0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a, 0x0b, 0x0e,
  0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c, 0x12, 0x13,
  0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc9, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
  0x01, 0x01, 0x11, 0x00, 0xff, 0xcc, 0x00, 0x06, 0x00, 0x10, 0x10, 0x05, 0xff, 0xda, 0x00, 0x08,
  0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
]);

let api: string;
let anon: string;
let ownerAToken: string;
let ownerBToken: string;
let property: string;
let rooms: string[] = [];
const paths: string[] = [];

beforeAll(async () => {
  const status = localApi();
  api = status.API_URL;
  anon = status.ANON_KEY;
  ownerAToken = await signIn(api, anon, 'vlasnik.a@apartclean.test');
  ownerBToken = await signIn(api, anon, 'vlasnik.b@apartclean.test');

  const [created] = await admin`
    insert into properties (owner_id, region_id, name, address, lat, lng)
    values (${SEED.ownerA}, 1, 'Apartman sa slikama', 'Kopaonik bb', 43.28, 20.81)
    returning id`;
  property = created!.id as string;

  const inserted = await admin`
    insert into property_rooms (property_id, type, name, sort_order)
    values
      (${property}, 'bedroom', 'Spavaća soba', 0),
      (${property}, 'bathroom', 'Kupatilo 1', 1),
      (${property}, 'kitchen', 'Kuhinja', 2)
    returning id`;
  rooms = inserted.map((row) => row.id as string);
}, 30000);

afterAll(async () => {
  for (const path of paths) {
    await fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE',
      headers: { apikey: anon, Authorization: 'Bearer ' + ownerAToken },
    });
  }
  if (property) await admin`delete from properties where id = ${property}`;
  await admin.end();
});

function upload(path: string, token: string) {
  paths.push(path);
  return fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'image/jpeg',
    },
    body: JPEG,
  });
}

function download(path: string, token: string) {
  return fetch(`${api}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: anon, Authorization: 'Bearer ' + token },
  });
}

it('vlasnik postavi tri referentne slike, po jednu za svaku sobu', async () => {
  expect(rooms).toHaveLength(3);

  for (const roomId of rooms) {
    const photoId = crypto.randomUUID();
    const path = `${property}/${roomId}/${photoId}.jpg`;
    const response = await upload(path, ownerAToken);
    expect(response.ok, await response.text()).toBe(true);

    await admin`
      insert into reference_photos (id, property_id, room_id, storage_path)
      values (${photoId}, ${property}, ${roomId}, ${path})`;
  }

  const stored = await admin`select storage_path from reference_photos where property_id = ${property}`;
  expect(stored).toHaveLength(3);
  // Svaka putanja počinje apartmanom pa sobom — odluka 5.
  for (const row of stored) {
    expect(String(row.storage_path).startsWith(property + '/')).toBe(true);
  }
}, 30000);

it('vlasnik čita svoje slike', async () => {
  const response = await download(paths[0]!, ownerAToken);
  expect(response.ok, 'HTTP ' + response.status).toBe(true);
});

it('drugi vlasnik ne može ni da pročita ni da postavi sliku', async () => {
  const read = await download(paths[0]!, ownerBToken);
  expect(read.ok).toBe(false);

  const write = await upload(`${property}/${rooms[0]}/${crypto.randomUUID()}.jpg`, ownerBToken);
  expect(write.ok).toBe(false);
});

it('drugi vlasnik ne vidi ni redove o slikama', async () => {
  const response = await fetch(
    `${api}/rest/v1/reference_photos?property_id=eq.${property}&select=id`,
    { headers: { apikey: anon, Authorization: 'Bearer ' + ownerBToken } },
  );
  expect(await response.json()).toEqual([]);
});
