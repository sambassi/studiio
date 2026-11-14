'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { I18nContext } from './client';
import { defaultLocale, normalizeLocale, type Locale } from './config';
import { fusionner, type Messages } from './messages';

// Chargement paresseux : le français (base) puis, seulement si besoin, la surcouche de la langue.
const chargeurs: Record<Locale, () => Promise<Messages>> = {
  fr: () => import('../../messages/fr.json').then((m) => m.default as Messages),
  en: () => import('../../messages/en.json').then((m) => m.default as Messages),
  de: () => import('../../messages/de.json').then((m) => m.default as Messages),
  ln: () => import('../../messages/ln.json').then((m) => m.default as Messages),
  wo: () => import('../../messages/wo.json').then((m) => m.default as Messages),
  sw: () => import('../../messages/sw.json').then((m) => m.default as Messages),
  bm: () => import('../../messages/bm.json').then((m) => m.default as Messages),
  bas: () => import('../../messages/bas.json').then((m) => m.default as Messages),
  ht: () => import('../../messages/ht.json').then((m) => m.default as Messages),
};

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  const cookie = document.cookie.split(';').find((c) => c.trim().startsWith('locale='));
  return normalizeLocale(cookie?.split('=')?.[1]);
}

function storeLocale(locale: Locale) {
  try {
    document.cookie = `locale=${locale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
    document.documentElement.lang = locale;
  } catch { /* cookies bloqués : le choix vaut pour la session */ }
}

/**
 * Mémorise la langue côté serveur (`user_settings.creator_preferences.locale`, fusion sans
 * écraser le reste) pour que les e-mails et reçus partent dans la langue de l'utilisateur.
 * Silencieux : visiteur non connecté (401), réseau coupé ou base absente ne gênent jamais le
 * changement de langue, qui reste immédiat grâce au cookie.
 */
function enregistrerPreference(locale: Locale) {
  try {
    if (typeof fetch !== 'function') return;
    void fetch('/api/user/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    }).catch(() => {});
  } catch { /* ignoré */ }
}

/** Français + surcouche. Si la surcouche échoue à charger : français seul (jamais une page cassée). */
export async function chargerMessages(loc: Locale): Promise<Messages> {
  const base = await chargeurs.fr();
  if (loc === 'fr') return base;
  try {
    return fusionner(base, await chargeurs[loc]());
  } catch {
    return base;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState<Messages>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = getStoredLocale();
    setLocaleState(stored);
    document.documentElement.lang = stored;
    chargerMessages(stored).then((m) => { setMessages(m); setReady(true); });
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    const loc = normalizeLocale(newLocale);
    storeLocale(loc);
    enregistrerPreference(loc);
    // On ne change la langue affichée qu'une fois les textes prêts : pas de mélange à l'écran.
    chargerMessages(loc).then((m) => { setMessages(m); setLocaleState(loc); });
  }, []);

  // Rien n'est rendu avant les textes : évite le flash de clés brutes.
  if (!ready) return null;

  return (
    <I18nContext.Provider value={{ locale, messages, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}
