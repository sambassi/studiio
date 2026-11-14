'use client';

import { createContext, useContext } from 'react';
import { intlLocales, type Locale } from './config';

type Messages = Record<string, unknown>;

interface I18nContextType {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
}

// Textes de REPLI quand aucun fournisseur n'entoure le composant (rendu isolé, tests) :
// injectés par l'appelant, jamais importés ici — le catalogue français ne doit pas entrer
// dans le paquet principal. En production, le fournisseur fournit déjà français + surcouche.
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
  const messages = Object.keys(ctx.messages).length ? ctx.messages : messagesDeRepli;

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

  function t(key: string, params?: Record<string, string | number>): string {
    const fullPath = namespace ? `${namespace}.${key}` : key;
    let value = getNestedValue(messages, fullPath);

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
