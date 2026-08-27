/**
 * La preuve : le serveur va REGARDER l'objet, lui-même.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En mode nominal (`STORAGE_PROVIDER=s3`), le navigateur reçoit une URL
 * pré-signée et écrit DIRECTEMENT dans MinIO : l'application n'est jamais
 * dans le chemin de la requête. Elle ne peut donc rien déduire de ce que le
 * client lui raconte ensuite. Un booléen « ça a marché », une URL, un
 * message de succès : rien de tout cela n'est une preuve, et un `curl` peut
 * produire les trois.
 *
 * La seule preuve possible, c'est d'aller voir. `statObject` interroge le
 * stockage sur la clé QUE LE SERVEUR A LUI-MÊME ATTRIBUÉE — jamais une clé
 * ou une URL soufflée par le client. Si l'objet est là, à la bonne taille et
 * du bon type, alors un fichier a réellement été écrit.
 *
 * Ce que ça prouve, précisément : qu'un objet existe à cette clé. Pas qu'il
 * contient un montage réussi. C'est un plancher, pas un plafond — mais c'est
 * infiniment plus qu'un champ JSON envoyé par le navigateur.
 */
import { clientMinio } from './minio-client';

/** Types acceptés pour un montage. Tout le reste est refusé. */
export const TYPES_AUTORISES = [
  'video/webm', 'video/mp4', 'video/quicktime', 'application/octet-stream',
] as const;

/**
 * Plancher de taille, en octets.
 *
 * Un montage de quelques secondes pèse plusieurs dizaines de kilo-octets.
 * 8 Ko écarte un fichier vide, un objet créé par erreur ou un placeholder
 * d'une ligne, sans risquer de refuser un montage court légitime.
 */
export const TAILLE_MINIMALE = 8 * 1024;

export interface Verification {
  ok: boolean;
  taille: number;
  contentType: string;
  motif?: 'objet_absent' | 'cle_hors_perimetre' | 'type_refuse' | 'trop_petit' | 'stockage_injoignable';
}

/**
 * L'objet attendu est-il réellement là, et plausible ?
 *
 * `cle` et `bucket` viennent de la ligne `rendus`, donc du serveur. `userId`
 * sert à revérifier que la clé reste dans le périmètre de son propriétaire :
 * une garde redondante avec l'attribution, et c'est voulu — une clé mal
 * formée ne doit jamais pouvoir confirmer le fichier d'autrui.
 */
export async function verifierObjet(
  bucket: string, cle: string, userId: string,
): Promise<Verification> {
  const vide: Verification = { ok: false, taille: 0, contentType: '' };

  if (!cle.startsWith(`${userId}/`)) {
    return { ...vide, motif: 'cle_hors_perimetre' };
  }

  let stat: { size: number; metaData?: Record<string, string> } | null = null;
  try {
    stat = await clientMinio().statObject(bucket, cle);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // MinIO distingue mal l'objet absent d'une panne. On ne confirme ni dans
    // un cas ni dans l'autre, mais on ne dit pas la même chose : un objet
    // absent clôt la tentative, un stockage injoignable la laisse ouverte.
    const absent = /not found|does not exist|NoSuchKey|NotFound/i.test(message);
    return { ...vide, motif: absent ? 'objet_absent' : 'stockage_injoignable' };
  }

  if (!stat) return { ...vide, motif: 'objet_absent' };

  const taille = Number(stat.size ?? 0);
  const contentType = String(
    stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
  ).split(';')[0].trim().toLowerCase();

  if (contentType && !(TYPES_AUTORISES as readonly string[]).includes(contentType)) {
    return { ok: false, taille, contentType, motif: 'type_refuse' };
  }

  if (taille < TAILLE_MINIMALE) {
    return { ok: false, taille, contentType, motif: 'trop_petit' };
  }

  return { ok: true, taille, contentType: contentType || 'application/octet-stream' };
}
