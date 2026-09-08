/**
 * A_4b — LA MATIÈRE DES SOUS-TITRES : LA PAROLE ET L'ORIGINE DES CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE RETRANSCRIT JAMAIS AU MOMENT DU RENDU
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La transcription existe déjà : M3-D l'a produite avant que les clips ne
 * soient découpés, et c'est elle qui a servi à décider où couper. La rappeler
 * ici coûterait un appel au fournisseur par rendu, pour un texte identique —
 * et rendrait un montage rejoué non déterministe.
 *
 * ⚠️ ET C'EST LA TRANSCRIPTION DU JEU DE CLIPS, pas la dernière en date. Un
 * jeu de clips porte `transcriptionId` : c'est CELLE-LÀ qui a servi à décider
 * des bornes. En prendre une plus récente daterait les mots autrement que les
 * coupes, et les sous-titres dériveraient.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN SEUL PRÉPARATEUR POUR LES DEUX CHEMINS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le montage manuel et l'Autopilote automatique appellent la même fonction.
 * Deux préparations divergeraient : l'une afficherait des sous-titres que
 * l'autre ne montre pas, sur le même profil.
 */
import { lireSetParId } from './clip-service';
import {
  lireTranscriptionParId, lireDerniereTranscriptionReussie,
} from './transcription-service';
import type { MontagePlan } from './montage-contrat';
import type { MotSource, ClipProjection } from './captions-timeline';

export interface MatiereCaptions {
  mots: readonly MotSource[];
  clips: readonly ClipProjection[];
}

/**
 * La parole du rush et l'origine de chaque clip, ou `null`.
 *
 * `null` n'est PAS une erreur : c'est « ce montage n'a pas de parole
 * exploitable ». Le moteur trace alors `usage.captionsNonRendues` et rend le
 * montage sans sous-titres, plutôt que d'échouer sur une vidéo par ailleurs
 * valide.
 */
export async function preparerCaptions(
  userId: string, plan: MontagePlan,
): Promise<MatiereCaptions | null> {
  try {
    const { set } = await lireSetParId(userId, plan.clipSetId);
    if (!set || set.clips.length === 0) return null;

    /* La transcription DU JEU DE CLIPS d'abord ; la dernière réussie du rush
       seulement si le jeu n'en nomme aucune — un jeu ancien, produit avant que
       le lien ne soit écrit. */
    const parId = set.transcriptionId
      ? (await lireTranscriptionParId(userId, set.transcriptionId)).transcription
      : null;
    const t = parId?.etat === 'reussie'
      ? parId
      : (await lireDerniereTranscriptionReussie(userId, set.rushId)).transcription;

    if (!t || !t.presente) return null;
    const mots = t.mots ?? [];
    // ⚠️ SANS MOTS HORODATÉS, PAS DE SOUS-TITRES. Répartir un segment
    // uniformément donnerait un minutage inventé — et un karaoké qui ment.
    if (mots.length === 0) return null;

    return {
      mots,
      clips: set.clips.map((c) => ({ rang: c.rang, debutSecondes: c.debutSecondes })),
    };
  } catch {
    /* Le socle peut manquer, la ligne peut avoir disparu. Aucun de ces cas
       n'est une raison de perdre un montage : on rend sans sous-titres, et le
       moteur le trace. Le message n'est PAS repris — il porterait un détail
       de base. */
    return null;
  }
}
