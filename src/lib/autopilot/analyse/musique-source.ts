/**
 * LOT 2A — LA MUSIQUE EXISTE-T-ELLE, ET EST-ELLE BIEN LA SIENNE ?
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UN MODULE A PART DE `verifier-objet`
 * ---------------------------------------------------------------------------
 *
 * `src/lib/storage/verifier-objet.ts` verifie un MONTAGE : sa liste de types
 * n'accepte que de la video, et son plancher de taille est celui d'un film.
 * Y ajouter l'audio elargirait la garde du montage pour un besoin qui n'est
 * pas le sien — et un elargissement fait « en passant » est exactement ce qui
 * transforme une garde en formalite.
 *
 * La doctrine, elle, est recopiee a l'identique, et dans le meme ordre :
 * le prefixe prouve la propriete, `..` est refuse, puis seulement on demande
 * au stockage si l'objet est la.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ QU'UN OBJET EXISTE NE PROUVE RIEN
 * ---------------------------------------------------------------------------
 *
 * Les cles de la mediatheque sont fabriquees par le serveur sous la forme
 * `<userId>/<usage>/<horodatage>-<nom>` : seul le nom vient du navigateur.
 * C'est le PREFIXE qui dit a qui appartient l'objet, jamais son existence. Un
 * compte qui enverrait la cle d'un tiers doit etre refuse avant meme qu'on
 * regarde si le fichier est la — sans quoi la reponse elle-meme confirmerait
 * l'existence du fichier d'autrui.
 */
import { clientMinio } from '@/lib/storage/minio-client';
import { BUCKET_MUSIQUE, type PisteMusicale } from './recette-audio';

/**
 * Les types acceptes pour une musique.
 *
 * `application/octet-stream` est admis parce que MinIO le pose par defaut
 * quand le televersement n'a rien declare — le refuser ecarterait des fichiers
 * legitimes. C'est ffprobe qui tranche pour de bon, plus loin dans le rendu :
 * un fichier sans piste audio y est refuse, quel que soit son type declare.
 */
export const TYPES_MUSIQUE_AUTORISES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac',
  'application/octet-stream',
] as const;

/**
 * Plancher de taille, en octets.
 *
 * Quelques secondes de musique pesent plusieurs dizaines de kilo-octets. 4 Ko
 * ecarte un objet vide ou un placeholder d'une ligne sans risquer de refuser
 * une transition courte.
 */
export const TAILLE_MUSIQUE_MINIMALE = 4 * 1024;

export const MOTIFS_MUSIQUE = [
  'musique_hors_perimetre',
  'musique_absente',
  'musique_type_refuse',
  'musique_trop_petite',
  'stockage_injoignable',
] as const;
export type MotifMusique = (typeof MOTIFS_MUSIQUE)[number];

export type VerificationMusique =
  | { ok: true; taille: number }
  | { ok: false; motif: MotifMusique };

export async function verifierMusique(
  piste: PisteMusicale, userId: string,
): Promise<VerificationMusique> {
  if (!userId) return { ok: false, motif: 'musique_hors_perimetre' };
  if (piste.bucket !== BUCKET_MUSIQUE) {
    return { ok: false, motif: 'musique_hors_perimetre' };
  }
  // ⚠️ LA PROPRIETE D'ABORD, LE STOCKAGE ENSUITE. Interroger MinIO sur la cle
  // d'un tiers, meme pour refuser apres, ferait de cette route un revelateur
  // d'existence.
  if (!piste.cle.startsWith(`${userId}/`)) {
    return { ok: false, motif: 'musique_hors_perimetre' };
  }
  if (piste.cle.includes('..') || piste.cle.includes('\\') || piste.cle.includes('://')) {
    return { ok: false, motif: 'musique_hors_perimetre' };
  }

  let stat: { size: number; metaData?: Record<string, string> } | null = null;
  try {
    stat = await clientMinio().statObject(piste.bucket, piste.cle);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // MinIO distingue mal l'objet absent d'une panne. Les deux ne disent pas
    // la meme chose : l'absence clot la tentative, la panne la laisse ouverte.
    const absent = /not found|does not exist|NoSuchKey|NotFound/i.test(message);
    return { ok: false, motif: absent ? 'musique_absente' : 'stockage_injoignable' };
  }
  if (!stat) return { ok: false, motif: 'musique_absente' };

  const taille = Number(stat.size ?? 0);
  const contentType = String(
    stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
  ).split(';')[0].trim().toLowerCase();

  if (contentType && !(TYPES_MUSIQUE_AUTORISES as readonly string[]).includes(contentType)) {
    return { ok: false, motif: 'musique_type_refuse' };
  }
  if (taille < TAILLE_MUSIQUE_MINIMALE) {
    return { ok: false, motif: 'musique_trop_petite' };
  }
  return { ok: true, taille };
}

/** Ce que l'ecran lit quand une musique est refusee. */
export const MESSAGES_MUSIQUE: Record<MotifMusique, string> = {
  musique_hors_perimetre: 'Cette musique ne vient pas de ta mediatheque.',
  musique_absente: 'Cette musique n’existe plus dans ta mediatheque.',
  musique_type_refuse: 'Ce fichier n’est pas une musique.',
  musique_trop_petite: 'Ce fichier de musique est vide ou illisible.',
  stockage_injoignable: 'Le stockage est momentanement indisponible. Reessaie.',
};
