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

import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/db/supabase';
import { clientMinio, lecteurMinio, type BorneReseau } from '@/lib/storage/minio-client';
import {
  BUCKET_NAMESPACE_AVATAR, SEGMENT_NAMESPACE_AVATAR, cleDansNamespaceAvatar, cleObjetValide,
} from '@/lib/storage/acces-objet';
import {
  TYPES_SOURCE_AUTORISES, LONGUEUR_NONCE_SOURCE, EXTENSIONS_CONSENTEMENT, estCleSourceAvatar, estCleConsentementAvatar,
  estCleAudioAvatar, typeSourceAvatar, extensionSourceAvatar,
} from '@/lib/avatar/source-cle';

/* La FORME d'une clé vit dans `source-cle` (module pur, partagé avec le
   relais public et la route privée) ; ce module y ajoute le compte, le
   stockage et la base. Ré-exportés pour que les appelants n'aient qu'une porte. */
export { TYPES_SOURCE_AUTORISES, typeSourceAvatar, extensionSourceAvatar };

export const BUCKET_AVATAR = BUCKET_NAMESPACE_AVATAR;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un nonce SERVEUR, cryptographique : 16 octets, jamais du navigateur, jamais un aléa faible. */
export function nonceSourceAvatar(): string {
  return randomBytes(LONGUEUR_NONCE_SOURCE / 2).toString('hex');
}

/**
 * La clé d'une NOUVELLE source, construite ici et nulle part ailleurs.
 *
 * Horodatage + nonce sont l'identité de la version : deux requêtes du même
 * compte dans la MÊME milliseconde ont deux clés — aucune n'écrase l'autre
 * (`upsert`), aucune perdante ne peut retirer la gagnante. Remplacer une
 * source n'écrase donc jamais l'ancienne : elle est retirée séparément, après
 * que la base pointe la nouvelle.
 */
export function cleSourceAvatar(
  userId: string, extension: string, horodatage = Date.now(), nonce = nonceSourceAvatar(),
): string {
  if (!UUID.test(userId)) throw new Error('cleSourceAvatar: identifiant de compte invalide');
  const ext = extensionSourceAvatar(`x.${extension}`);
  if (!ext) throw new Error(`cleSourceAvatar: format non autorisé (${extension})`);
  if (!Number.isInteger(horodatage) || horodatage < 0) throw new Error('cleSourceAvatar: horodatage invalide');
  if (!new RegExp(`^[0-9a-f]{${LONGUEUR_NONCE_SOURCE}}$`).test(nonce)) throw new Error('cleSourceAvatar: nonce invalide');
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/source-${horodatage}-${nonce}.${ext}`;
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
 * Les BASES d'URL publique que `getPublicUrl()` a pu écrire devant
 * `/media/<clé>` — reprises de `s3-client.ts` et `db/supabase.ts`, qui
 * calculent toutes deux la même chose :
 *
 *   PUBLIC_STORAGE_URL                              si la variable est posée
 *   <NEXT_PUBLIC_APP_URL>/storage/v1/object/public  sinon, si l'app a une origine
 *   /storage/v1/object/public                       sinon (forme RELATIVE)
 *
 * Les trois sont rendues : une ligne historique a pu être écrite sous une
 * configuration antérieure à la configuration courante. Rien d'autre —
 * aucune origine n'est inventée, aucune n'est codée en dur.
 */
export function basesUrlPubliqueStockage(env: NodeJS.ProcessEnv = process.env): string[] {
  const bases = new Set<string>();
  const posee = env.PUBLIC_STORAGE_URL?.trim();
  if (posee) bases.add(posee.replace(/\/+$/, ''));
  const app = env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) bases.add(`${app.replace(/\/+$/, '')}/storage/v1/object/public`);
  bases.add('/storage/v1/object/public');
  return [...bases];
}

/** Le chemin (sans origine) d'une base configurée, sans barre finale. */
function cheminDeBase(base: string): { origine: string | null; chemin: string } | null {
  if (base.startsWith('/')) return { origine: null, chemin: base };
  try {
    const u = new URL(base);
    if (u.username || u.password || u.search || u.hash) return null;
    return { origine: u.origin, chemin: u.pathname.replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

/**
 * La clé d'une source à partir d'un `source_url` HISTORIQUE — les lignes
 * d'avant `source_object_key`, et celles que `/api/avatar/create` écrit
 * encore jusqu'à AVATAR-2A.
 *
 * ⚠️ L'ORIGINE EST COMPARÉE, JAMAIS CHERCHÉE PAR SOUS-CHAÎNE. Une URL
 * absolue est PARSÉE (`new URL`) et son `origin` — schéma, hôte, port —
 * doit être EXACTEMENT celui d'une base configurée : `evil.example` avec le
 * bon chemin, un sous-domaine forgé, un `user@` devant l'hôte, un autre port,
 * sont refusés. Une URL relative n'est acceptée que si une base relative
 * existe, et commence alors par son chemin exact. Dans les deux cas, le
 * chemin doit être `<base>/media/<clé>` — bucket `media` seul — sans `?`,
 * `#` ni encodage, et la clé repasse par `cleSourceAvatarDuCompte` : autrui,
 * autre namespace, vidéo générée, traversée rendent `null`.
 * Lecture seule : rien n'est écrit en base ici.
 */
export function cleSourceDepuisUrlLegacy(
  url: unknown, userId: string, env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (/[?#%\s]/.test(url)) return null;

  const estAbsolue = /^[a-z][a-z0-9+.-]*:/i.test(url);
  let origine: string | null = null;
  let chemin: string;
  if (estAbsolue) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.username || u.password) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    origine = u.origin;
    chemin = u.pathname;
  } else {
    // Une forme relative n'est comparée qu'à une base relative, par son
    // chemin EXACT depuis le début : `//hote/…` ou `/x/storage/…` n'y
    // correspondent jamais — pas de garde séparé, il serait mort.
    chemin = url;
  }

  for (const base of basesUrlPubliqueStockage(env)) {
    const b = cheminDeBase(base);
    if (!b) continue;
    if (b.origine !== origine) continue;
    const prefixe = `${b.chemin}/${BUCKET_NAMESPACE_AVATAR}/`;
    if (!chemin.startsWith(prefixe)) continue;
    const cle = chemin.slice(prefixe.length);
    return cleSourceAvatarDuCompte(cle, userId) ? cle : null;
  }
  return null;
}

/** Cette clé vit-elle dans le domaine avatar de CE compte (source OU vidéo générée) ? */
export function cleAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (!UUID.test(userId)) return false;
  if (!cleObjetValide(cle)) return false;
  if (!cle.startsWith(`${userId}/`)) return false;
  return cleDansNamespaceAvatar(BUCKET_AVATAR, cle);
}

// ─────────────────────────────────────────────────────────────────────────
// Les autres objets PRIVÉS du dossier : consentement fournisseur, audio
// ─────────────────────────────────────────────────────────────────────────

/**
 * La clé de la vidéo de CONSENTEMENT (D-ID) : même dossier, même nonce que
 * la source, nom `consent-…`. Formats vidéo seulement (mp4, mov) — ce que le
 * fournisseur accepte en `source_url`.
 */
export function cleConsentementAvatar(
  userId: string, extension: string, horodatage = Date.now(), nonce = nonceSourceAvatar(),
): string {
  if (!UUID.test(userId)) throw new Error('cleConsentementAvatar: identifiant de compte invalide');
  const ext = extension.toLowerCase();
  if (!(EXTENSIONS_CONSENTEMENT as readonly string[]).includes(ext)) throw new Error(`cleConsentementAvatar: format non autorisé (${extension})`);
  if (!Number.isInteger(horodatage) || horodatage < 0) throw new Error('cleConsentementAvatar: horodatage invalide');
  if (!new RegExp(`^[0-9a-f]{${LONGUEUR_NONCE_SOURCE}}$`).test(nonce)) throw new Error('cleConsentementAvatar: nonce invalide');
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/consent-${horodatage}-${nonce}.${ext}`;
}

/** Cette clé est-elle la vidéo de consentement de CE compte ? Même rigueur que `cleSourceAvatarDuCompte`. */
export function cleConsentementAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (!UUID.test(userId)) return false;
  if (!estCleConsentementAvatar(cle)) return false;
  return cle.split('/')[0] === userId;
}

/** La clé de l'audio d'une génération (ma voix, pour un aperçu D-ID) : `audio-<generationId>.mp3`. */
export function cleAudioAvatar(userId: string, generationId: string): string {
  if (!UUID.test(userId) || !UUID.test(generationId)) throw new Error('cleAudioAvatar: identifiant invalide');
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/audio-${generationId.toLowerCase()}.mp3`;
}

/** Source, consentement ou audio de CE compte : les trois objets que seule une session (ou un jeton signé) peut lire. */
export function clePriveeAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (!UUID.test(userId)) return false;
  if (!(estCleSourceAvatar(cle) || estCleConsentementAvatar(cle) || estCleAudioAvatar(cle))) return false;
  return cle.split('/')[0] === userId;
}

/** Le type MIME d'un objet privé du dossier, d'après son nom ; `null` si le nom n'est pas reconnu. */
export function typeObjetPriveAvatar(cle: string): string | null {
  // Les gardes rétrécissent leur argument ; on leur passe une valeur, pas la variable.
  if (estCleAudioAvatar(cle as unknown)) return 'audio/mpeg';
  if (estCleConsentementAvatar(cle as unknown)) return cle.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  return typeSourceAvatar(cle);
}

/**
 * Retire un objet privé PÉRIMÉ (consentement ou audio) du compte — jamais la
 * clé conservée, jamais une source (qui a son propre retrait), jamais une
 * vidéo générée. Ne lève jamais.
 */
export async function retirerObjetPriveAvatar(userId: string, cle: unknown, cleConservee?: string | null): Promise<boolean> {
  if (!(cleConsentementAvatarDuCompte(cle, userId) || (estCleAudioAvatar(cle) && cle.split('/')[0] === userId))) return false;
  if (cleConservee && cle === cleConservee) return false;
  try {
    const { error } = await supabaseAdmin.storage.from(BUCKET_AVATAR).remove([cle]);
    return !error;
  } catch {
    return false;
  }
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
