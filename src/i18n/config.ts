/**
 * LANGUES DE STUDIIO.
 *
 * Trois langues complètes (fr, en, de) et six langues PARTIELLES reprises des
 * codes et des endonymes du catalogue afroboost. Deux garde-fous :
 *
 *  1. UNE CLÉ MANQUANTE RETOMBE SUR LE FRANÇAIS, elle n'affiche jamais son
 *     chemin technique (`src/i18n/fusion.ts`). C'est ce qui rend une langue
 *     partielle utilisable au lieu d'être cassée.
 *  2. UNE LANGUE PARTIELLE N'EST PAS PROPOSÉE DANS LE SÉLECTEUR tant qu'elle
 *     n'atteint pas `SEUIL_AFFICHAGE_LANGUE`. Offrir « Wolof » pour afficher
 *     du français serait une promesse non tenue ; la langue apparaît d'elle-
 *     même dès que les traductions arrivent, sans changer une ligne de code.
 *
 * Les six catalogues ne contiennent QUE des termes relus, repris d'afroboost.
 * Rien n'y est traduit par approximation : le reste attend un locuteur natif.
 */
export const locales = ['fr', 'en', 'de', 'wo', 'ln', 'sw', 'bm', 'bas', 'ht'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fr';

/** Langues dont le catalogue est tenu pour complet. */
export const languesCompletes: readonly Locale[] = ['fr', 'en', 'de'];

/** Part des clés traduites à partir de laquelle une langue est proposée. */
export const SEUIL_AFFICHAGE_LANGUE = 0.6;

/**
 * Les langues RÉELLEMENT proposées dans le sélecteur. Une langue déclarée mais
 * absente d'ici est chargeable et fonctionnelle (repli français par clé) —
 * simplement pas encore offerte, parce qu'elle n'atteint pas
 * `SEUIL_AFFICHAGE_LANGUE`.
 *
 * La couverture ne se calcule pas ici : importer les neuf catalogues dans la
 * configuration les ferait entrer dans le bundle client. C'est un TEST qui
 * tient la règle (`i18n-langues.test.ts`) : il refuse une langue proposée
 * sous le seuil, et signale une langue qui l'a dépassé sans être ajoutée.
 */
export const localesProposees: readonly Locale[] = ['fr', 'en', 'de'];

export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  wo: 'Wolof',
  ln: 'Lingála',
  sw: 'Kiswahili',
  bm: 'Bamanankan',
  bas: 'Bàsàa',
  ht: 'Kreyòl ayisyen',
};

export const localeFlags: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧',
  de: '🇩🇪',
  wo: '🇸🇳',
  ln: '🇨🇩',
  sw: '🇰🇪',
  bm: '🇲🇱',
  bas: '🇨🇲',
  ht: '🇭🇹',
};

/**
 * Code ISO 639-3 et désignation détaillée. Sert à lever l'ambiguïté d'un code
 * à deux lettres auprès d'un service de traduction : « bas » seul ne désigne
 * rien, « bàsàa (basaa), langue bantoue A43 du Cameroun » si.
 */
export const localeIso639_3: Partial<Record<Locale, string>> = {
  wo: 'wol', ln: 'lin', sw: 'swa', bm: 'bam', bas: 'bas', ht: 'hat',
};

/**
 * Étiquette de locale pour les dates, les nombres et les montants. Une langue
 * sans variante régionale normalisée emprunte celle de sa région d'usage :
 * mieux vaut un format régional juste qu'un format par défaut anglophone.
 */
export const localeIntl: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  de: 'de-DE',
  wo: 'fr-SN',
  ln: 'fr-CD',
  sw: 'sw-KE',
  bm: 'fr-ML',
  bas: 'fr-CM',
  ht: 'fr-HT',
};
