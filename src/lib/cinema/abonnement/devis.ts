/**
 * CINEMA IA — DEVIS GLOBAL DU FILM AVANT TOUTE GENERATION PAYANTE, son APPROBATION, et ce
 * que l'ecran en montre.
 *
 * QUATRE NOTIONS, JAMAIS FONDUES EN UNE :
 *   - le COUT FOURNISSEUR ESTIME du projet (USD, `couts.ts`) ;
 *   - le BUDGET FOURNISSEUR RESTANT de la formule ;
 *   - le QUOTA INCLUS (films, minutes) ;
 *   - un eventuel MONTANT SUPPLEMENTAIRE : TOUJOURS `null`. Aucun depassement payant
 *     n'est configure commercialement : le depassement est REFUSE, jamais facture.
 *
 * APPROBATION (regimes abonnement et administrateur) : aucune generation payante sans un
 * budget de projet approuve explicitement. Le serveur RECALCULE le devis — jamais un
 * montant envoye par le navigateur — et le confronte au plafond par film et, pour un
 * abonne, au budget restant de sa formule. Le budget approuve borne ensuite la depense
 * CUMULEE du film pendant toute la production (`refusBudgetProjet`, executeur).
 */
import type { BudgetApprouve, Film, NiveauQualite } from '@/lib/cinema/types';
import { devisGeneration, tarifGeneration } from '@/lib/cinema/generation/couts';
import type { FormuleCinema } from '@/lib/cinema/abonnement/formules';
import { decider, dureeLisible, type Consommation } from '@/lib/cinema/abonnement/quotas';
import { dureeProjetS, fonctionnaliteDe } from '@/lib/cinema/abonnement/regime';

export type Perimetre = 'images' | 'complet';

export interface ModeleDevis { operation: 'image' | 'video'; fournisseurId: string; usdParUnite: number | null }

export interface DevisProjet {
  scenes: number;
  plans: number;
  dureeProjetS: number;
  qualite: NiveauQualite | null;
  modeles: ModeleDevis[];
  /** Plans sans aucun media : une image a generer. */
  imagesManquantes: number;
  /** Plans qui ne sont pas encore une video : animation possible. */
  animationsPossibles: number;
  imagesUsd: number | null;
  animationsUsd: number | null;
  /** `null` si un tarif est inconnu : un total partiel serait un faux devis. */
  totalUsd: number | null;
  /** Ce qui reste a engager, par perimetre approuvable. */
  perimetres: Record<Perimetre, number | null>;
  /** Deja engage sur ce film (generations passees). */
  dejaEngageUsd: number;
}

const arrondi = (x: number) => Math.round(x * 10_000) / 10_000;

export function devisProjet(
  film: Pick<Film, 'scenes'> & Partial<Pick<Film, 'qualite' | 'coutGenerationUsd'>>,
  fournisseurImage: string, fournisseurVideo: string,
): DevisProjet {
  const plans = film.scenes.flatMap((s) => s.plans);
  const sansMedia = plans.filter((p) => !p.media);
  const pasVideo = plans.filter((p) => p.media?.genre !== 'video');
  const images = sansMedia.length
    ? devisGeneration(fournisseurImage, sansMedia.map((p) => ({ planId: p.id, operations: ['image' as const] }))).totalUsd
    : 0;
  const animations = pasVideo.length
    ? devisGeneration(fournisseurVideo, pasVideo.map((p) => ({ planId: p.id, operations: ['video' as const] }))).totalUsd
    : 0;
  const total = images === null || animations === null ? null : arrondi(images + animations);
  return {
    scenes: film.scenes.length,
    plans: plans.length,
    dureeProjetS: dureeProjetS(film),
    qualite: film.qualite ?? null,
    modeles: [
      { operation: 'image', fournisseurId: fournisseurImage, usdParUnite: tarifGeneration(fournisseurImage, 'image')?.usdParUnite ?? null },
      { operation: 'video', fournisseurId: fournisseurVideo, usdParUnite: tarifGeneration(fournisseurVideo, 'video')?.usdParUnite ?? null },
    ],
    imagesManquantes: sansMedia.length,
    animationsPossibles: pasVideo.length,
    imagesUsd: images,
    animationsUsd: animations,
    totalUsd: total,
    perimetres: { images, complet: total },
    dejaEngageUsd: arrondi(film.coutGenerationUsd ?? 0),
  };
}

export const MESSAGE_BUDGET_NON_APPROUVE =
  'Confirmez d’abord le budget de ce projet : aucune generation payante n’est lancee sans lui.';
export const MESSAGE_BUDGET_ATTEINT =
  'Le budget approuve pour ce projet est atteint : confirmez un nouveau budget pour continuer.';

/** Refus (message) si cette depense ferait sortir le film de son budget approuve. */
export function refusBudgetProjet(film: Pick<Film, 'budgetApprouve' | 'coutGenerationUsd'> | null, usd: number): string | null {
  if (!film) return 'film introuvable';
  const b = film.budgetApprouve;
  if (!b || !Number.isFinite(b.usd) || b.usd <= 0) return MESSAGE_BUDGET_NON_APPROUVE;
  if ((film.coutGenerationUsd ?? 0) + usd > b.usd + 1e-9) return MESSAGE_BUDGET_ATTEINT;
  return null;
}

/**
 * Approuver le budget d'un projet. Toujours sur un devis RECALCULE par le serveur.
 *   - tarif inconnu → refus ;
 *   - rien a generer → refus ;
 *   - depense cumulee au-dela du plafond par film → refus ;
 *   - abonne : au-dela du budget restant de la formule, ou film/minutes indisponibles → refus.
 */
export function approuverBudget(args: {
  regime: 'cout_reel' | 'abonnement';
  film: Pick<Film, 'scenes' | 'qualite' | 'coutGenerationUsd'>;
  perimetre: Perimetre;
  devis: DevisProjet;
  plafondFilmUsd: number;
  abonnement?: { formule: FormuleCinema; consommation: Consommation & { film: { compte: boolean; secondes: number } }; usdPremiereImage: number | null };
  maintenant?: Date;
}): { ok: true; budget: BudgetApprouve } | { ok: false; message: string } {
  const reste = args.devis.perimetres[args.perimetre];
  if (reste === null) return { ok: false, message: 'Le cout de ce projet ne peut pas etre estime (tarif inconnu) : rien ne peut etre lance.' };
  if (reste <= 0) return { ok: false, message: 'Aucune generation payante n’est prevue pour ce projet.' };
  const cumul = arrondi(args.devis.dejaEngageUsd + reste);
  if (cumul > args.plafondFilmUsd + 1e-9) {
    return { ok: false, message: 'Ce projet depasse la limite de generation autorisee pour un film : reduisez le nombre de plans ou d’animations.' };
  }
  if (args.regime === 'abonnement') {
    const a = args.abonnement;
    if (!a) return { ok: false, message: 'Votre quota n’a pas pu etre lu.' };
    if (reste > Math.max(0, a.formule.budgetUsdParMois - a.consommation.usdEngages) + 1e-9) {
      return { ok: false, message: 'Ce projet depasse le budget de generation restant dans votre abonnement ce mois-ci.' };
    }
    const d = decider({
      regime: 'abonnement', formule: a.formule, consommation: a.consommation,
      demande: {
        filmDejaCompte: a.consommation.film.compte, secondesDejaReservees: a.consommation.film.secondes,
        dureeFilmS: Math.max(1, args.devis.dureeProjetS), qualite: args.film.qualite,
        fonctionnalite: fonctionnaliteDe('image'), usdEstime: a.usdPremiereImage ?? Number.NaN,
      },
    });
    if (!d.ok) return { ok: false, message: d.message };
  }
  return {
    ok: true,
    budget: { usd: cumul, perimetre: args.perimetre, devisUsd: arrondi(reste), approuveLe: (args.maintenant ?? new Date()).toISOString() },
  };
}

/** Ce que l'ABONNE voit. Aucun montant en dollars. */
export interface QuotaAbonne {
  regime: 'abonnement';
  filmsUtilises: number;
  filmsInclus: number;
  secondesUtilisees: number;
  secondesIncluses: number;
  dureeUtilisee: string;
  dureeIncluse: string;
  scenes: number;
  plans: number;
  dureeProjetS: number;
  dureeProjet: string;
  dureeMaxFilmS: number;
  /** Une premiere generation de ce projet passerait-elle maintenant ? */
  disponible: boolean;
  message: string | null;
  /** Part du budget restant que chaque perimetre utiliserait (`null` = tarif inconnu). */
  partBudgetProjet: Record<Perimetre, number | null>;
  partBudgetEngagee: number;
  budgetApprouve: { perimetre: Perimetre; approuveLe: string } | null;
  /** Toujours `null` : aucun depassement payant n'est configure. */
  supplement: null;
}

export function quotaAbonne(args: {
  formule: FormuleCinema; consommation: Consommation & { film: { compte: boolean; secondes: number } };
  film: Pick<Film, 'scenes' | 'qualite'> & Partial<Pick<Film, 'budgetApprouve'>>; devis: DevisProjet; usdPremiereImage: number | null;
}): QuotaAbonne {
  const { formule: f, consommation: c, devis } = args;
  const restantUsd = Math.max(0, f.budgetUsdParMois - c.usdEngages);
  // Ratio borne a 99 (« bien au-dela ») : jamais `Infinity`, que JSON transformerait en null.
  const part = (x: number | null) => (x === null ? null
    : restantUsd > 0 ? Math.min(99, Math.round((x / restantUsd) * 100) / 100) : (x > 0 ? 99 : 0));
  const d = decider({
    regime: 'abonnement', formule: f, consommation: c,
    demande: {
      filmDejaCompte: c.film.compte, secondesDejaReservees: c.film.secondes,
      dureeFilmS: Math.max(1, devis.dureeProjetS), qualite: args.film.qualite,
      fonctionnalite: fonctionnaliteDe('image'), usdEstime: args.usdPremiereImage ?? Number.NaN,
    },
  });
  const b = args.film.budgetApprouve;
  return {
    regime: 'abonnement',
    filmsUtilises: c.films, filmsInclus: f.filmsParMois,
    secondesUtilisees: c.secondes, secondesIncluses: f.secondesParMois,
    dureeUtilisee: dureeLisible(c.secondes), dureeIncluse: dureeLisible(f.secondesParMois),
    scenes: devis.scenes, plans: devis.plans,
    dureeProjetS: devis.dureeProjetS, dureeProjet: dureeLisible(devis.dureeProjetS),
    dureeMaxFilmS: f.dureeMaxFilmS,
    disponible: d.ok,
    message: d.ok ? null : d.message,
    partBudgetProjet: { images: part(devis.perimetres.images), complet: part(devis.perimetres.complet) },
    partBudgetEngagee: f.budgetUsdParMois > 0 ? Math.min(1, c.usdEngages / f.budgetUsdParMois) : 1,
    budgetApprouve: b ? { perimetre: b.perimetre, approuveLe: b.approuveLe } : null,
    supplement: null,
  };
}
