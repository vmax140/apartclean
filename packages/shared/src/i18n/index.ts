import { srLatn, type Dictionary, type TranslationKey } from './sr-Latn';
import { en } from './en';

export type { Dictionary, TranslationKey };

export const LOCALES = ['sr-Latn', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Podrazumevani jezik je srpski latinica (SPEC sekcija 1, pravilo iz CLAUDE.md). */
export const DEFAULT_LOCALE: Locale = 'sr-Latn';

export const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = {
  'sr-Latn': srLatn,
  en,
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Prevod po ključu. Nepoznat jezik pada na podrazumevani.
 * Zamena u tekstu: t('neki.kljuc', 'sr-Latn', { ime: 'Ana' }) menja {ime}.
 */
export function t(
  key: TranslationKey,
  locale: Locale = DEFAULT_LOCALE,
  params?: Readonly<Record<string, string | number>>,
): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const text = dictionary[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Vezuje jezik jednom, pa se dalje zove samo sa ključem. */
export function createTranslator(locale: Locale) {
  return (key: TranslationKey, params?: Readonly<Record<string, string | number>>) =>
    t(key, locale, params);
}

/**
 * Srpski ima tri oblika uz broj: 1 soba, 2–4 sobe, 5+ soba.
 * Engleski koristi 'one' i 'other', pa 'few' pada na 'other'.
 */
export type PluralForm = 'one' | 'few' | 'other';

export function pluralForm(count: number, locale: Locale = DEFAULT_LOCALE): PluralForm {
  if (locale === 'en') return count === 1 ? 'one' : 'other';
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'other';
}
