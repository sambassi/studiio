'use client';

import { createContext, useContext } from 'react';
import { intlLocales, type Locale } from './config';
import { empreinteLibelle } from './messages';

type Messages = Record<string, unknown>;

interface I18nContextType {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
}

// Textes de REPLI (arbre `ui.*` seulement) quand aucun fournisseur n'entoure le composant
// (rendu isolé, tests) : injectés par l'appelant, jamais importés ici — le catalogue français
// ne doit pas entrer dans le paquet principal. En production, le fournisseur fournit déjà
// français + surcouche.
let messagesDeRepli: Messages = {};
export function definirMessagesDeRepli(m: Messages): void { messagesDeRepli = m; }

export const I18nContext = createContext<I18nContextType>({
  locale: 'fr',
  messages: {},
  setLocale: () => {},
});

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useContext(I18nContext).setLocale;
}

/**
 * useTranslations('namespace') — returns a t() function scoped to that namespace.
 * Supports nested keys with dot notation: t('hero.title')
 * Supports interpolation: t('greeting', { name: 'John' }) → "Hello John"
 */
export function useTranslations(namespace?: string) {
  const ctx = useContext(I18nContext);
  const messages = ctx.messages;
  const locale = ctx.locale;
  // L'identité de `t` ne change QUE si la langue (donc les textes) ou le namespace change :
  // elle peut figurer sans risque dans les dépendances d'un useMemo / useCallback / useEffect.
  // ⚠️ PAS de `useMemo` ici : `useTranslations` n'emploie que `useContext`, qui n'occupe aucun
  // emplacement de hook ; certains composants l'appellent après un retour anticipé, ce qui ne
  // se voyait pas. Un vrai hook ferait planter ces composants (« Rendered more hooks… »). Le
  // cache est donc un WeakMap hors React : même résultat, aucune contrainte d'ordre.
  return traducteurStable(messages, namespace, locale);
}

const CACHE_T = new WeakMap<object, Map<string, ReturnType<typeof fabriquerT>>>();
function traducteurStable(messages: Messages, namespace: string | undefined, locale: Locale) {
  let parNs = CACHE_T.get(messages);
  if (!parNs) { parNs = new Map(); CACHE_T.set(messages, parNs); }
  const cle = `${namespace ?? ''}|${locale}`;
  let t = parNs.get(cle);
  if (!t) { t = fabriquerT(messages, namespace, locale); parNs.set(cle, t); }
  return t;
}

function fabriquerT(messages: Messages, namespace: string | undefined, locale: Locale) {

  function getNestedValue(obj: unknown, path: string): string {
    const keys = path.split('.');
    let current: unknown = obj;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return path; // fallback: return key itself
      }
    }
    return typeof current === 'string' ? current : path;
  }

  function t(key: string, params?: Record<string, string | number | null | undefined>): string {
    const fullPath = namespace ? `${namespace}.${key}` : key;
    let value = getNestedValue(messages, fullPath);
    // Rendu sans fournisseur (tests) : les clés de l'arbre `ui.*` — celles issues de la
    // conversion du texte en dur — retombent sur le français d'origine. Les anciennes clés
    // gardent leur comportement historique (renvoyer la clé), dont des tests dépendent.
    if (value === fullPath && fullPath.startsWith('ui.')) {
      const repli = getNestedValue(messagesDeRepli, fullPath);
      if (repli !== fullPath) value = repli;
    }

    // If not found with namespace, try without
    if (value === fullPath && namespace) {
      value = getNestedValue(messages, key);
      if (value === key) value = fullPath; // still not found
    }

    // Interpolation: replace {param} with values
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }

    return value;
  }

  /**
   * `t.fr('Texte français')` : traduit un LIBELLÉ qui vit dans une constante (liste d'offres,
   * étapes, thèmes…) en le cherchant par son texte exact dans `ui.libelles`. Sans entrée, il
   * RENVOIE LE TEXTE TEL QUEL : un contenu de l'utilisateur ne peut donc pas être altéré.
   */
  t.fr = (texte: unknown): string => {
    if (typeof texte !== 'string') return texte as unknown as string;
    const cle = `ui.libelles.${empreinteLibelle(texte)}`;
    let v = getNestedValue(messages, cle);
    if (v === cle) v = getNestedValue(messagesDeRepli, cle);
    return v === cle || !v ? texte : v;
  };

  /**
   * `t.pluriel(mot, n)` : le « s » du pluriel français n'existe pas dans les autres langues
   * (« Scheduleds » n'est pas de l'anglais). N'ajoute le « s » qu'en français, et seulement si n > 1.
   */
  t.pluriel = (mot: string, n: number): string => (locale === 'fr' && n > 1 ? `${mot}s` : mot);

  return t;
}

/**
 * Format a date according to the current locale
 */
export function useFormattedDate() {
  const { locale } = useContext(I18nContext);

  return (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString(intlLocales[locale] || 'fr-FR', options || {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };
}

/**
 * Format a number according to the current locale
 */
export function useFormattedNumber() {
  const { locale } = useContext(I18nContext);

  return (num: number, options?: Intl.NumberFormatOptions): string => {
    return num.toLocaleString(intlLocales[locale] || 'fr-FR', options);
  };
}
