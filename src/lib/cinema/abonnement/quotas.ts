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

/** `d` decale de `n` mois, jour borne a la fin du mois cible (31 janv. − 1 mois → 31 dec.). */
function decalerMois(d: Date, n: number): Date {
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(d.getUTCDate(), dernierJour));
  return cible;
}

/**
 * La periode de quota en cours.
 *
 * `periode_abonnement` : fenetres MENSUELLES ANCREES sur la fin de periode Stripe REELLE
 * (`subscriptions.current_period_end`, ecrite par le webhook) — aucun calendrier parallele.
 * Un abonnement mensuel a une seule fenetre (sa periode) ; un abonnement annuel en a douze,
 * aux memes dates anniversaire. Fin inconnue, ou deja passee (renouvellement pas encore
 * recu) : `null`, et l'appelant REFUSE — on n'accorde jamais un nouveau quota sur une
 * periode qu'on ne peut pas verifier.
 */
export function periodeQuota(
  renouvellement: Renouvellement,
  abonnement: { fin?: string | null } | null,
  maintenant: Date,
): Periode | null {
  if (renouvellement === 'mois_civil') {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    const f = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
    return { debut: d.toISOString(), fin: f.toISOString() };
  }
  const finMs = abonnement?.fin ? Date.parse(abonnement.fin) : NaN;
  if (!Number.isFinite(finMs)) return null;
  const fin = new Date(finMs);
  const t = maintenant.getTime();
  if (t >= finMs) return null;
  // Au plus 13 fenetres : au-dela, la « periode » ne ressemble a aucun abonnement Stripe.
  for (let k = 1; k <= 13; k++) {
    const debut = decalerMois(fin, -k);
    if (debut.getTime() <= t) {
      return { debut: debut.toISOString(), fin: decalerMois(fin, -(k - 1)).toISOString() };
    }
  }
  return null;
}

export interface DemandeQuota {
  /** Le film est-il deja compte dans la periode ? Si non, il consomme un film. */
  filmDejaCompte: boolean;
  /** Secondes deja reservees pour CE film dans la periode. */
  secondesDejaReservees: number;
  /** Duree TOTALE du film apres l'operation : seule la difference avec la reserve compte. */
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

/** Message lisible d'un motif de refus, y compris ceux rendus par la base. */
export function messageRefus(motif: string): string {
  return (MESSAGES as Record<string, string>)[motif]
    ?? 'Votre quota n’a pas pu etre verifie : rien n’a ete lance ni debite. Reessayez dans un instant.';
}
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
  if (!Number.isInteger(d.dureeFilmS) || d.dureeFilmS <= 0
    || !Number.isInteger(d.secondesDejaReservees) || d.secondesDejaReservees < 0) return refus('demande_invalide');
  if (!formule.qualites.includes(d.qualite)) return refus('qualite_non_incluse');
  if (!formule.fonctionnalites.includes(d.fonctionnalite)) return refus('fonctionnalite_non_incluse');
  if (d.dureeFilmS > formule.dureeMaxFilmS) return refus('film_trop_long');

  // Meme calcul que `reserver_quota_cinema` : un film raccourci ne rend rien.
  const ajout = Math.max(0, d.dureeFilmS - d.secondesDejaReservees);
  const apres: Consommation = {
    films: c.films + (d.filmDejaCompte ? 0 : 1),
    secondes: c.secondes + ajout,
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
