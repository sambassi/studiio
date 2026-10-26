/**
 * COUT DE LA GENERATION IA — par image, par video, par scene, par film.
 * PLAFOND SERVEUR applique AVANT tout appel fournisseur.
 *
 * Meme discipline que `cinema/couts.ts` (lot 1) et `fournisseurs/devis-
 * fournisseur.ts` (Autopilote) : UN TARIF NON VERIFIE N'EST JAMAIS ZERO, et
 * une estimation inconnue est refusee, pas autorisee « au cas ou ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D'OU VIENNENT LES TARIFS
 * ─────────────────────────────────────────────────────────────────────────
 * Le fournisseur `simule` est LOCAL : il tourne sous ffmpeg, zero appel
 * sortant, prix verifiable par lecture du code (`simule.ts`).
 *
 * Studiio utilise deja Replicate ailleurs (`src/app/api/ai/image/route.ts` :
 * `black-forest-labs/flux-schnell` pour l'image, `wan-video/wan-2.2-i2v-fast`
 * pour l'image-vers-video). ILS SONT DECLARES ICI SANS ETRE BRANCHES, pour
 * que le devis sache de quoi il parle le jour ou on les active — mais leur
 * tarif reste `usd: null`. Recherche du 2026-10-26 (WebSearch) : aucune page
 * officielle replicate.com/<modele> n'a pu etre lue (resultats indexes
 * seulement) ; les agregateurs tiers se contredisent (flux-schnell : entre
 * 0,002 $ et 0,0096 $ par image selon la source ; wan-2.2-i2v-fast : ~0,05 $
 * les 5 s en 480p, ~0,11 $ en 720p d'apres le blog Replicate de juillet 2025,
 * NON reverifie sur la page produit actuelle). Aucun de ces chiffres n'est
 * une source verifiee au sens du projet (cf. `SOURCE_TARIFS_HEYGEN`, qui cite
 * une page officielle ET une date de lecture ET un rapprochement avec une
 * facture reelle) : ils ne sont donc PAS utilises comme tarif. Avant
 * d'activer l'un de ces fournisseurs, lire `replicate.com/<modele>` et
 * remplacer `usd: null` par le chiffre lu, avec sa source et sa date — a
 * l'identique de ce qui a ete fait pour HeyGen.
 */
import type { FormatFilm, NiveauQualite } from '@/lib/cinema/types';
import type { OperationGenerationIA } from '@/lib/cinema/generation/fournisseur';

export interface TarifGenerationIA {
  fournisseurId: string;
  operation: OperationGenerationIA;
  libelle: string;
  /** USD par UNITE (1 image, ou 1 video courte). `null` = non verifie. */
  usdParUnite: number | null;
  /** `true` seulement si le fournisseur est a la fois tarife ET branche. */
  actif: boolean;
  source: string;
}

export const MESSAGE_TARIF_GENERATION_INCONNU =
  'Cout de generation inconnu : ce fournisseur n’a pas de tarif verifie.';

export const CATALOGUE_GENERATION: readonly TarifGenerationIA[] = [
  {
    fournisseurId: 'simule', operation: 'image',
    libelle: 'Image simulee (ffmpeg local)',
    usdParUnite: 0, actif: true,
    source: 'rendu local, aucun appel sortant',
  },
  {
    fournisseurId: 'simule', operation: 'video',
    libelle: 'Video simulee (ffmpeg local, image-vers-video)',
    usdParUnite: 0, actif: true,
    source: 'rendu local, aucun appel sortant',
  },
  {
    fournisseurId: 'replicate-flux-schnell', operation: 'image',
    libelle: 'Image (Replicate, flux-schnell) — non branche',
    usdParUnite: null, actif: false,
    source: 'tarif NON verifie (voir en-tete du fichier) — a lire sur replicate.com/black-forest-labs/flux-schnell avant tout branchement',
  },
  {
    fournisseurId: 'replicate-wan-i2v', operation: 'video',
    libelle: 'Video image-vers-video (Replicate, wan-2.2-i2v-fast) — non branche',
    usdParUnite: null, actif: false,
    source: 'tarif NON verifie (voir en-tete du fichier) — a lire sur replicate.com/wan-video/wan-2.2-i2v-fast avant tout branchement',
  },
];

export function tarifGeneration(fournisseurId: string, operation: OperationGenerationIA): TarifGenerationIA | null {
  return CATALOGUE_GENERATION.find((t) => t.fournisseurId === fournisseurId && t.operation === operation) ?? null;
}

/**
 * Cout d'UNE generation. `null` = inconnu — l'appelant ne doit JAMAIS lire
 * `null` comme `0`.
 */
export function coutUniteGeneration(fournisseurId: string, operation: OperationGenerationIA): number | null {
  return tarifGeneration(fournisseurId, operation)?.usdParUnite ?? null;
}

export interface LigneDevisGeneration {
  planId: string;
  operation: OperationGenerationIA;
  usd: number | null;
}

export interface DevisGenerationFilm {
  fournisseurId: string;
  lignes: LigneDevisGeneration[];
  /** `null` des qu'une seule ligne est inconnue — jamais une somme partielle silencieuse. */
  totalUsd: number | null;
}

/**
 * Devis pour generer un ou plusieurs plans (image, puis eventuellement
 * video depuis cette image). Pur : aucun appel, juste la somme annoncee
 * AVANT que quoi que ce soit ne soit demande au fournisseur.
 */
export function devisGeneration(
  fournisseurId: string,
  demandes: ReadonlyArray<{ planId: string; operations: readonly OperationGenerationIA[] }>,
): DevisGenerationFilm {
  const lignes: LigneDevisGeneration[] = [];
  for (const d of demandes) {
    for (const operation of d.operations) {
      lignes.push({ planId: d.planId, operation, usd: coutUniteGeneration(fournisseurId, operation) });
    }
  }
  const inconnu = lignes.some((l) => l.usd === null);
  return {
    fournisseurId,
    lignes,
    totalUsd: inconnu ? null : Math.round(lignes.reduce((t, l) => t + (l.usd ?? 0), 0) * 10_000) / 10_000,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * PLAFOND FERME, PAR FILM
 * ─────────────────────────────────────────────────────────────────────────
 * Verifie AVANT tout appel fournisseur, dans `atelier.ts`. Trois refus,
 * tous stricts par construction :
 *
 *  1. cout de la prochaine operation INCONNU → refuse (jamais traite comme
 *     gratuit, quel que soit le plafond) ;
 *  2. plafond LUI-MEME absent ou invalide → refuse (un plafond qu'on ne sait
 *     pas lire n'autorise rien) ;
 *  3. cout deja depense + cout de la prochaine operation > plafond → refuse.
 *
 * Rien ici ne lit ni n'ecrit de credits Studiio : c'est un garde-fou sur la
 * DEPENSE FOURNISSEUR, independant et en amont du systeme de credits
 * (`lib/credits/*`), auquel ce lot ne touche pas.
 */
export const PLAFOND_USD_PAR_FILM_DEFAUT = 2;

export interface VerificationPlafond {
  autorise: boolean;
  motif: string | null;
  /** Ce que le film a deja coute en generation IA, avant cette operation. */
  dejaDepenseUsd: number;
  /** Ce que l'operation proposee coute, ou `null` si inconnu. */
  coutProposeUsd: number | null;
  plafondUsd: number;
}

export function verifierPlafond(args: {
  dejaDepenseUsd: number;
  coutProposeUsd: number | null;
  plafondUsd: number;
}): VerificationPlafond {
  const { dejaDepenseUsd, coutProposeUsd, plafondUsd } = args;
  const base = { dejaDepenseUsd, coutProposeUsd, plafondUsd };

  if (!Number.isFinite(plafondUsd) || plafondUsd < 0) {
    return { ...base, autorise: false, motif: 'plafond de depenses invalide' };
  }
  if (coutProposeUsd === null) {
    return { ...base, autorise: false, motif: MESSAGE_TARIF_GENERATION_INCONNU };
  }
  if (dejaDepenseUsd + coutProposeUsd > plafondUsd) {
    return {
      ...base,
      autorise: false,
      motif: `plafond depasse : ${dejaDepenseUsd.toFixed(4)} $ deja depenses + ${coutProposeUsd.toFixed(4)} $ propose > ${plafondUsd.toFixed(2)} $ de plafond`,
    };
  }
  return { ...base, autorise: true, motif: null };
}

export function libelleUsdGeneration(usd: number | null): string {
  if (usd === null) return MESSAGE_TARIF_GENERATION_INCONNU;
  return usd === 0 ? 'Gratuit (fournisseur local simule)' : `${usd.toFixed(4)} USD`;
}

/** Qualites qui, dans l'etat actuel, autorisent la generation IA (toutes — c'est le plafond qui protege, pas la qualite). */
export function generationAutoriseePourQualite(_qualite: NiveauQualite): boolean {
  return true;
}

export type { FormatFilm };
