/**
 * M3-F — L'ORCHESTRATION D'UN JEU DE CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE JEU EST ATOMIQUE, ET C'EST UNE DÉCISION, PAS UNE FACILITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinq clips demandés, quatre produits : l'écran devrait alors expliquer
 * lequel manque et pourquoi, et le futur montage devrait savoir travailler
 * avec un trou. Un jeu de clips n'a de sens que complet.
 *
 * Sur échec, les objets déjà téléversés sont donc SUPPRIMÉS. Il n'existe
 * aucune transaction commune à PostgreSQL et à MinIO : la suppression peut
 * rater, et le taire laisserait des orphelins sans qu'aucun signal n'existe.
 * On ne promet donc pas ce qu'on ne tient pas — `usage.orphelins` compte ce
 * qui n'a pas pu être repris, exactement comme M3-D2 consigne un nettoyage
 * raté au lieu de l'avaler.
 *
 * ⚠️ SÉQUENTIEL. `libx264` sature déjà les quatre cœurs ; découper deux clips
 * de front ne va pas plus vite et met la base en concurrence pour le même
 * processeur.
 *
 * ⚠️ AUCUN FOURNISSEUR, AUCUN CRÉDIT, AUCUN RÉSEAU SORTANT. Le seul appel
 * distant est le stockage interne.
 */
import {
  CLIPS_MAX, SET_SECONDES_MAX, arrondirSeconde, coupeMaterialisable,
  type ClipMaterialise, type MotifClips,
} from './clip-contrat';
import {
  materialiserClip, signerSource, supprimerObjet,
  ouvrirDossier, fermerDossier, type SourceRush,
} from './clip-extraction';
import type { Coupe } from './coupe-contrat';

export interface DemandeSet {
  userId: string;
  clipSetId: string;
  source: SourceRush;
  coupes: readonly Coupe[];
}

export type ResultatSet =
  | {
      ok: true;
      clips: ClipMaterialise[];
      usage: Record<string, unknown>;
    }
  | {
      ok: false;
      motif: MotifClips;
      /** Ce qui n'a pas pu être repris malgré l'échec. Jamais tu. */
      usage: Record<string, unknown>;
    };

/**
 * Retient les coupes réellement matérialisables, dans l'ordre des rangs.
 *
 * ⚠️ ON NE RECALCULE RIEN. Les bornes viennent de M3-E, qui les a déjà
 * garanties dans le rush, autour de la référence et sous la garde de durée.
 * Ce filtre ne juge que ce que ffmpeg peut découper : un intervalle nul ou
 * démesuré, et le plafond de six qui vient de M3-C.
 */
export function coupesRetenues(coupes: readonly Coupe[]): Coupe[] {
  const propres = (coupes ?? []).filter(coupeMaterialisable);
  propres.sort((a, b) => a.rang - b.rang);
  return propres.slice(0, CLIPS_MAX);
}

/** La durée cumulée d'un jeu, arrondie comme le reste de la chaîne. */
export function dureeCumulee(coupes: readonly Coupe[]): number {
  return arrondirSeconde(
    coupes.reduce((t, c) => t + (c.finSecondes - c.debutSecondes), 0),
  );
}

/**
 * Matérialise un jeu complet. Ne lève jamais : tout échec est un motif fermé.
 *
 * Le répertoire temporaire est ouvert ici et fermé dans le `finally` — pour
 * TOUS les clips d'un coup. Son échec de suppression est consigné, jamais
 * transformé en échec de matérialisation : un jeu produit et téléversé reste
 * un jeu produit, même si le disque local garde un fichier de trop.
 */
export async function materialiserSet(demande: DemandeSet): Promise<ResultatSet> {
  const debutMs = Date.now();
  const coupes = coupesRetenues(demande.coupes);
  const usage: Record<string, unknown> = {
    clipsDemandes: coupes.length,
    methode: 'x264-crf23-v1',
  };

  if (coupes.length === 0) return { ok: false, motif: 'decision_invalide', usage };
  const cumul = dureeCumulee(coupes);
  if (cumul > SET_SECONDES_MAX) return { ok: false, motif: 'decision_invalide', usage };
  usage.secondesDemandees = cumul;

  // ── L'URL signée, une seule fois pour tout le jeu ────────────────────
  //
  // Elle vit dix minutes, largement au-delà du pire cas d'un jeu, et la
  // resigner à chaque clip multiplierait les allers-retours sans rien gagner.
  const signature = await signerSource(demande.source);
  if (!signature.ok) return { ok: false, motif: signature.motif, usage };

  const dossier = await ouvrirDossier();
  if (dossier === null) return { ok: false, motif: 'extraction_echouee', usage };

  const produits: ClipMaterialise[] = [];
  let echec: MotifClips | null = null;

  try {
    for (const coupe of coupes) {
      // UNE découpe à la fois : le processeur est partagé avec la base.
      const r = await materialiserClip({
        url: signature.url,
        coupe,
        userId: demande.userId,
        clipSetId: demande.clipSetId,
        dossier,
      });
      if (!r.ok) { echec = r.motif; break; }
      produits.push(r.clip);
    }
  } finally {
    // La suppression est TENTÉE quoi qu'il arrive, et son issue est rendue.
    if (!(await fermerDossier(dossier))) usage.nettoyageTemporaire = 'echoue';
  }

  if (echec !== null) {
    // ── Le jeu est atomique : ce qui est déjà en ligne redescend ────────
    let orphelins = 0;
    for (const c of produits) {
      if (!(await supprimerObjet(c.bucket, c.cle))) orphelins += 1;
    }
    if (orphelins > 0) usage.orphelins = orphelins;
    usage.clipsProduitsAvantEchec = produits.length;
    usage.dureeMs = Date.now() - debutMs;
    return { ok: false, motif: echec, usage };
  }

  usage.clipsProduits = produits.length;
  usage.octetsProduits = produits.reduce((t, c) => t + c.octets, 0);
  usage.dureeMs = Date.now() - debutMs;
  return { ok: true, clips: produits, usage };
}
