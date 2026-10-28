/**
 * CINEMA IA — DEVIS DU PROJET AVANT TOUTE GENERATION PAYANTE, et ce que l'ecran en montre.
 *
 * QUATRE NOTIONS, JAMAIS FONDUES EN UNE :
 *   - le COUT FOURNISSEUR ESTIME du projet (USD, `couts.ts`) ;
 *   - le BUDGET FOURNISSEUR RESTANT de la formule ;
 *   - le QUOTA INCLUS (films, minutes) ;
 *   - un eventuel MONTANT SUPPLEMENTAIRE : TOUJOURS `null` ici. Aucun depassement payant
 *     n'est configure commercialement : le depassement est REFUSE, jamais facture.
 *
 * L'abonne voit ses films, ses minutes, la couverture du projet et la PART de budget
 * engagee — jamais un montant fournisseur en dollars. L'administrateur, qui paie le cout
 * reel, voit les dollars.
 */
import type { Film } from '@/lib/cinema/types';
import { devisGeneration } from '@/lib/cinema/generation/couts';
import type { FormuleCinema } from '@/lib/cinema/abonnement/formules';
import { decider, dureeLisible, type Consommation } from '@/lib/cinema/abonnement/quotas';
import { dureeProjetS, fonctionnaliteDe } from '@/lib/cinema/abonnement/regime';

export interface DevisProjet {
  dureeProjetS: number;
  plans: number;
  /** Plans sans aucun media : une image a generer. */
  imagesManquantes: number;
  /** Plans qui ne sont pas encore une video : animation possible. */
  animationsPossibles: number;
  imagesUsd: number | null;
  animationsUsd: number | null;
  /** `null` si un tarif est inconnu : un total partiel serait un faux devis. */
  totalUsd: number | null;
}

export function devisProjet(
  film: Pick<Film, 'scenes'>, fournisseurImage: string, fournisseurVideo: string,
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
  return {
    dureeProjetS: dureeProjetS(film),
    plans: plans.length,
    imagesManquantes: sansMedia.length,
    animationsPossibles: pasVideo.length,
    imagesUsd: images,
    animationsUsd: animations,
    totalUsd: images === null || animations === null ? null : Math.round((images + animations) * 10_000) / 10_000,
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
  dureeProjetS: number;
  dureeProjet: string;
  dureeMaxFilmS: number;
  /** Une premiere generation de ce projet passerait-elle maintenant ? */
  disponible: boolean;
  message: string | null;
  /** Le budget restant couvre-t-il les images manquantes du projet ? (`null` = pas de devis) */
  projetCouvert: boolean | null;
  partBudgetEngagee: number;
  /** Toujours `null` : aucun depassement payant n'est configure. */
  supplement: null;
}

export function quotaAbonne(args: {
  formule: FormuleCinema; consommation: Consommation & { film: { compte: boolean; secondes: number } };
  film: Pick<Film, 'scenes' | 'qualite'>; devis: DevisProjet; usdPremiereImage: number | null;
}): QuotaAbonne {
  const { formule: f, consommation: c, devis } = args;
  const restantUsd = Math.max(0, f.budgetUsdParMois - c.usdEngages);
  const d = decider({
    regime: 'abonnement', formule: f, consommation: c,
    demande: {
      filmDejaCompte: c.film.compte, secondesDejaReservees: c.film.secondes,
      dureeFilmS: Math.max(1, devis.dureeProjetS), qualite: args.film.qualite,
      fonctionnalite: fonctionnaliteDe('image'), usdEstime: args.usdPremiereImage ?? Number.NaN,
    },
  });
  return {
    regime: 'abonnement',
    filmsUtilises: c.films, filmsInclus: f.filmsParMois,
    secondesUtilisees: c.secondes, secondesIncluses: f.secondesParMois,
    dureeUtilisee: dureeLisible(c.secondes), dureeIncluse: dureeLisible(f.secondesParMois),
    dureeProjetS: devis.dureeProjetS, dureeProjet: dureeLisible(devis.dureeProjetS),
    dureeMaxFilmS: f.dureeMaxFilmS,
    disponible: d.ok,
    message: d.ok ? null : d.message,
    projetCouvert: devis.imagesUsd === null ? null : devis.imagesUsd <= restantUsd,
    partBudgetEngagee: f.budgetUsdParMois > 0 ? Math.min(1, c.usdEngages / f.budgetUsdParMois) : 1,
    supplement: null,
  };
}
