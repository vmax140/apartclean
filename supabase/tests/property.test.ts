import { afterAll, describe, expect, it } from 'vitest';
import { admin, asUser, SEED } from './helpers';

// Faza 1C: pravljenje apartmana kroz čarobnjak i pristupni podaci.
// Izvor: docs/SPEC.md sekcija 7 (vlasnik), docs/DECISIONS.md odluke 4 i 5.

const BASE = {
  region_id: 1,
  name: 'Apartman Sunčana dolina',
  address: 'Kopaonik bb, Suvo Rudište',
  complex_name: 'Sunčana dolina',
  lat: 43.2847,
  lng: 20.8103,
  bedrooms: 1,
  bathrooms: 1,
  max_guests: 4,
};

const THREE_ROOMS = [
  { type: 'bedroom', name: 'Spavaća soba', sort_order: 0 },
  { type: 'bathroom', name: 'Kupatilo 1', sort_order: 1 },
  { type: 'kitchen', name: 'Kuhinja', sort_order: 2 },
];

const created: string[] = [];

// create_property radi kao pozivalac, a red treba da ostane posle poziva da bismo
// ga proveravali iz drugih uloga — zato ovde nema poništavanja transakcije kao u asUser.
async function createAs(userId: string, payload: object) {
  const connection = await admin.reserve();
  try {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await connection`select set_config('request.jwt.claims', ${claims}, false)`;
    await connection`select set_config('role', 'authenticated', false)`;
    // sql.json() šalje pravi jsonb objekat; JSON.stringify bi stigao kao JSON skalar.
    const [row] = await connection`select public.create_property(${connection.json(payload)}) as id`;
    const id = row?.id as string | undefined;
    if (!id) throw new Error('APARTMAN_NIJE_NAPRAVLJEN');
    created.push(id);
    return id;
  } finally {
    await connection`reset role`;
    await connection`select set_config('request.jwt.claims', '', false)`;
    connection.release();
  }
}

afterAll(async () => {
  if (created.length) await admin`delete from properties where id in ${admin(created)}`;
  await admin.end();
});

describe('create_property (SPEC sekcija 7 — čarobnjak)', () => {
  it('pravi apartman sa tri sobe i checklistom iz šablona', async () => {
    const id = await createAs(SEED.ownerA, { ...BASE, rooms: THREE_ROOMS });
    expect(id).toBeTruthy();

    const [property] = await admin`select owner_id, geofence_m, checkout_time from properties where id = ${id}`;
    expect(property?.owner_id).toBe(SEED.ownerA);
    expect(property?.geofence_m).toBe(150);

    const rooms = await admin`select type from property_rooms where property_id = ${id} order by sort_order`;
    expect(rooms.map((r) => r.type)).toEqual(['bedroom', 'bathroom', 'kitchen']);

    const [template] = await admin`select id from checklist_templates where property_id = ${id}`;
    expect(template).toBeTruthy();

    const items = await admin`
      select distinct room_type from checklist_items where template_id = ${template!.id} order by room_type
    `;
    const types = items.map((i) => i.room_type);
    // Samo sobe koje apartman ima, plus opšte stavke (room_type is null).
    expect(types).toContain('bedroom');
    expect(types).toContain('bathroom');
    expect(types).toContain('kitchen');
    expect(types).toContain(null);
    expect(types).not.toContain('balcony');
  });

  it('odbija apartman bez ijedne sobe', async () => {
    await expect(createAs(SEED.ownerA, { ...BASE, rooms: [] })).rejects.toThrow(/SOBE_OBAVEZNE/);
  });

  it('upisuje vlasnika iz prijave, ne iz podataka koje klijent pošalje', async () => {
    const id = await createAs(SEED.ownerB, {
      ...BASE,
      owner_id: SEED.ownerA,
      rooms: THREE_ROOMS,
    });
    const [property] = await admin`select owner_id from properties where id = ${id}`;
    expect(property?.owner_id).toBe(SEED.ownerB);
  });
});

describe('apartman je vidljiv samo svom vlasniku (SPEC sekcija 4)', () => {
  it('vlasnik B ne vidi apartman vlasnika A ni posle čarobnjaka', async () => {
    const id = await createAs(SEED.ownerA, { ...BASE, rooms: THREE_ROOMS });

    const mine = await asUser(SEED.ownerA, (tx) => tx`select id from properties where id = ${id}`);
    expect(mine).toHaveLength(1);

    const theirs = await asUser(SEED.ownerB, (tx) => tx`select id from properties where id = ${id}`);
    expect(theirs).toHaveLength(0);

    const theirRooms = await asUser(
      SEED.ownerB,
      (tx) => tx`select id from property_rooms where property_id = ${id}`,
    );
    expect(theirRooms).toHaveLength(0);
  });
});

describe('pristupni podaci (docs/DECISIONS.md, odluka 4)', () => {
  it('upisuju se i čitaju samo za svoj apartman', async () => {
    const id = await createAs(SEED.ownerA, { ...BASE, rooms: THREE_ROOMS });

    await admin`select set_property_access(${id}, ${SEED.ownerA}, 'Sef levo od ulaza', 'sifrovano:AAA', 'Mreza', 'sifrovano:BBB')`;
    const rows = await admin`select * from get_property_access_for_owner(${id}, ${SEED.ownerA})`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lockbox_code_encrypted).toBe('sifrovano:AAA');

    await expect(
      admin`select set_property_access(${id}, ${SEED.ownerB}, 'x', 'y', 'z', 'w')`,
    ).rejects.toThrow(/NIJE_VAS_APARTMAN/);

    await expect(
      admin`select * from get_property_access_for_owner(${id}, ${SEED.ownerB})`,
    ).rejects.toThrow(/NIJE_VAS_APARTMAN/);
  });

  it('klijent ne može direktno da čita property_access', async () => {
    const id = await createAs(SEED.ownerA, { ...BASE, rooms: THREE_ROOMS });
    await admin`select set_property_access(${id}, ${SEED.ownerA}, 'Sef', 'sifrovano:AAA', 'Mreza', 'sifrovano:BBB')`;

    const rows = await asUser(
      SEED.ownerA,
      (tx) => tx`select lockbox_code_encrypted from property_access where property_id = ${id}`,
    );
    expect(rows).toHaveLength(0);
  });
});
