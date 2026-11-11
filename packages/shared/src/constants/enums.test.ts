import { describe, expect, it } from 'vitest';
import { APP_ROLES, ROOM_TYPES, TASK_STATUSES } from './enums';
import { ACTIVE_TASK_STATUSES, TASK_STATUS_TONE, isTaskStatus } from './task-status';
import { DICTIONARIES, LOCALES, pluralForm, t } from '../i18n/index';

// Ove liste su prepisane iz docs/SPEC.md, sekcija 3. Ako migracija u Fazi 1A
// odstupi od njih, ovaj test puca pre nego što greška stigne u aplikaciju.
const SPEC_TASK_STATUSES = [
  'draft',
  'open',
  'offered',
  'accepted',
  'in_progress',
  'submitted',
  'needs_fixes',
  'ready',
  'completed',
  'disputed',
  'cancelled',
  'expired',
];

describe('enum konstante prate SPEC sekciju 3', () => {
  it('task_status ima tačno 12 vrednosti iz specifikacije', () => {
    expect([...TASK_STATUSES]).toEqual(SPEC_TASK_STATUSES);
  });

  it('app_role ima vlasnika, spremača i admina', () => {
    expect([...APP_ROLES]).toEqual(['owner', 'cleaner', 'admin']);
  });

  it('isTaskStatus odbija vrednost koja nije u enumu', () => {
    expect(isTaskStatus('ready')).toBe(true);
    expect(isTaskStatus('spreman')).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
  });
});

describe('boje statusa', () => {
  it('svaki status ima boju (SPEC sekcija 7: status uvek bojom i rečju)', () => {
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_TONE[status]).toBeDefined();
    }
  });

  it('spreman i završen su zeleni, problemi crveni', () => {
    expect(TASK_STATUS_TONE.ready).toBe('ready');
    expect(TASK_STATUS_TONE.completed).toBe('ready');
    expect(TASK_STATUS_TONE.needs_fixes).toBe('problem');
    expect(TASK_STATUS_TONE.disputed).toBe('problem');
  });

  it('aktivni statusi ne sadrže zatvorene', () => {
    for (const closed of ['draft', 'completed', 'cancelled', 'expired'] as const) {
      expect(ACTIVE_TASK_STATUSES).not.toContain(closed);
    }
  });
});

describe('i18n', () => {
  it('svi jezici imaju iste ključeve', () => {
    const reference = Object.keys(DICTIONARIES['sr-Latn']).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort(), `jezik ${locale}`).toEqual(reference);
    }
  });

  it('svaki status zadatka i tip sobe ima prevod na oba jezika', () => {
    for (const locale of LOCALES) {
      for (const status of TASK_STATUSES) {
        expect(t(`taskStatus.${status}`, locale)).not.toBe('');
      }
      for (const room of ROOM_TYPES) {
        expect(t(`roomType.${room}`, locale)).not.toBe('');
      }
    }
  });

  it('podrazumevani jezik je srpski latinica', () => {
    expect(t('taskStatus.ready')).toBe('Spreman za goste');
    expect(t('taskStatus.ready', 'en')).toBe('Ready for guests');
  });
});

describe('množina (srpski ima tri oblika uz broj)', () => {
  it('bira oblik po poslednjoj cifri', () => {
    expect(pluralForm(1)).toBe('one');
    expect(pluralForm(21)).toBe('one');
    expect(pluralForm(2)).toBe('few');
    expect(pluralForm(4)).toBe('few');
    expect(pluralForm(23)).toBe('few');
    expect(pluralForm(5)).toBe('other');
    expect(pluralForm(0)).toBe('other');
  });

  it('jedanaest i dvanaest su izuzeci', () => {
    expect(pluralForm(11)).toBe('other');
    expect(pluralForm(12)).toBe('other');
    expect(pluralForm(14)).toBe('other');
    expect(pluralForm(111)).toBe('other');
  });

  it('engleski ima samo jedninu i množinu', () => {
    expect(pluralForm(1, 'en')).toBe('one');
    expect(pluralForm(2, 'en')).toBe('other');
    expect(pluralForm(3, 'en')).toBe('other');
  });

  it('svaki oblik ima prevod na oba jezika', () => {
    for (const locale of LOCALES) {
      for (const form of ['one', 'few', 'other'] as const) {
        expect(t(`property.rooms.${form}`, locale, { broj: 3 })).toContain('3');
      }
    }
  });
});
