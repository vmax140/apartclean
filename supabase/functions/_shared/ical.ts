// Čitanje iCal izvoza iz Booking-a i Airbnb-a (SPEC sekcija 6, korak 1).
//
// Namerno bez biblioteke: treba nam svega nekoliko polja iz VEVENT blokova, a
// svaka zavisnost ovde znači i zavisnost u Edge Function-u (pravilo iz CLAUDE.md).
// Fajl je čist TypeScript bez Deno API-ja, pa ga testovi uvoze direktno.

export type IcalEvent = {
  uid: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  summary: string | null;
};

/** iCal prelama duge redove tako što nastavak počinje razmakom ili tabulatorom. */
function unfold(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** DTSTART;VALUE=DATE:20261215 i DTSTART:20261215T100000Z → 2026-12-15 */
function toDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

export function parseIcal(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of unfold(text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current?.uid && current.checkIn && current.checkOut) {
        events.push({
          uid: current.uid,
          checkIn: current.checkIn,
          checkOut: current.checkOut,
          summary: current.summary ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = trimmed.indexOf(':');
    if (separator < 0) continue;
    const name = trimmed.slice(0, separator).split(';')[0]!.toUpperCase();
    const value = trimmed.slice(separator + 1);

    if (name === 'UID') current.uid = value;
    else if (name === 'DTSTART') current.checkIn = toDate(value) ?? undefined;
    else if (name === 'DTEND') current.checkOut = toDate(value) ?? undefined;
    else if (name === 'SUMMARY') current.summary = value;
  }

  // Rezervacija koja se završava pre nego što počne je greška u izvozu, ne podatak.
  return events.filter((event) => event.checkOut > event.checkIn);
}
