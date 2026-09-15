/**
 * La source d'un clone — la photo ou la vidéo de référence, en stockage PRIVÉ.
 *
 * Une source est un visage. Ce module est le seul endroit qui sait où elle
 * vit, qui peut y toucher, et comment on s'en sépare :
 *
 *   - la clé est CONSTRUITE PAR LE SERVEUR (`cleSourceAvatar`), jamais reçue
 *     du navigateur ; sa forme est EXACTEMENT celle que `/api/avatar/create`
 *     écrit aujourd'hui (`<userId>/avatar/source-<horodatage>.<ext>`), pour
 *     que l'existant et le nouveau se lisent avec la même règle ;
 *   - toute lecture ou suppression repasse par `cleSourceAvatarDuCompte` :
 *     la clé doit appartenir AU compte et être UNE SOURCE — jamais une vidéo
 *     générée (`<userId>/avatar/<generationId>.mp4`), jamais un préfixe
 *     partagé, jamais une clé d'un autre domaine ;
 *   - `retirerSourceAvatar` ne lève jamais : perdre une source périmée est un
 *     nettoyage, pas une transaction. Si le stockage refuse, la base n'a rien
 *     à défaire.
 *
 * Ce qui n'est PAS ici, à dessein : l'envoi au fournisseur, la sonde qualité
 * (ffprobe), l'aperçu. Ce sont les lots suivants.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { clientMinio, lecteurMinio, type BorneReseau } from '@/lib/storage/minio-client';
import {
  BUCKET_NAMESPACE_AVATAR, SEGMENT_NAMESPACE_AVATAR, cleDansNamespaceAvatar, cleObjetValide,
} from '@/lib/storage/acces-objet';
import {
  TYPES_SOURCE_AUTORISES, estCleSourceAvatar, typeSourceAvatar, extensionSourceAvatar,
} from '@/lib/avatar/source-cle';

/* La FORME d'une clé vit dans `source-cle` (module pur, partagé avec le
   relais public et la route privée) ; ce module y ajoute le compte, le
   stockage et la base. Ré-exportés pour que les appelants n'aient qu'une porte. */
export { TYPES_SOURCE_AUTORISES, typeSourceAvatar, extensionSourceAvatar };

export const BUCKET_AVATAR = BUCKET_NAMESPACE_AVATAR;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La clé d'une NOUVELLE source, construite ici et nulle part ailleurs.
 *
 * L'horodatage est l'identité de la version : deux sources du même compte ne
 * partagent jamais une clé, et remplacer une source n'écrase pas l'ancienne
 * (elle est retirée séparément, après que la base pointe la nouvelle).
 */
export function cleSourceAvatar(userId: string, extension: string, horodatage = Date.now()): string {
  if (!UUID.test(userId)) throw new Error('cleSourceAvatar: identifiant de compte invalide');
  const ext = extensionSourceAvatar(`x.${extension}`);
  if (!ext) throw new Error(`cleSourceAvatar: format non autorisé (${extension})`);
  if (!Number.isInteger(horodatage) || horodatage < 0) throw new Error('cleSourceAvatar: horodatage invalide');
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/source-${horodatage}.${ext}`;
}

/**
 * Cette clé est-elle UNE SOURCE DE CE COMPTE ?
 *
 * Plus strict que `clePossedeePar` — exprès : les préfixes partagés
 * (`converted/`) ne comptent pas, le sous-dossier doit être `avatar`, le nom
 * doit être `source-<horodatage>.<ext>`. Une vidéo générée
 * (`<userId>/avatar/<uuid>.mp4`) est refusée : on ne la retire jamais par ce
 * chemin.
 */
export function cleSourceAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (!UUID.test(userId)) return false;
  // Pas de `cleObjetValide` ici : la forme exigée — trois segments, le
  // premier ÉGAL à l'UUID, le deuxième ÉGAL à `avatar`, le troisième pris
  // dans un motif fermé — ne laisse passer ni `..`, ni `%2F`, ni `\`, ni
  // `://`, ni caractère de contrôle. Un garde de plus serait mort (et testé
  // comme tel : le retirer ne fait rougir aucun test).
  if (!estCleSourceAvatar(cle)) return false;
  return cle.split('/')[0] === userId;
}

/**
 * Le chemin que `getPublicUrl()` écrit devant la clé (`s3-client.ts`,
 * `db/supabase.ts`) : `<PUBLIC_STORAGE_URL>/media/<clé>`, où l'URL de base est
 * par défaut `<APP_URL>/storage/v1/object/public`. C'est la SEULE forme que
 * `source_url` ait jamais prise pour une source d'avatar.
 */
const PREFIXE_URL_LEGACY = `/storage/v1/object/public/${BUCKET_NAMESPACE_AVATAR}/`;

/**
 * La clé d'une source à partir d'un `source_url` HISTORIQUE — les lignes
 * d'avant `source_object_key`, et celles que `/api/avatar/create` écrit
 * encore jusqu'à AVATAR-2A.
 *
 * Analyse STRICTE, pas un parseur d'URL : le chemin doit contenir exactement
 * le préfixe connu du relais, une seule fois, suivi de la clé nue (sans
 * `?`, `#`, ni encodage). Et la clé obtenue repasse par
 * `cleSourceAvatarDuCompte` : une URL qui désigne autrui, un autre
 * compartiment, un autre domaine ou une vidéo générée rend `null`.
 * Lecture seule : rien n'est écrit en base ici.
 */
export function cleSourceDepuisUrlLegacy(url: unknown, userId: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const debut = url.indexOf(PREFIXE_URL_LEGACY);
  if (debut < 0) return null;
  if (url.indexOf(PREFIXE_URL_LEGACY, debut + 1) >= 0) return null;
  const cle = url.slice(debut + PREFIXE_URL_LEGACY.length);
  if (cle.length === 0 || /[?#%]/.test(cle)) return null;
  return cleSourceAvatarDuCompte(cle, userId) ? cle : null;
}

/** Cette clé vit-elle dans le domaine avatar de CE compte (source OU vidéo générée) ? */
export function cleAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (!UUID.test(userId)) return false;
  if (!cleObjetValide(cle)) return false;
  if (!cle.startsWith(`${userId}/`)) return false;
  return cleDansNamespaceAvatar(BUCKET_AVATAR, cle);
}

// ─────────────────────────────────────────────────────────────────────────
// Lire, vérifier, retirer — toujours après le contrôle de propriété
// ─────────────────────────────────────────────────────────────────────────

/** Ouvre la source EN FLUX, pour une route authentifiée ; `null` si la clé n'est pas au compte. */
export async function ouvrirSourceAvatar(
  userId: string, cle: unknown, borne?: BorneReseau,
): Promise<{ flux: NodeJS.ReadableStream; type: string; taille: number } | null> {
  if (!cleSourceAvatarDuCompte(cle, userId)) return null;
  const stat = await clientMinio(borne).statObject(BUCKET_AVATAR, cle);
  const flux = await lecteurMinio(borne).getObject(BUCKET_AVATAR, cle);
  return { flux, type: typeSourceAvatar(cle) ?? 'application/octet-stream', taille: stat.size };
}

/** La source est-elle réellement en stockage, non vide, et au compte ? Ne lève jamais. */
export async function sourceAvatarPresente(userId: string, cle: unknown, borne?: BorneReseau): Promise<boolean> {
  if (!cleSourceAvatarDuCompte(cle, userId)) return false;
  try {
    const stat = await clientMinio(borne).statObject(BUCKET_AVATAR, cle);
    return stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Retire une source PÉRIMÉE du stockage. Rend `true` si l'objet a été retiré
 * (ou n'existait déjà plus), `false` dans tous les autres cas — et ne lève
 * jamais.
 *
 * Trois refus, avant de toucher au stockage :
 *   1. la clé n'est pas une source de CE compte (autre compte, vidéo générée,
 *      autre domaine, traversée) ;
 *   2. la clé est celle qu'on CONSERVE (la nouvelle source) — on ne supprime
 *      pas ce qu'on vient d'écrire ;
 *   3. (implicite) une génération payée n'a jamais la forme d'une source.
 *
 * À appeler APRÈS que la base pointe la nouvelle source : si le retrait
 * échoue, on garde un objet orphelin, jamais une ligne sans objet.
 */
export async function retirerSourceAvatar(userId: string, cle: unknown, cleConservee?: string | null): Promise<boolean> {
  if (!cleSourceAvatarDuCompte(cle, userId)) return false;
  if (cleConservee && cle === cleConservee) return false;
  try {
    const { error } = await supabaseAdmin.storage.from(BUCKET_AVATAR).remove([cle]);
    return !error;
  } catch {
    return false;
  }
}
