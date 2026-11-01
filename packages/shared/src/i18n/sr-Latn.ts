// Srpski, latinica — podrazumevani jezik (SPEC sekcija 1).
// Ovaj rečnik je referentni: tip Dictionary se izvodi iz njega, pa svaki drugi jezik
// mora imati tačno iste ključeve ili typecheck pada.

export const srLatn = {
  'app.name': 'ApartClean',
  'app.tagline': 'Čisto na vreme, svaki put.',
  'app.description':
    'Povezujemo vlasnike apartmana na Kopaoniku i Zlatiboru sa verifikovanim spremačima.',

  'common.save': 'Sačuvaj',
  'common.cancel': 'Otkaži',
  'common.next': 'Dalje',
  'common.back': 'Nazad',
  'common.loading': 'Učitavanje…',
  'common.error': 'Došlo je do greške',
  'common.retry': 'Pokušaj ponovo',
  'common.yes': 'Da',
  'common.no': 'Ne',

  'role.owner': 'Vlasnik',
  'role.cleaner': 'Spremačica',
  'role.admin': 'Administrator',

  'taskStatus.draft': 'Nacrt',
  'taskStatus.open': 'Otvoren',
  'taskStatus.offered': 'Ponuđen',
  'taskStatus.accepted': 'Prihvaćen',
  'taskStatus.in_progress': 'U toku',
  'taskStatus.submitted': 'Predat',
  'taskStatus.needs_fixes': 'Treba ispravka',
  'taskStatus.ready': 'Spreman za goste',
  'taskStatus.completed': 'Završen',
  'taskStatus.disputed': 'Spor',
  'taskStatus.cancelled': 'Otkazan',
  'taskStatus.expired': 'Istekao',

  'taskType.turnover': 'Priprema za goste',
  'taskType.deep_clean': 'Generalno čišćenje',
  'taskType.linen_only': 'Samo posteljina',
  'taskType.inspection': 'Pregled',

  'roomType.bedroom': 'Spavaća soba',
  'roomType.bathroom': 'Kupatilo',
  'roomType.kitchen': 'Kuhinja',
  'roomType.living_room': 'Dnevna soba',
  'roomType.hallway': 'Hodnik',
  'roomType.balcony': 'Balkon',
  'roomType.other': 'Ostalo',
} as const;

export type TranslationKey = keyof typeof srLatn;
export type Dictionary = Record<TranslationKey, string>;
