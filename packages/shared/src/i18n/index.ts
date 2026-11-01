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
