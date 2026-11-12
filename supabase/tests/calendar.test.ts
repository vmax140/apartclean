import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, SEED } from './helpers';
import { parseIcal } from '../functions/_shared/ical';

// Faza 2B: kalendar i automatika (SPEC sekcije 5 i 6).
// Kriterijum završetka: iCal sa tri rezervacije pravi tri zadatka, a uklanjanje
// jedne rezervacije otkazuje njen zadatak.

const PROPERTY = '00000000-0000-4000-e000-00000000000c';
const CALENDAR = '00000000-0000-4000-e000-00000000000d';

function icalWith(events: { uid: string; from: string; to: string }[]) {
  const body = events
    .map(
      (event) =>
        `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${event.from}\r\nDTEND;VALUE=DATE:${event.to}\r\n` +
        `UID:${event.uid}\r\nSUMMARY:CLOSED - Not available\r\nEND:VEVENT`,
    )
    .join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Booking.com//EN\r\n${body}\r\nEND:VCALENDAR`;
}

async function sync(text: string) {
  const events = parseIcal(text);
  const [row] = await admin`
    select sync_reservations(${CALENDAR}, ${admin.json(events)}) as result`;
  return row!.result as { created: number; cancelled: number };
}

beforeEach(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from reservations where property_id = ${PROPERTY}`;
  await admin`
    insert into properties (id, owner_id, region_id, name, address, lat, lng, checkout_time, checkin_time)
    values (${PROPERTY}, ${SEED.ownerA}, 1, 'Apartman iz kalendara', 'Kopaonik bb', 43.28, 20.81,
            '10:00', '14:00')
    on conflict (id) do nothing`;
  await admin`
    insert into property_calendars (id, property_id, source, ical_url)
    values (${CALENDAR}, ${PROPERTY}, 'booking', 'https://example.test/ical.ics')
    on conflict (id) do nothing`;
});

afterAll(async () => {
  await admin`delete from cleaning_tasks where property_id = ${PROPERTY}`;
  await admin`delete from property_calendars where id = ${CALENDAR}`;
  await admin`delete from reservations where property_id = ${PROPERTY}`;
  await admin`delete from properties where id = ${PROPERTY}`;
  await admin.end();
});

describe('čitanje iCal izvoza', () => {
  it('čita UID i datume iz VEVENT blokova', () => {
    const events = parseIcal(
      icalWith([{ uid: 'rez-1', from: '20261220', to: '20261223' }]),
    );
    expect(events).toEqual([
      { uid: 'rez-1', checkIn: '2026-12-20', checkOut: '2026-12-23', summary: 'CLOSED - Not available' },
    ]);
  });

  it('spaja prelomljene redove', () => {
    // iCal prelama duge redove; nastavak počinje razmakom.
    const text =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:vrlo-dugacak-identi\r\n fikator-rezervacije\r\n' +
      'DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261205\r\nEND:VEVENT\r\nEND:VCALENDAR';
    expect(parseIcal(text)[0]?.uid).toBe('vrlo-dugacak-identifikator-rezervacije');
  });

  it('razume i datum sa vremenom', () => {
    const text =
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261201T100000Z\r\nDTEND:20261203T100000Z\r\nEND:VEVENT';
    expect(parseIcal(text)[0]?.checkIn).toBe('2026-12-01');
  });

  it('preskače blokove bez datuma i one koji se završavaju pre početka', () => {
    const bad =
      'BEGIN:VEVENT\r\nUID:bez-datuma\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:unazad\r\nDTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261208\r\nEND:VEVENT';
    expect(parseIcal(bad)).toEqual([]);
  });
});

describe('sinhronizacija (kriterijum završetka 2B)', () => {
  it('tri rezervacije prave tri zadatka za dan odjave', async () => {
    const result = await sync(
      icalWith([
        { uid: 'rez-1', from: '20261220', to: '20261223' },
        { uid: 'rez-2', from: '20261224', to: '20261227' },
        { uid: 'rez-3', from: '20261228', to: '20261230' },
      ]),
    );
    expect(result.created).toBe(3);

    const reservations = await admin`
      select external_uid from reservations where calendar_id = ${CALENDAR} order by check_in`;
    expect(reservations.map((row) => row.external_uid)).toEqual(['rez-1', 'rez-2', 'rez-3']);

    const tasks = await admin`
      select window_start, window_end, status from cleaning_tasks
      where property_id = ${PROPERTY} order by window_start`;
    expect(tasks).toHaveLength(3);
    expect(tasks.every((row) => row.status === 'draft')).toBe(true);

    // Prozor ide od odjave do prijave istog dana (10:00 → 14:00 po beogradskom vremenu).
    const first = new Date(tasks[0]!.window_start as string);
    const firstEnd = new Date(tasks[0]!.window_end as string);
    expect(firstEnd.getTime() - first.getTime()).toBe(4 * 3600 * 1000);
    expect(first.toISOString().slice(0, 10)).toBe('2026-12-23');
  });

  it('ponovna sinhronizacija ne pravi duplikate', async () => {
    const feed = icalWith([{ uid: 'rez-1', from: '20261220', to: '20261223' }]);
    await sync(feed);
    await sync(feed);
    const tasks = await admin`select id from cleaning_tasks where property_id = ${PROPERTY}`;
    expect(tasks).toHaveLength(1);
  });

  it('uklonjena rezervacija otkazuje svoj zadatak', async () => {
    await sync(
      icalWith([
        { uid: 'rez-1', from: '20261220', to: '20261223' },
        { uid: 'rez-2', from: '20261224', to: '20261227' },
      ]),
    );

    const result = await sync(icalWith([{ uid: 'rez-1', from: '20261220', to: '20261223' }]));
    expect(result.cancelled).toBe(1);

    const [gone] = await admin`
      select r.is_cancelled, t.status, t.cancel_reason
      from reservations r join cleaning_tasks t on t.reservation_id = r.id
      where r.external_uid = 'rez-2' and r.calendar_id = ${CALENDAR}`;
    expect(gone?.is_cancelled).toBe(true);
    expect(gone?.status).toBe('cancelled');
    expect(String(gone?.cancel_reason)).toContain('kalendaru');

    // Preostali zadatak je netaknut.
    const [kept] = await admin`
      select t.status from reservations r join cleaning_tasks t on t.reservation_id = r.id
      where r.external_uid = 'rez-1' and r.calendar_id = ${CALENDAR}`;
    expect(kept?.status).toBe('draft');
  });

  it('prihvaćen zadatak se ne gasi sam — vlasnik dobija pitanje', async () => {
    await sync(icalWith([{ uid: 'rez-9', from: '20261220', to: '20261223' }]));
    const [task] = await admin`select id from cleaning_tasks where property_id = ${PROPERTY}`;
    await admin`
      update cleaning_tasks set status = 'accepted', cleaner_id = ${SEED.cleaner1}, accepted_at = now()
      where id = ${task!.id}`;

    await sync(icalWith([]));

    const [after] = await admin`select status from cleaning_tasks where id = ${task!.id}`;
    expect(after?.status).toBe('accepted');

    const [message] = await admin`
      select type from notifications
      where user_id = ${SEED.ownerA} and type = 'reservation_cancelled'
      order by created_at desc limit 1`;
    expect(message?.type).toBe('reservation_cancelled');
  });

  it('greška pri skidanju se beleži uz kalendar', async () => {
    await admin`select record_calendar_error(${CALENDAR}, 'HTTP 404')`;
    const [row] = await admin`select last_error, last_synced_at from property_calendars where id = ${CALENDAR}`;
    expect(row?.last_error).toBe('HTTP 404');
    expect(row?.last_synced_at).not.toBeNull();
  });
});

describe('nedolazak i objava ocena', () => {
  it('30 min posle početka zadatak ide dalje, a pouzdanost pada', async () => {
    await admin`delete from preferred_cleaners where owner_id = ${SEED.ownerA}`;
    const [task] = await admin`
      insert into cleaning_tasks (property_id, owner_id, cleaner_id, status, window_start, window_end)
      values (${PROPERTY}, ${SEED.ownerA}, ${SEED.cleaner1}, 'accepted',
              now() - interval '45 minutes', now() + interval '3 hours')
      returning id`;

    const [before] = await admin`select reliability_pct from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    const [result] = await admin`select flag_no_shows() as n`;
    expect(Number(result!.n)).toBeGreaterThanOrEqual(1);

    const [after] = await admin`select status, cleaner_id from cleaning_tasks where id = ${task!.id}`;
    expect(after?.status).toBe('open');
    expect(after?.cleaner_id).toBeNull();

    const [reliability] = await admin`select reliability_pct from cleaner_profiles where user_id = ${SEED.cleaner1}`;
    expect(Number(reliability?.reliability_pct)).toBeLessThan(Number(before?.reliability_pct ?? 100));

    // Isti zadatak se drugi put ne hvata, pa alarm ne može da se ponovi.
    const [again] = await admin`select flag_no_shows() as n`;
    expect(Number(again!.n)).toBe(0);
  });

  it('ocene se objavljuju kada obe strane ocene (odluka 14)', async () => {
    const [task] = await admin`
      insert into cleaning_tasks (property_id, owner_id, cleaner_id, status, window_start, window_end, completed_at)
      values (${PROPERTY}, ${SEED.ownerA}, ${SEED.cleaner2}, 'completed',
              now() - interval '2 days', now() - interval '1 day', now())
      returning id`;

    await admin`
      insert into reviews (task_id, reviewer_id, reviewee_id, direction, rating)
      values (${task!.id}, ${SEED.ownerA}, ${SEED.cleaner2}, 'owner_to_cleaner', 5)`;

    // Samo jedna ocena i nije prošlo 7 dana — ništa se ne objavljuje.
    expect(Number((await admin`select publish_due_reviews() as n`)[0]!.n)).toBe(0);

    await admin`
      insert into reviews (task_id, reviewer_id, reviewee_id, direction, rating)
      values (${task!.id}, ${SEED.cleaner2}, ${SEED.ownerA}, 'cleaner_to_owner', 4)`;

    expect(Number((await admin`select publish_due_reviews() as n`)[0]!.n)).toBe(2);

    const [profile] = await admin`select rating_avg, rating_count from profiles where id = ${SEED.cleaner2}`;
    expect(Number(profile?.rating_avg)).toBe(5);
    expect(Number(profile?.rating_count)).toBe(1);

    await admin`delete from reviews where task_id = ${task!.id}`;
  });
});

describe('cron poslovi su zakazani po SPEC sekciji 5', () => {
  it('svih sedam poslova postoji sa tačnim ritmom', async () => {
    const jobs = await admin<{ jobname: string; schedule: string }[]>`
      select jobname, schedule from cron.job order by jobname`;
    const byName = new Map(jobs.map((job) => [job.jobname, job.schedule]));

    expect(byName.get('ical-sync')).toBe('*/30 * * * *');
    expect(byName.get('expire-offers')).toBe('*/5 * * * *');
    expect(byName.get('flag-no-shows')).toBe('*/5 * * * *');
    expect(byName.get('auto-complete-tasks')).toBe('*/15 * * * *');
    expect(byName.get('expire-tasks')).toBe('*/15 * * * *');
    expect(byName.get('publish-reviews')).toBe('30 2 * * *');
    expect(byName.get('purge-task-photos')).toBe('45 3 * * *');

    // Ping namerno nije pg_cron posao (docs/DECISIONS.md, odluka 15).
    expect([...byName.keys()].some((name) => name.includes('ping'))).toBe(false);
  });
});
