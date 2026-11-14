// Traduction CÔTÉ SERVEUR (e-mails, textes produits hors navigateur). Synchrone : les
// catalogues sont importés statiquement — ce module ne va jamais dans le paquet navigateur.
// Même règle que le client : français = base, la langue choisie = surcouche.
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';
import de from '../../../messages/de.json';
import ln from '../../../messages/ln.json';
import wo from '../../../messages/wo.json';
import sw from '../../../messages/sw.json';
import bm from '../../../messages/bm.json';
import bas from '../../../messages/bas.json';
import ht from '../../../messages/ht.json';
import { fusionner, type Messages } from '@/i18n/messages';
import { defaultLocale, intlLocales, normalizeLocale, type Locale } from '@/i18n/config';

const SURCOUCHES: Record<Locale, Messages> = {
  fr: {}, en, de, ln, wo, sw, bm, bas, ht,
} as Record<Locale, Messages>;

/** Surcouche statique d'une langue (catalogue livré avec le code, sans les corrections de l'administration). */
export function surcoucheStatique(locale: unknown): Messages {
  return SURCOUCHES[normalizeLocale(locale)] || {};
}

const cache = new Map<Locale, Messages>();
export function messagesServeur(locale: unknown): Messages {
  const loc = normalizeLocale(locale);
  let m = cache.get(loc);
  if (!m) { m = loc === 'fr' ? (fr as Messages) : fusionner(fr as Messages, SURCOUCHES[loc]); cache.set(loc, m); }
  return m;
}

/** `traducteur('fr', 'email.welcome')('subject', { n })` */
export function traducteur(locale: unknown, namespace: string) {
  const messages = messagesServeur(locale);
  return (cle: string, params?: Record<string, string | number | null | undefined>): string => {
    let cur: unknown = messages;
    for (const p of `${namespace}.${cle}`.split('.')) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
      else return `${namespace}.${cle}`;
    }
    let v = typeof cur === 'string' ? cur : `${namespace}.${cle}`;
    if (params) for (const [k, x] of Object.entries(params)) v = v.replace(new RegExp(`\\{${k}\\}`, 'g'), String(x));
    return v;
  };
}

/** Locale Intl d'une langue (dates, nombres) : une langue partielle garde le format français. */
export const intlDe = (locale: unknown): string => intlLocales[normalizeLocale(locale)] || intlLocales[defaultLocale];

/** Langue enregistrée de l'utilisateur (`user_settings.creator_preferences.locale`), sinon français. */
export async function localeUtilisateur(userId: string | null | undefined): Promise<Locale> {
  if (!userId) return defaultLocale;
  try {
    const { supabaseAdmin } = await import('@/lib/db/supabase');
    const { data } = await supabaseAdmin.from('user_settings').select('creator_preferences').eq('user_id', userId).limit(1);
    const prefs = (data?.[0] as { creator_preferences?: { locale?: unknown } } | undefined)?.creator_preferences;
    return normalizeLocale(prefs?.locale);
  } catch {
    return defaultLocale;
  }
}
