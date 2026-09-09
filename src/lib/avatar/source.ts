/**
 * A_8b — LA SOURCE PRIVEE D'UN AVATAR : LA DESIGNER, LA LIRE, LA TRANSMETTRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE CORRIGE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La route de creation posait un `getPublicUrl` sur la photo — ou la video —
 * du visage de la personne, et rangeait cette URL en base comme verite
 * canonique. Le relais public sert tout objet d'un compartiment autorise SANS
 * SESSION : le lien etait donc permanent, non revocable, et pointait sur la
 * donnee la plus sensible que Studiio detienne.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX CHOSES SEPAREES, ET C'EST LE POINT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 1. LA SOURCE CANONIQUE — une cle d'objet, rien d'autre. Elle dit OU est la
 *    donnee, jamais comment y acceder.
 * 2. LE TRANSPORT — la facon dont un tiers (le fournisseur d'avatar) pourra
 *    la lire, decidee a chaque fois, jamais rangee en base.
 *
 * Les melanger est exactement ce qui a produit le defaut : une URL est un
 * DROIT D'ACCES, et un droit d'acces qu'on persiste devient permanent par
 * accident.
 *
 * ⚠️ AUCUN APPEL FOURNISSEUR ICI. Ce module ne connait ni HeyGen ni aucun
 * autre : il prepare un acces, il ne s'en sert pas. Le branchement est A_8c.
 */
import { clientMinio, lecteurMinio, signeurInterne } from '@/lib/storage/minio-client';
import { BUCKET_NAMESPACE_AVATAR, SEGMENT_NAMESPACE_AVATAR } from '@/lib/storage/acces-objet';

/** Le compartiment des sources d'avatar — celui des medias, deja en place. */
export const BUCKET_AVATAR = BUCKET_NAMESPACE_AVATAR;

/**
 * Combien de temps un acces accorde a un tiers reste valable.
 *
 * ⚠️ COURT, ET CE N'EST PAS UN REGLAGE DE CONFORT. Une URL signee est un droit
 * d'acces a un visage : plus elle vit, plus la fenetre pendant laquelle une
 * fuite reste exploitable est grande. Cinq minutes suffisent largement a un
 * televersement serveur-a-serveur, et ne suffisent a rien d'autre.
 */
export const TTL_SOURCE_AVATAR_SECONDES = 300;

/** Ce qu'une source d'avatar peut etre. Rien d'autre n'entre. */
const TYPES_SOURCE_AUTORISES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * Le type a SERVIR pour une cle, decide par nous.
 *
 * ⚠️ JAMAIS LU SUR L'OBJET. MinIO pose `application/octet-stream` des qu'un
 * televersement n'a rien declare ; s'y fier laisserait servir en HTML, depuis
 * notre origine, un fichier depose par un autre chemin. Une extension inconnue
 * ne se devine pas : elle se refuse.
 */
export function typeSourceAvatar(cle: unknown): string | null {
  if (typeof cle !== 'string') return null;
  const point = cle.lastIndexOf('.');
  if (point < 0) return null;
  return TYPES_SOURCE_AUTORISES[cle.slice(point + 1).toLowerCase()] ?? null;
}

/**
 * La cle d'une nouvelle source d'avatar.
 *
 * ⚠️ LE COMPTE EST DANS LA CLE, ET C'EST LA PREUVE DE PROPRIETE. Le prefixe ne
 * suppose pas l'appartenance, il la porte — et `cleSourceAvatarDuCompte`
 * ci-dessous s'en sert pour refuser toute cle qui ne commence pas par le bon.
 *
 * Le segment `avatar` place l'objet dans le namespace que le relais public
 * refuse et que les routes d'envoi ne peuvent pas fabriquer.
 */
export function cleSourceAvatar(userId: string, extension: string, horodatage: number): string {
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/source-${horodatage}.${extension}`;
}

/**
 * Cette cle appartient-elle bien a ce compte, et au namespace avatar ?
 *
 * Deux questions, une seule reponse, parce qu'elles ne se separent jamais :
 * une cle du bon compte hors du namespace n'est pas une source d'avatar, et
 * une cle du namespace d'un autre compte n'est pas la sienne.
 */
export function cleSourceAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (typeof cle !== 'string' || cle.length === 0 || !userId) return false;
  if (cle.includes('..') || cle.includes('://') || cle.includes('\\')) return false;
  const attendu = `${userId}/${SEGMENT_NAMESPACE_AVATAR}/`;
  if (!cle.startsWith(attendu)) return false;
  // Rien apres le prefixe, ou un segment vide : ce n'est pas un objet.
  return cle.length > attendu.length && !cle.includes('//');
}

/** Le flux d'une source, pour la servir. Les octets ne sont pas materialises. */
export function ouvrirSourceAvatar(cle: string): Promise<NodeJS.ReadableStream> {
  return lecteurMinio().getObject(BUCKET_AVATAR, cle);
}

/** La source existe-t-elle vraiment ? Question posee APRES la propriete. */
export async function sourceAvatarPresente(cle: string): Promise<boolean> {
  try {
    const stat = await clientMinio().statObject(BUCKET_AVATAR, cle);
    return Number(stat?.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   LE CONTRAT DE TRANSMISSION — ECRIT, TESTE, NON APPELE
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Comment un fournisseur recevra la source.
 *
 * `url_signee_courte` — le fournisseur va chercher les octets lui-meme, par
 *   une adresse qui expire. Simple, mais l'adresse existe pendant sa duree de
 *   vie : elle ne doit ni etre journalisee, ni persistee, ni voyager plus loin
 *   que l'appel qui la consomme.
 * `flux_serveur` — nos octets partent depuis notre serveur. Aucune adresse
 *   n'existe jamais, mais le fichier transite par nous.
 *
 * ⚠️ LES DEUX RESTENT OUVERTS EN A_8b. Le choix depend du protocole que le
 * fournisseur imposera (A_8c) ; trancher maintenant serait decider sans savoir.
 */
export type ModeTransmissionSource = 'url_signee_courte' | 'flux_serveur';

export type AccesSourceAvatar =
  | { mode: 'url_signee_courte'; url: string; expireDansSecondes: number; typeContenu: string }
  | { mode: 'flux_serveur'; flux: NodeJS.ReadableStream; typeContenu: string };

export type MotifAccesSource =
  | 'source_absente'
  | 'type_non_autorise'
  | 'stockage_injoignable';

/**
 * Prepare l'acces d'un fournisseur a la source d'un avatar.
 *
 * ⚠️ L'ENTREE EST UN COMPTE ET UNE CLE DEJA VERIFIEE, JAMAIS UNE CLE DU
 * NAVIGATEUR. La propriete est revalidee ici malgre tout : cette fonction
 * signera un jour un acces a un visage, et une garde de plus au bord d'une
 * telle porte ne coute rien.
 *
 * ⚠️ CE QUI SORT NE DOIT NI ETRE JOURNALISE NI ECRIT EN BASE. Une URL signee
 * rangee quelque part cesse d'etre temporaire — c'est le defaut d'origine sous
 * un autre nom.
 */
export async function preparerSourceAvatarPourProvider(
  userId: string,
  cle: unknown,
  mode: ModeTransmissionSource,
): Promise<{ acces: AccesSourceAvatar | null; motif: MotifAccesSource | null }> {
  const echec = (motif: MotifAccesSource) => ({ acces: null, motif });

  if (!cleSourceAvatarDuCompte(cle, userId)) return echec('source_absente');
  const typeContenu = typeSourceAvatar(cle);
  if (typeContenu === null) return echec('type_non_autorise');
  if (!(await sourceAvatarPresente(cle))) return echec('source_absente');

  if (mode === 'flux_serveur') {
    try {
      const flux = await ouvrirSourceAvatar(cle);
      return { acces: { mode, flux, typeContenu }, motif: null };
    } catch {
      return echec('stockage_injoignable');
    }
  }

  const signeur = signeurInterne();
  if (!signeur) return echec('stockage_injoignable');
  try {
    const url = await signeur.presignedGetObject(
      BUCKET_AVATAR, cle, TTL_SOURCE_AVATAR_SECONDES,
    );
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return echec('stockage_injoignable');
    }
    return {
      acces: {
        mode, url, expireDansSecondes: TTL_SOURCE_AVATAR_SECONDES, typeContenu,
      },
      motif: null,
    };
  } catch {
    return echec('stockage_injoignable');
  }
}
