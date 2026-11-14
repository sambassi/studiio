// Stockage des corrections de traductions dans `app_settings` (clé `i18n_overrides_<langue>`) :
// le magasin clé/valeur déjà utilisé par les CGU, la landing et les réglages — AUCUNE migration.
//
// Règles du dépôt reprises ici :
//  - colonnes réelles : key, value, updated_at (pas d'auteur : il va dans `audit_log`) ;
//  - JAMAIS d'écriture après une lecture en échec : fusionner dans `{}` effacerait toutes les corrections ;
//  - jamais de « succès » si l'écriture a échoué.
import { supabaseAdmin } from '@/lib/db/supabase';
import { isLocale, type Locale } from '@/i18n/config';
import { aplatir, type Messages } from '@/i18n/messages';
import { surcoucheStatique } from '@/lib/i18n/serveur';
import fr from '../../../messages/fr.json';
import metaLn from '../../../messages/meta/ln.json';
import metaWo from '../../../messages/meta/wo.json';
import metaBm from '../../../messages/meta/bm.json';
import metaBas from '../../../messages/meta/bas.json';
import { cleStockage, compter, construireLignes, type Compteurs, type Corrections, type Ligne, type Meta } from '@/lib/i18n/traductions';

const META: Partial<Record<Locale, Meta>> = { ln: metaLn as Meta, wo: metaWo as Meta, bm: metaBm as Meta, bas: metaBas as Meta };
export const frAplati: Record<string, string> = aplatir(fr as Messages);

/** Langues dont les textes se corrigent dans l'administration : toutes sauf le français (la source). */
export function langueEditable(v: unknown): v is Locale {
  return isLocale(v) && v !== 'fr';
}

export async function lireCorrections(locale: Locale): Promise<{ ok: boolean; corrections: Corrections }> {
  try {
    // ⚠️ PAS de `.maybeSingle()` : PostgREST répond 406 (PGRST116) quand il n'y a AUCUNE ligne, ce que
    // ce code prendrait pour une panne — la page admin aurait affiché « base indisponible » tant
    // qu'aucune correction n'existait. Un tableau + `limit(1)` distingue « aucune ligne » (ok) d'une
    // vraie panne (erreur). Constaté sur une vraie base PostgreSQL + PostgREST, pas dans un mock.
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', cleStockage(locale)).limit(1);
    if (error) return { ok: false, corrections: {} };
    const brut = (data as Array<{ value?: unknown }> | null)?.[0]?.value;
    if (!brut) return { ok: true, corrections: {} };
    const obj = typeof brut === 'string' ? JSON.parse(brut) : brut;
    const entrees = obj && typeof obj === 'object' && obj.entrees && typeof obj.entrees === 'object' ? obj.entrees : {};
    const corrections: Corrections = {};
    for (const [k, e] of Object.entries(entrees as Record<string, unknown>)) {
      const x = e as { t?: unknown; v?: unknown; par?: unknown; le?: unknown };
      if (typeof x?.t === 'string' && k in frAplati) corrections[k] = { t: x.t, v: x.v === true, par: typeof x.par === 'string' ? x.par : undefined, le: typeof x.le === 'string' ? x.le : undefined };
    }
    return { ok: true, corrections };
  } catch {
    return { ok: false, corrections: {} };
  }
}

export async function ecrireCorrections(locale: Locale, corrections: Corrections): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('app_settings').upsert({
      key: cleStockage(locale),
      value: JSON.stringify({ version: 1, entrees: corrections }),
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export function tableTraductions(locale: Locale, corrections: Corrections): { lignes: Ligne[]; compteurs: Compteurs } {
  const lignes = construireLignes({ fr: frAplati, statique: aplatir(surcoucheStatique(locale)), meta: META[locale], corrections });
  return { lignes, compteurs: compter(lignes) };
}
