import { parseIcal } from '../_shared/ical.ts';

// Sinhronizacija kalendara (SPEC sekcija 6, korak 1; cron na svakih 30 min).
// Ova funkcija samo skida i raščlanjuje iCal; šta postaje zadatak i šta se
// otkazuje odlučuje RPC sync_reservations, pa je to pravilo testirano u bazi.

const FETCH_TIMEOUT_MS = 15_000;

function json(status: number, payload: object) {
  return Response.json(payload, { status });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(500, { error: 'CONFIGURATION_ERROR' });
  if (request.headers.get('authorization') !== 'Bearer ' + serviceKey) {
    return json(401, { error: 'UNAUTHORIZED' });
  }

  const call = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        apikey: serviceKey,
        authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
    });

  // Jedan kalendar se može zadati u telu; bez njega idu svi.
  const body = await request.json().catch(() => ({}));
  const only = typeof body?.calendarId === 'string' ? `&id=eq.${body.calendarId}` : '';

  const listed = await call(`/rest/v1/property_calendars?select=id,ical_url${only}`);
  if (!listed.ok) return json(500, { error: 'CALENDARS_LOAD_FAILED' });
  const calendars = (await listed.json()) as { id: string; ical_url: string }[];

  let created = 0;
  let cancelled = 0;
  const failed: string[] = [];

  for (const calendar of calendars) {
    try {
      const response = await fetch(calendar.ical_url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'text/calendar, text/plain' },
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const events = parseIcal(await response.text());
      const synced = await call('/rest/v1/rpc/sync_reservations', {
        method: 'POST',
        body: JSON.stringify({ target_calendar: calendar.id, events }),
      });
      if (!synced.ok) throw new Error('RPC ' + synced.status);

      const result = (await synced.json()) as { created: number; cancelled: number };
      created += result.created;
      cancelled += result.cancelled;
    } catch (problem) {
      // Jedan pokvaren kalendar ne sme da zaustavi ostale — greška se beleži uz njega.
      failed.push(calendar.id);
      await call('/rest/v1/rpc/record_calendar_error', {
        method: 'POST',
        body: JSON.stringify({
          target_calendar: calendar.id,
          message: problem instanceof Error ? problem.message : 'Nepoznata greška',
        }),
      });
    }
  }

  return json(200, { ok: true, calendars: calendars.length, created, cancelled, failed });
});
