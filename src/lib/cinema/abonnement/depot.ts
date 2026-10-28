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

// ─────────────────────────────────────────────────────────────────────────
// CONSOMMATION ET RESERVATION
// ─────────────────────────────────────────────────────────────────────────

export interface LectureConsommation {
  films: number; secondes: number; usdEngages: number; tentatives: number;
  /** Le film est-il deja compte dans la periode, et pour combien de secondes ? */
  film: { compte: boolean; secondes: number };
}

/** `null` = illisible : l'appelant refuse, il ne suppose jamais un compteur vide. */
export async function lireConsommation(userId: string, periodeDebut: string, filmId: string): Promise<LectureConsommation | null> {
  const [c, j] = await Promise.all([
    supabaseAdmin.from('cinema_quota_consommation').select('films, secondes, usd_engages, tentatives')
      .eq('user_id', userId).eq('periode_debut', periodeDebut),
    supabaseAdmin.from('cinema_quota_journal').select('nouveau_film, secondes, statut')
      .eq('user_id', userId).eq('periode_debut', periodeDebut).eq('film_id', filmId),
  ]);
  if (c.error || j.error) return null;
  const l = ((c.data ?? []) as Array<Record<string, unknown>>)[0];
  const actives = ((j.data ?? []) as Array<{ nouveau_film: boolean; secondes: number; statut: string }>)
    .filter((r) => r.statut !== 'liberee');
  return {
    films: Number(l?.films ?? 0), secondes: Number(l?.secondes ?? 0),
    usdEngages: Number(l?.usd_engages ?? 0), tentatives: Number(l?.tentatives ?? 0),
    film: { compte: actives.some((r) => r.nouveau_film), secondes: actives.reduce((t, r) => t + Number(r.secondes), 0) },
  };
}

export type MotifReservationQuota =
  | 'films_epuises' | 'minutes_epuisees' | 'budget_fournisseur_atteint' | 'reference_liberee'
  | 'periode_invalide' | 'socle_absent' | 'erreur' | string;

export async function reserverQuota(p: {
  userId: string; periodeDebut: string; periodeFin: string; reference: string; filmId: string;
  dureeFilmS: number; usd: number; maxFilms: number; maxSecondes: number; maxUsd: number;
}): Promise<{ ok: true; dejaReservee: boolean } | { ok: false; motif: MotifReservationQuota }> {
  const { data, error } = await supabaseAdmin.rpc('reserver_quota_cinema', {
    p_user_id: p.userId, p_periode_debut: p.periodeDebut, p_periode_fin: p.periodeFin,
    p_reference: p.reference, p_film_id: p.filmId, p_duree_film_s: p.dureeFilmS, p_usd: p.usd,
    p_max_films: p.maxFilms, p_max_secondes: p.maxSecondes, p_max_usd: p.maxUsd,
  });
  if (error) return { ok: false, motif: socleAbsent(error) ? 'socle_absent' : 'erreur' };
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; motif?: string | null; deja_reservee?: boolean } | null;
  if (!r || typeof r.ok !== 'boolean') return { ok: false, motif: 'erreur' };
  return r.ok ? { ok: true, dejaReservee: r.deja_reservee === true } : { ok: false, motif: r.motif ?? 'erreur' };
}

export type StatutQuota = 'confirmee' | 'incertaine' | 'liberee';

/**
 * Best-effort pour l'appelant, mais l'issue est DITE : une reservation non soldee reste
 * comptee. `motif: 'transport'` = la base n'a pas repondu (a retenter) ; `deja_finalisee`
 * = une issue definitive existe deja (rien a refaire).
 */
export async function confirmerQuota(
  userId: string, reference: string, statut: StatutQuota,
): Promise<{ ok: boolean; motif: string | null }> {
  const { data, error } = await supabaseAdmin.rpc('confirmer_quota_cinema', {
    p_user_id: userId, p_reference: reference, p_statut: statut,
  });
  if (error) return { ok: false, motif: 'transport' };
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; motif?: string | null } | null;
  return { ok: r?.ok === true, motif: r?.motif ?? (r ? null : 'transport') };
}

/** Reserve avant le rendu final l'ajustement des minutes sur la duree du film. */
export async function reserverProduction(p: {
  userId: string; periodeDebut: string; reference: string; filmId: string; dureeS: number; maxSecondes: number;
}): Promise<{ ok: true; concerne: boolean } | { ok: false; motif: string }> {
  const { data, error } = await supabaseAdmin.rpc('reserver_production_cinema', {
    p_user_id: p.userId, p_periode_debut: p.periodeDebut, p_reference: p.reference,
    p_film_id: p.filmId, p_duree_s: p.dureeS, p_max_secondes: p.maxSecondes,
  });
  if (error) return { ok: false, motif: socleAbsent(error) ? 'socle_absent' : 'erreur' };
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; motif?: string | null; concerne?: boolean } | null;
  if (!r || typeof r.ok !== 'boolean') return { ok: false, motif: 'erreur' };
  return r.ok ? { ok: true, concerne: r.concerne === true } : { ok: false, motif: r.motif ?? 'erreur' };
}

/** Regle les minutes sur la duree REELLEMENT produite (jamais au-dela de la reserve). */
export async function finaliserProduction(userId: string, reference: string, dureeReelleS: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('finaliser_production_cinema', {
    p_user_id: userId, p_reference: reference, p_duree_reelle: dureeReelleS,
  });
  if (error) return false;
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean } | null;
  return r?.ok === true;
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
