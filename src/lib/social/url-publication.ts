/**
 * L'URL qu'un réseau social (ou notre téléchargement YouTube) ira chercher —
 * UNE seule implémentation pour `api/social/publish` et `api/cron/publish`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TROU QUE CE MODULE FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les deux routes portaient chacune leur copie de `ensurePublicUrl` : toute
 * URL contenant `/storage/v1/object/(sign|authenticated|private)/<bucket>/<clé>`
 * était SIGNÉE pour 1 h avec le client ADMIN, sans regarder à qui
 * appartenait l'objet. Or l'URL vient du post (`media_url`,
 * `metadata.renderedVideoUrl`) — donc du navigateur. A pouvait y poser la clé
 * d'un objet PRIVÉ de B : notre serveur signait, Meta / TikTok téléchargeaient,
 * et la vidéo de B partait sur les réseaux de A. Un « adjoint confus ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avant toute signature, la cible passe `cibleLisibleParCompte` avec
 * l'identifiant du PUBLIEUR (session pour la route, `post.user_id` pour le
 * cron) — exactement la garde des lectures internes du stockage :
 * politique du relais public (`cibleRecevable` : compartiments admis, chemin
 * sain, namespaces privés refusés — analyses, montages, LUT, source
 * d'avatar), puis propriété lue sur la clé.
 *
 * La garde porte sur la clé BRUTE (celle qui part à la signature) ET sur sa
 * forme décodée : une clé qui ne satisfait la règle que sous l'une des deux
 * formes n'est pas signée.
 *
 * Refus → `ErreurMediaPublication('refuse')`, message FIXE
 * (« Média de publication refusé. ») : ni clé, ni URL, ni compte n'en
 * sortent, ni dans la réponse, ni dans `metadata.error`. Aucun appel de
 * signature n'a lieu.
 *
 * Inchangé : une URL publique (relais `/object/public/`) ou externe ressort
 * telle quelle (le relais applique ses propres refus) ; un échec de
 * signature rend l'URL d'origine, comme avant.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { cibleLisibleParCompte } from '@/lib/storage/acces-objet';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';
import { ErreurMediaPublication } from '@/lib/social/media-publication';

/** Durée de validité de l'URL signée remise au réseau. */
export const DUREE_SIGNATURE_PUBLICATION_S = 3600;

const MOTIF_OBJET_PRIVE = /\/storage\/v1\/object\/(?:sign|authenticated|private)\/([^/?#]+)\/([^?#]+)/;

/** Décodage unique, ou `null` si l'échappement est invalide. */
function decoder(valeur: string): string | null {
  try { return decodeURIComponent(valeur); } catch { return null; }
}

/**
 * La cible privée désignée par l'URL est-elle lisible par ce compte ?
 * Les deux formes (brute, décodée) doivent passer.
 */
function ciblePriveeAutorisee(bucketBrut: string, cleBrute: string, userId: unknown): boolean {
  const bucket = decoder(bucketBrut);
  const cle = decoder(cleBrute);
  if (bucket === null || cle === null) return false;
  if (bucket !== bucketBrut) return false; // un nom de compartiment n'a rien à échapper
  return cibleLisibleParCompte(bucket, cleBrute, userId) && cibleLisibleParCompte(bucket, cle, userId);
}

/**
 * Rend une URL que la plateforme peut aller chercher elle-même.
 *
 * @param userId le PUBLIEUR — propriétaire exigé de tout objet privé signé.
 * @throws ErreurMediaPublication('refuse') si l'URL désigne un objet privé
 *         que ce compte n'a pas le droit de lire.
 */
export async function ensurePublicUrl(url: string, userId: unknown): Promise<string> {
  if (!url) return url;
  // ⚠️ ABSOLUE D'ABORD : Meta et TikTok vont chercher le fichier eux-mêmes,
  // un chemin relatif (`/storage/v1/object/public/…` sous MinIO) leur est
  // inutilisable. Une URL déjà absolue ressort inchangée.
  const absolue = toAbsoluteMediaUrl(url);
  if (absolue.includes('/storage/v1/object/public/')) return absolue;
  if (!absolue.includes('/storage/v1/object/')) return absolue;

  const m = absolue.match(MOTIF_OBJET_PRIVE);
  if (!m) return absolue;
  const [, bucket, cle] = m;

  if (!ciblePriveeAutorisee(bucket, cle, userId)) {
    // Journal sans clé ni URL : le compartiment seul suffit au diagnostic.
    console.warn('[Publication/Média] objet privé refusé avant signature', { bucket: decoder(bucket) ?? 'invalide' });
    throw new ErreurMediaPublication('refuse');
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(cle, DUREE_SIGNATURE_PUBLICATION_S);
    if (error || !data?.signedUrl) return absolue;
    return data.signedUrl;
  } catch {
    return absolue;
  }
}
