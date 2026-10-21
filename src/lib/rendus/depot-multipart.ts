/**
 * Envoi DECOUPE d'un montage vers son depot — la partie serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI S'ETAIT PASSE (prod, 02fedad)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le montage (WebM de 62 Mo) partait en UN SEUL `PUT` vers l'URL presignee
 * `s3.studiio.pro`, par un `fetch` sans delai, sans reprise, sans progression.
 * La requete est morte en `net::ERR_TIMED_OUT` : aucun point de reprise, tout
 * le transfert perdu, « L'envoi du montage a echoue ». Les rushes, eux,
 * partaient deja en morceaux de 8 Mio (`/api/upload/multipart`, #319) : seul
 * le montage paye etait reste sur l'envoi en un bloc.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE CHANGE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - La cle ecrite est le DEPOT (`cleDepot`) de la ligne `rendus` : jamais
 *     choisie par le navigateur, jamais la cle du rendu. `/confirm` reste la
 *     seule porte qui recopie le depot et debite, apres l'avoir vu.
 *   - Aucune action n'est acceptee hors `reserved`.
 *   - Sans endpoint public, rien ici : `indisponible`, et le client reprend
 *     le chemin historique (relais) — comportement inchange.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SERVEUR VERIFIE A LA FIN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les morceaux sont relus chez MinIO (`listParts`) : le navigateur n'a pas a
 * lire l'`ETag` (en-tete CORS), et il ne peut pas recoller autre chose que ce
 * qui est reellement depose. Numeros contigus 1..N, somme des tailles egale
 * a la taille annoncee, puis `statObject` du depot a la meme taille. Tout
 * ecart : envoi abandonne, depot efface, refus.
 */
import { cleDepot, TAILLE_MAXIMALE, typeTeleversementAutorise, urlSortieSure } from '@/lib/rendus/cible-upload';
import type { ClientEnvoiDecoupe } from '@/lib/storage/minio-client';

/** Validite d'une URL de morceau. Signee juste avant CHAQUE essai. */
export const PARTIE_TTL_S = 600;

/** Minimum S3 pour tout morceau sauf le dernier. */
export const TAILLE_PARTIE_MIN = 5 * 1024 * 1024;

export type ActionDecoupe =
  | 'multipart-initiate' | 'multipart-sign' | 'multipart-complete' | 'multipart-abort';

export const ACTIONS_DECOUPE: readonly ActionDecoupe[] = [
  'multipart-initiate', 'multipart-sign', 'multipart-complete', 'multipart-abort',
];

export interface LigneRenduDecoupe {
  id: string;
  bucket: string;
  cle_objet: string;
  etat: string;
}

export interface DependancesDecoupe {
  client: ClientEnvoiDecoupe;
  signeur: {
    signerPartie(bucket: string, cle: string, uploadId: string, partNumber: number, ttl: number): Promise<string>;
  } | null;
  /** Garde de sortie des URL signees ; `urlSortieSure` par defaut. */
  urlSure?: (url: string) => boolean;
}

export interface Reponse {
  status: number;
  body: Record<string, unknown>;
}

const refus = (status: number, motif: string, error: string): Reponse =>
  ({ status, body: { ok: false, motif, error } });

/** Un identifiant d'envoi plausible — jamais injecte tel quel ailleurs. */
function uploadIdValide(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 1024 && /^[A-Za-z0-9._~+/=-]+$/.test(v);
}

/**
 * Traite une action d'envoi decoupe pour UNE tentative deja relue et
 * appartenant a l'appelant. Bucket et cle viennent de la ligne.
 */
export async function traiterActionDecoupe(
  rendu: LigneRenduDecoupe,
  action: ActionDecoupe,
  corps: Record<string, unknown>,
  deps: DependancesDecoupe,
): Promise<Reponse> {
  const urlSure = deps.urlSure ?? urlSortieSure;
  const bucket = rendu.bucket;
  const depot = cleDepot(rendu.cle_objet);

  // L'abandon reste permis quelle que soit l'etat : il ne fait que liberer
  // des morceaux orphelins, il n'ecrit rien.
  if (action === 'multipart-abort') {
    if (!uploadIdValide(corps.uploadId)) return refus(400, 'parametres', 'uploadId manquant');
    try { await deps.client.abandonner(bucket, depot, corps.uploadId); } catch { /* deja clos */ }
    return { status: 200, body: { ok: true } };
  }

  if (rendu.etat !== 'reserved') {
    return { status: 409, body: { ok: false, motif: 'non_reserve', etat: rendu.etat, error: 'Tentative close' } };
  }
  // Sans endpoint public, pas d'envoi decoupe : le client reprend le relais.
  if (!deps.signeur) {
    return { status: 501, body: { ok: false, motif: 'indisponible', unsupported: true, error: 'Envoi decoupe indisponible' } };
  }

  if (action === 'multipart-initiate') {
    const taille = Number(corps.taille);
    if (!Number.isInteger(taille) || taille <= 0) return refus(400, 'parametres', 'taille invalide');
    if (taille > TAILLE_MAXIMALE) return refus(413, 'trop_gros', 'Montage trop volumineux');
    const contentType = String(corps.contentType || 'video/webm').split(';')[0].trim().toLowerCase();
    if (!typeTeleversementAutorise(contentType)) return refus(415, 'type_refuse', 'Type de fichier refuse');
    const uploadId = await deps.client.initier(bucket, depot, contentType);
    return { status: 200, body: { ok: true, uploadId } };
  }

  if (!uploadIdValide(corps.uploadId)) return refus(400, 'parametres', 'uploadId manquant');
  const uploadId = corps.uploadId;

  if (action === 'multipart-sign') {
    const n = Number(corps.partNumber);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return refus(400, 'parametres', 'partNumber invalide');
    const url = await deps.signeur.signerPartie(bucket, depot, uploadId, n, PARTIE_TTL_S);
    // Meme garde de sortie que l'URL d'envoi en un bloc.
    if (!urlSure(url)) return refus(503, 'indisponible', 'Televersement indisponible');
    return { status: 200, body: { ok: true, url, expireDansS: PARTIE_TTL_S } };
  }

  // ── multipart-complete ──────────────────────────────────────────────
  const taille = Number(corps.taille);
  if (!Number.isInteger(taille) || taille <= 0 || taille > TAILLE_MAXIMALE) {
    return refus(400, 'parametres', 'taille invalide');
  }
  const parties = (await deps.client.lister(bucket, depot, uploadId))
    .slice()
    .sort((a, b) => a.part - b.part);
  const contigues = parties.length > 0 && parties.every((p, i) => p.part === i + 1);
  const somme = parties.reduce((s, p) => s + Number(p.size || 0), 0);
  // Un morceau intermediaire sous le minimum S3 ferait echouer l'assemblage ;
  // on le dit avant, avec le meme motif.
  const tropPetit = parties.slice(0, -1).some((p) => Number(p.size) < TAILLE_PARTIE_MIN);
  if (!contigues || somme !== taille || tropPetit) {
    try { await deps.client.abandonner(bucket, depot, uploadId); } catch { /* best-effort */ }
    return {
      status: 422,
      body: {
        ok: false, motif: 'incomplet', error: 'Envoi incomplet',
        recus: somme, attendus: taille, morceaux: parties.length,
      },
    };
  }
  await deps.client.terminer(bucket, depot, uploadId, parties.map((p) => ({ part: p.part, etag: p.etag })));

  // Preuve immediate : l'objet assemble existe, a la taille annoncee.
  let tailleDepot = -1;
  try {
    tailleDepot = Number((await deps.client.statObject(bucket, depot)).size ?? -1);
  } catch { /* traite ci-dessous */ }
  if (tailleDepot !== taille) {
    try { await deps.client.removeObject(bucket, depot); } catch { /* best-effort */ }
    return {
      status: 500,
      body: { ok: false, motif: 'non_durable', error: 'Assemblage non verifie', recus: tailleDepot, attendus: taille },
    };
  }
  return { status: 200, body: { ok: true, taille: tailleDepot, morceaux: parties.length } };
}
