'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { I18nContext } from './client';
import { defaultLocale, locales, type Locale } from './config';

// Lazy-load messages
const messageLoaders: Record<Locale, () => Promise<Record<string, unknown>>> = {
  fr: () => import('../../messages/fr.json').then(m => m.default),
  en: () => import('../../messages/en.json').then(m => m.default),
  de: () => import('../../messages/de.json').then(m => m.default),
};

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  const cookie = document.cookie.split(';').find(c => c.trim().startsWith('locale='));
  const stored = cookie?.split('=')?.[1]?.trim();
  if (stored && locales.includes(stored as Locale)) return stored as Locale;
  return defaultLocale;
}

function storeLocale(locale: Locale) {
  document.cookie = `locale=${locale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
  document.documentElement.lang = locale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState<Record<string, unknown>>({});
  const [ready, setReady] = useState(false);

  const loadMessages = useCallback(async (loc: Locale) => {
    try {
      const msgs = await messageLoaders[loc]();
      setMessages(msgs);
    } catch {
      // Fallback to French if load fails
      if (loc !== 'fr') {
        const msgs = await messageLoaders.fr();
        setMessages(msgs);
      }
    }
  }, []);

  // Initialize from cookie on mount
  useEffect(() => {
    const stored = getStoredLocale();
    setLocaleState(stored);
    loadMessages(stored).then(() => setReady(true));
  }, [loadMessages]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    storeLocale(newLocale);
    loadMessages(newLocale);
  }, [loadMessages]);

  // Don't render children until messages are loaded to avoid flash
  if (!ready) {
    return null;
  }

  return (
    <I18nContext.Provider value={{ locale, messages, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}
