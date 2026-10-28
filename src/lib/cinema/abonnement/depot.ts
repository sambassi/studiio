/**
 * CINEMA IA — LECTURE ET ECRITURE DES FORMULES (`cinema_formules`).
 *
 * N'ecrit QUE dans `cinema_formules`. Jamais dans `plans`, jamais chez Stripe : le prix
 * d'une formule ne change pas d'ici.
 *
 * Migration absente (`2026-11-01-cinema-abonnements.sql` non appliquee) : la lecture le
 * DIT (`disponible: false`) au lieu de rendre une liste vide qui ressemblerait a « rien
 * d'inclus, tout va bien », et l'ecriture est refusee.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { depuisLigne, versLigne, type FormuleCinema, type LigneFormule } from '@/lib/cinema/abonnement/formules';

const TABLE = 'cinema_formules';
const COLONNES = 'plan_key, inclus, films_par_mois, secondes_par_mois, duree_max_film_s, qualites, fonctionnalites, budget_usd_par_mois, renouvellement';

/** Meme reconnaissance que `plafond-compte.ts` : table ou fonction absente du schema. */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const message = (erreur.message ?? '').toLowerCase();
  return erreur.code === '42P01' || erreur.code === 'PGRST205' || erreur.code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

export type LectureFormules =
  | { disponible: true; formules: Map<string, FormuleCinema>; invalides: string[] }
  | { disponible: false; raison: 'migration_absente' | 'erreur'; message: string };

export async function lireFormules(): Promise<LectureFormules> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(COLONNES);
  if (error) {
    return socleAbsent(error)
      ? { disponible: false, raison: 'migration_absente', message: 'migration 2026-11-01-cinema-abonnements.sql non appliquee' }
      : { disponible: false, raison: 'erreur', message: error.message ?? 'lecture impossible' };
  }
  const formules = new Map<string, FormuleCinema>();
  const invalides: string[] = [];
  for (const l of (data ?? []) as LigneFormule[]) {
    const f = depuisLigne(l);
    if (f) formules.set(f.planKey, f); else invalides.push(l.plan_key);
  }
  return { disponible: true, formules, invalides };
}

export async function enregistrerFormule(
  f: FormuleCinema, adminEmail: string,
): Promise<{ ok: true } | { ok: false; raison: 'migration_absente' | 'erreur'; message: string }> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    { ...versLigne(f), maj_le: new Date().toISOString(), maj_par: adminEmail },
    { onConflict: 'plan_key' },
  );
  if (!error) return { ok: true };
  return socleAbsent(error)
    ? { ok: false, raison: 'migration_absente', message: 'migration 2026-11-01-cinema-abonnements.sql non appliquee' }
    : { ok: false, raison: 'erreur', message: error.message ?? 'ecriture impossible' };
}
