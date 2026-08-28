/**
 * Ou le navigateur envoie le montage — et ce qu'on ne lui donnera jamais.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI S'ETAIT PASSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `/api/render/jobs` signait l'URL d'envoi avec le client Supabase, dont
 * l'endpoint est `http://studiio-minio:9000` quand `STORAGE_PROVIDER=s3`.
 * C'est le nom Docker du conteneur : il ne se resout que sur le serveur, et
 * il est en clair. Chrome a donc bloque l'envoi d'un montage de 8,5 Mo deja
 * compose -- « Mixed Content » -- sans debit et sans post.
 *
 * Remplacer `http` par `https` ou reecrire l'hote APRES signature aurait
 * casse la signature, qui porte l'hote. Le probleme n'etait pas le schema :
 * c'etait qu'une adresse interne sortait du serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX CIBLES, DANS CET ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. `MINIO_PUBLIC_ENDPOINT` configure -> URL presignee HTTPS sur le nom
 *      PUBLIC. C'est le mecanisme deja en production pour les rushes
 *      (`/api/upload/signed-url`), et le navigateur ecrit sans traverser
 *      l'application -- ce qui evite les coupures de proxy sur les gros
 *      fichiers.
 *   2. Sinon -> `/api/render/jobs/<id>/upload`, relais same-origin
 *      authentifie qui transmet vers MinIO interne.
 *
 * Dans les deux cas le bucket et la cle viennent de la ligne `rendus`. Le
 * navigateur ne les choisit pas, et ne peut pas les changer : la signature
 * les porte, et le relais les relit en base.
 */
import type { ClientStockage } from '@/lib/storage/minio-client';

/**
 * Duree de validite d'une URL presignee, en secondes.
 *
 * Quinze minutes : de quoi envoyer un montage lourd sur une connexion
 * mediocre, sans laisser trainer une autorisation d'ecriture apres coup.
 * Meme valeur que les rushes, volontairement.
 */
export const PRESIGNE_TTL_S = 900;

/** Types acceptes a l'ENTREE du relais. Tout le reste est refuse. */
export const TYPES_TELEVERSEMENT = [
  'video/webm', 'video/mp4', 'video/quicktime', 'application/octet-stream',
] as const;

/**
 * Plafond de taille, en octets.
 *
 * 512 Mo : tres au-dessus d'un montage d'assistant (quelques dizaines de
 * Mo), assez bas pour qu'un flux qui derape ne remplisse pas le disque.
 */
export const TAILLE_MAXIMALE = 512 * 1024 * 1024;

/**
 * Motifs de refus du relais. Ils voyagent jusqu'a l'ecran, pas jusqu'a une
 * decision : le serveur a deja tranche quand il les emet.
 */
export type MotifRefusUpload =
  | 'non_reserve' | 'type_refuse' | 'trop_gros' | 'corps_absent'
  | 'ecriture_echouee' | 'non_durable';

/**
 * Hotes qu'une URL rendue au navigateur ne doit JAMAIS porter.
 *
 * Le nom Docker en tete, parce que c'est celui qui est sorti. Les autres
 * parce qu'ils sortiraient de la meme facon si une variable etait mal
 * remplie : une adresse privee ou une boucle locale n'est joignable que
 * depuis le serveur, et l'echec serait tout aussi silencieux.
 */
const HOTES_INTERNES = /^(studiio-[a-z0-9-]+|localhost|.*\.local|.*\.internal|.*\.lan)$/i;

/** IPv4 privees, boucle locale, lien-local, et l'equivalent IPv6. */
const IP_PRIVEE =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$|\[?fc|\[?fd)/i;

/**
 * Cette URL peut-elle etre rendue a une page HTTPS ?
 *
 * Une URL RELATIVE est toujours sure : elle herite de l'origine de la page,
 * donc de son HTTPS. Une URL absolue doit etre `https:` et viser un hote
 * qui existe en dehors du serveur.
 *
 * C'est une garde de DERNIER RECOURS, appliquee a tout ce qui sort. Elle ne
 * remplace pas une configuration correcte -- elle garantit qu'une
 * configuration incorrecte echoue visiblement, ici, au lieu d'echouer dans
 * le navigateur d'un utilisateur au bout de huit megaoctets.
 */
export function urlSortieSure(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const hote = u.hostname;
  if (HOTES_INTERNES.test(hote)) return false;
  if (IP_PRIVEE.test(hote)) return false;
  // Un hote sans point n'est pas un nom public : c'est un nom de conteneur,
  // de service ou de machine locale.
  if (!hote.includes('.')) return false;
  return true;
}

/** Le relais same-origin, seule cible qui ne depend d'aucune variable. */
export function urlRelais(jobId: string): string {
  return `/api/render/jobs/${encodeURIComponent(jobId)}/upload`;
}

export interface CibleUpload {
  url: string;
  mode: 'direct' | 'relais';
}

/** Un client MinIO capable de signer, injecte pour les tests. */
export interface SigneurPresigne {
  presignedPutObject(bucket: string, cle: string, ttl: number): Promise<string>;
}

/**
 * Choisit la cible d'envoi pour une tentative.
 *
 * `signeur` est fourni par l'appelant ; `null` (endpoint public non
 * configure) fait directement tomber sur le relais. Une signature qui echoue
 * ou qui produit une URL non sure fait la meme chose : le relais marche
 * toujours, il est simplement plus lent.
 */
export async function cibleTeleversement(
  jobId: string, bucket: string, cle: string, signeur: SigneurPresigne | null,
): Promise<CibleUpload> {
  if (signeur) {
    try {
      const url = await signeur.presignedPutObject(bucket, cle, PRESIGNE_TTL_S);
      if (urlSortieSure(url)) return { url, mode: 'direct' };
      console.error('[Rendus] URL presignee refusee par la garde de sortie — repli sur le relais');
    } catch (e) {
      console.error('[Rendus] Signature impossible, repli sur le relais :', e);
    }
  }
  return { url: urlRelais(jobId), mode: 'relais' };
}

/**
 * L'URL de LECTURE du montage, garantie sure.
 *
 * `PUBLIC_STORAGE_URL` peut etre mal remplie exactement comme l'endpoint
 * d'ecriture l'etait. Si elle ne passe pas la garde, on rend le chemin
 * relatif : la page le resout sur sa propre origine, en HTTPS.
 */
export function urlPubliqueRendu(bucket: string, cle: string): string {
  const relatif = `/storage/v1/object/public/${bucket}/${cle}`;
  const base = process.env.PUBLIC_STORAGE_URL
    || (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/storage/v1/object/public`
      : '');
  if (!base) return relatif;
  const candidat = `${base.replace(/\/+$/, '')}/${bucket}/${cle}`;
  return urlSortieSure(candidat) ? candidat : relatif;
}

/** Le type annonce est-il acceptable pour un montage ? */
export function typeTeleversementAutorise(contentType: string): boolean {
  const t = (contentType || '').split(';')[0].trim().toLowerCase();
  return (TYPES_TELEVERSEMENT as readonly string[]).includes(t);
}

export type { ClientStockage };
