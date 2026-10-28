/**
 * CINEMA IA — QUOTAS MENSUELS D'UNE FORMULE : la DECISION, sans effet de bord.
 *
 * Ce module dit si une operation est COUVERTE par l'abonnement. Il ne reserve rien :
 * la reservation atomique (deux generations simultanees ne peuvent pas depasser le
 * quota) vit dans la base, `reserver_quota_cinema` (migration
 * `2026-11-01-cinema-abonnements.sql`), qui recoit les limites calculees ici.
 *
 * DEUX REGIMES, JAMAIS MELANGES :
 *   - `cout_reel` (administrateur) : aucun quota, aucun credit, aucune marge. Il paie le
 *     prix fournisseur, et seulement lui — mais les plafonds de depense par compte et
 *     global (`plafond-compte.ts`) s'appliquent toujours ;
 *   - `abonnement` (utilisateur) : l'operation doit tenir dans la formule (films,
 *     minutes de film final, duree d'un film, qualite, fonctionnalites, budget
 *     fournisseur du mois). Ce qui n'y tient pas est REFUSE, avec son motif — jamais
 *     servi « a credit » ni bascule en silence sur les credits.
 */
import type { NiveauQualite } from '@/lib/cinema/types';
import type { FonctionnaliteCinema, FormuleCinema, Renouvellement } from '@/lib/cinema/abonnement/formules';

export type RegimeFacturation = 'cout_reel' | 'abonnement';

export interface Periode { debut: string; fin: string }

export interface Consommation {
  films: number;
  secondes: number;
  usdEngages: number;
  /** Generations payantes tentees (premieres et regenerations) : information, pas quota. */
  tentatives: number;
}

export const CONSOMMATION_VIDE: Consommation = { films: 0, secondes: 0, usdEngages: 0, tentatives: 0 };

/**
 * La periode de quota en cours. `periode_abonnement` suit la periode Stripe de
 * l'abonnement ; si elle est inconnue, on ne DEVINE pas une periode — `null`, et
 * l'appelant refuse.
 */
export function periodeQuota(
  renouvellement: Renouvellement,
  abonnement: { debut?: string | null; fin?: string | null } | null,
  maintenant: Date,
): Periode | null {
  if (renouvellement === 'mois_civil') {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    const f = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
    return { debut: d.toISOString(), fin: f.toISOString() };
  }
  const debut = abonnement?.debut ? Date.parse(abonnement.debut) : NaN;
  const fin = abonnement?.fin ? Date.parse(abonnement.fin) : NaN;
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null;
  const t = maintenant.getTime();
  if (t < debut || t >= fin) return null; // periode echue : le renouvellement n'est pas encore connu
  return { debut: new Date(debut).toISOString(), fin: new Date(fin).toISOString() };
}

export interface DemandeQuota {
  /** Le film est-il deja compte dans la periode ? Si non, il consomme un film. */
  filmDejaCompte: boolean;
  /** Secondes de film final a AJOUTER (duree du film, ou allongement d'un film deja compte). */
  secondesAjoutees: number;
  /** Duree TOTALE du film apres l'operation. */
  dureeFilmS: number;
  qualite: NiveauQualite;
  fonctionnalite: FonctionnaliteCinema;
  /** Estimation fournisseur de CETTE operation, en USD. Obligatoire et > 0 pour un appel payant. */
  usdEstime: number;
}

export type MotifRefusQuota =
  | 'non_inclus' | 'estimation_invalide' | 'qualite_non_incluse' | 'fonctionnalite_non_incluse'
  | 'film_trop_long' | 'films_epuises' | 'minutes_epuisees' | 'budget_fournisseur_atteint'
  | 'demande_invalide';

export interface LimitesReservation { maxFilms: number; maxSecondes: number; maxUsd: number }

export type DecisionQuota =
  | { ok: true; regime: 'cout_reel' }
  | { ok: true; regime: 'abonnement'; limites: LimitesReservation; apres: Consommation }
  | { ok: false; motif: MotifRefusQuota; message: string };

const MESSAGES: Record<MotifRefusQuota, string> = {
  non_inclus: 'Cinema IA n’est pas inclus dans votre abonnement.',
  estimation_invalide: 'Le cout de cette generation n’a pas pu etre estime : rien n’est lance.',
  qualite_non_incluse: 'Cette qualite n’est pas incluse dans votre abonnement.',
  fonctionnalite_non_incluse: 'Cette fonctionnalite n’est pas incluse dans votre abonnement.',
  film_trop_long: 'Ce film depasse la duree maximale autorisee par votre abonnement.',
  films_epuises: 'Vous avez utilise tous les films inclus ce mois-ci.',
  minutes_epuisees: 'Vous avez utilise toutes les minutes incluses ce mois-ci.',
  budget_fournisseur_atteint: 'Le budget de generation inclus ce mois-ci est atteint.',
  demande_invalide: 'Demande invalide.',
};

const refus = (motif: MotifRefusQuota): DecisionQuota => ({ ok: false, motif, message: MESSAGES[motif] });
const arrondiUsd = (x: number) => Math.round(x * 10_000) / 10_000;

export function decider(args: {
  regime: RegimeFacturation;
  formule: FormuleCinema | null;
  consommation: Consommation;
  demande: DemandeQuota;
}): DecisionQuota {
  const { regime, formule, consommation: c, demande: d } = args;

  // Valable pour TOUS, administrateur compris : on ne lance jamais un appel au prix inconnu.
  if (!Number.isFinite(d.usdEstime) || d.usdEstime <= 0) return refus('estimation_invalide');
  if (regime === 'cout_reel') return { ok: true, regime: 'cout_reel' };

  if (!formule || !formule.inclus) return refus('non_inclus');
  if (!Number.isInteger(d.secondesAjoutees) || d.secondesAjoutees < 0
    || !Number.isFinite(d.dureeFilmS) || d.dureeFilmS <= 0) return refus('demande_invalide');
  if (!formule.qualites.includes(d.qualite)) return refus('qualite_non_incluse');
  if (!formule.fonctionnalites.includes(d.fonctionnalite)) return refus('fonctionnalite_non_incluse');
  if (d.dureeFilmS > formule.dureeMaxFilmS) return refus('film_trop_long');

  const apres: Consommation = {
    films: c.films + (d.filmDejaCompte ? 0 : 1),
    secondes: c.secondes + d.secondesAjoutees,
    usdEngages: arrondiUsd(c.usdEngages + d.usdEstime),
    tentatives: c.tentatives + 1,
  };
  if (apres.films > formule.filmsParMois) return refus('films_epuises');
  if (apres.secondes > formule.secondesParMois) return refus('minutes_epuisees');
  if (apres.usdEngages > formule.budgetUsdParMois) return refus('budget_fournisseur_atteint');

  return {
    ok: true, regime: 'abonnement', apres,
    limites: { maxFilms: formule.filmsParMois, maxSecondes: formule.secondesParMois, maxUsd: formule.budgetUsdParMois },
  };
}

export interface ResumeQuota {
  inclus: boolean;
  filmsRestants: number;
  secondesRestantes: number;
  /** « 12 min 30 s » : ce que l'ecran affiche. */
  dureeRestante: string;
  dureeMaxFilmS: number;
  /** Part du budget fournisseur deja engagee, 0 a 1 — jamais le montant, qui n'a pas a etre montre. */
  partBudgetEngagee: number;
}

export function dureeLisible(s: number): string {
  const n = Math.max(0, Math.floor(s));
  const m = Math.floor(n / 60);
  const r = n % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

export function resumeQuota(formule: FormuleCinema | null, c: Consommation): ResumeQuota {
  if (!formule || !formule.inclus) {
    return { inclus: false, filmsRestants: 0, secondesRestantes: 0, dureeRestante: dureeLisible(0), dureeMaxFilmS: 0, partBudgetEngagee: 0 };
  }
  const secondesRestantes = Math.max(0, formule.secondesParMois - c.secondes);
  return {
    inclus: true,
    filmsRestants: Math.max(0, formule.filmsParMois - c.films),
    secondesRestantes,
    dureeRestante: dureeLisible(secondesRestantes),
    dureeMaxFilmS: formule.dureeMaxFilmS,
    partBudgetEngagee: formule.budgetUsdParMois > 0 ? Math.min(1, c.usdEngages / formule.budgetUsdParMois) : 1,
  };
}
