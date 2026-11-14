// Les neuf langues de Studiio. Les CODES sont techniques et stables (cookie `locale`,
// noms de fichiers `messages/<code>.json`) : ne jamais les renommer.
export const locales = ['fr', 'en', 'de', 'ln', 'wo', 'sw', 'bm', 'bas', 'ht'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fr';

export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  ln: 'Lingála',
  wo: 'Wolof',
  sw: 'Kiswahili',
  bm: 'Bamanankan',
  bas: 'Bàsàa (Bassa)',
  ht: 'Kreyòl ayisyen',
};

/** Sigle court affiché dans le bouton : BA pour le bàsàa (code `bas`), CR pour le créole (code `ht`). */
export const localeBadges: Record<Locale, string> = {
  fr: 'FR', en: 'EN', de: 'DE', ln: 'LN', wo: 'WO', sw: 'SW', bm: 'BM', bas: 'BA', ht: 'CR',
};

/**
 * Honnêteté sur la couverture :
 *  - `source`   : langue d'origine du produit.
 *  - `complete` : interface entièrement traduite.
 *  - `draft`    : interface entièrement traduite mais PAS relue par un locuteur natif (bêta).
 *  - `partial`  : vocabulaire de base seulement ; le reste s'affiche en français.
 */
export type LocaleStatus = 'source' | 'complete' | 'draft' | 'partial';
export const localeStatus: Record<Locale, LocaleStatus> = {
  fr: 'source', en: 'complete', de: 'complete',
  sw: 'draft', ht: 'draft',
  ln: 'partial', wo: 'partial', bm: 'partial', bas: 'partial',
};

/** Locale Intl pour les dates et nombres. Une langue partielle garde le format français :
 *  la phrase autour l'est aussi, et une date mélangée prête à confusion. */
export const intlLocales: Record<Locale, string> = {
  fr: 'fr-FR', en: 'en-GB', de: 'de-DE',
  sw: 'sw-KE', ht: 'ht-HT',
  ln: 'fr-FR', wo: 'fr-FR', bm: 'fr-FR', bas: 'fr-FR',
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (locales as readonly string[]).includes(v);
}

/** Ramène toute valeur (casse, sigle visible BA/CR, « fr-CH ») à un code valide ; sinon le français. */
export function normalizeLocale(v: unknown): Locale {
  if (typeof v !== 'string') return defaultLocale;
  const s = v.trim().toLowerCase();
  if (s === 'ba') return 'bas';
  if (s === 'cr') return 'ht';
  if (isLocale(s)) return s;
  const base = s.split(/[-_]/)[0];
  return isLocale(base) ? base : defaultLocale;
}
