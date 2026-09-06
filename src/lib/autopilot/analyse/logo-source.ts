/**
 * LOT 2B ETAPE 2 — LE LOGO EXISTE-T-IL, ET EST-IL BIEN LE SIEN ?
 *
 * ---------------------------------------------------------------------------
 * LA MEME DOCTRINE QUE `musique-source`, DANS LE MEME ORDRE
 * ---------------------------------------------------------------------------
 *
 * Le prefixe prouve la propriete, la forme de la cle est refusee avant tout
 * acces, PUIS seulement on demande au stockage si l'objet est la. L'ordre
 * n'est pas un detail : interroger MinIO sur la cle d'un tiers, meme pour
 * refuser ensuite, ferait de cette route un revelateur d'existence.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ QU'UN OBJET EXISTE NE PROUVE RIEN
 * ---------------------------------------------------------------------------
 *
 * Les cles de la mediatheque valent `<userId>/<usage>/<horodatage>-<nom>` :
 * seul le nom vient du navigateur. C'est le PREFIXE qui dit a qui appartient
 * l'objet. Un compte qui enverrait la cle d'un tiers est refuse ici, et le
 * type declare ne suffit pas non plus : le moteur sonde le fichier descendu
 * avec ffprobe avant de l'incruster.
 */
import { clientMinio } from '@/lib/storage/minio-client';
import { BUCKETS_LOGO, cleLogoValide, type ObjetStockage } from './profil-creatif';

/**
 * Les types acceptes pour un logo.
 *
 * `application/octet-stream` est admis pour la meme raison que dans
 * `musique-source` : MinIO le pose par defaut quand le televersement n'a rien
 * declare. C'est ffprobe qui tranche pour de bon — un fichier qui n'est pas
 * une image y est refuse, quel que soit son type declare.
 */
export const TYPES_LOGO_AUTORISES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'application/octet-stream',
] as const;

/**
 * Plancher de taille, en octets.
 *
 * Un PNG d'un pixel pese une centaine d'octets ; 256 octets ecarte l'objet
 * vide et le placeholder d'une ligne sans risquer de refuser un vrai logo
 * monochrome tres simple.
 */
export const TAILLE_LOGO_MINIMALE = 256;

/**
 * Plafond de taille, en octets.
 *
 * Un logo est une vignette, pas une photographie. 8 Mo laisse passer un PNG
 * de plusieurs milliers de pixels de cote et empeche qu'un fichier de
 * plusieurs centaines de mega-octets soit descendu dans le repertoire du
 * rendu au nom d'une incrustation de quelques centaines de pixels.
 */
export const TAILLE_LOGO_MAXIMALE = 8 * 1024 * 1024;

export const MOTIFS_LOGO = [
  'logo_hors_perimetre',
  'logo_absent',
  'logo_type_refuse',
  'logo_trop_petit',
  'logo_trop_gros',
  'stockage_injoignable',
] as const;
export type MotifLogo = (typeof MOTIFS_LOGO)[number];

export type VerificationLogo =
  | { ok: true; taille: number }
  | { ok: false; motif: MotifLogo };

export async function verifierLogo(
  logo: ObjetStockage, userId: string,
): Promise<VerificationLogo> {
  if (!userId) return { ok: false, motif: 'logo_hors_perimetre' };
  if (!(BUCKETS_LOGO as readonly string[]).includes(logo.bucket)) {
    return { ok: false, motif: 'logo_hors_perimetre' };
  }
  // ⚠️ LA PROPRIETE D'ABORD, LE STOCKAGE ENSUITE.
  if (typeof logo.cle !== 'string' || !logo.cle.startsWith(`${userId}/`)) {
    return { ok: false, motif: 'logo_hors_perimetre' };
  }
  // La forme de la cle est REJOUEE ici, apres l'avoir ete au contrat : ce
  // module est le dernier point avant le stockage, et une garde qui suppose
  // la garde d'amont n'est plus une garde.
  if (!cleLogoValide(logo.cle)) {
    return { ok: false, motif: 'logo_hors_perimetre' };
  }

  let stat: { size: number; metaData?: Record<string, string> } | null = null;
  try {
    stat = await clientMinio().statObject(logo.bucket, logo.cle);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // MinIO distingue mal l'objet absent d'une panne. Les deux ne disent pas
    // la meme chose : l'absence clot la tentative, la panne la laisse ouverte.
    const absent = /not found|does not exist|NoSuchKey|NotFound/i.test(message);
    return { ok: false, motif: absent ? 'logo_absent' : 'stockage_injoignable' };
  }
  if (!stat) return { ok: false, motif: 'logo_absent' };

  const taille = Number(stat.size ?? 0);
  const contentType = String(
    stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
  ).split(';')[0].trim().toLowerCase();

  if (contentType && !(TYPES_LOGO_AUTORISES as readonly string[]).includes(contentType)) {
    return { ok: false, motif: 'logo_type_refuse' };
  }
  if (taille < TAILLE_LOGO_MINIMALE) return { ok: false, motif: 'logo_trop_petit' };
  if (taille > TAILLE_LOGO_MAXIMALE) return { ok: false, motif: 'logo_trop_gros' };
  return { ok: true, taille };
}

/** Ce que l'ecran lit quand un logo est refuse. */
export const MESSAGES_LOGO: Record<MotifLogo, string> = {
  logo_hors_perimetre: 'Ce logo ne vient pas de ta mediatheque.',
  logo_absent: 'Ce logo n’existe plus dans ta mediatheque.',
  logo_type_refuse: 'Ce fichier n’est pas une image.',
  logo_trop_petit: 'Ce fichier de logo est vide ou illisible.',
  logo_trop_gros: 'Ce logo est trop lourd : 8 Mo au maximum.',
  stockage_injoignable: 'Le stockage est momentanement indisponible. Reessaie.',
};
