/**
 * M3-F — LA DÉCOUPE ET LE TÉLÉVERSEMENT D'UN CLIP.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ RÉENCODAGE, ET NON COPIE DE FLUX — LA MESURE, PAS L'INTUITION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La copie de flux est cent fois plus rapide et serait le premier réflexe.
 * Elle ne peut pourtant commencer que sur une IMAGE-CLÉ, et les images-clés
 * d'un rush réel ne tombent pas là où l'on coupe. Sur les cinq coupes réelles
 * du rush de production, l'écart entre la borne demandée et le premier octet
 * réellement copié valait −231, −490, −820 et −994 ms.
 *
 * M3-E venait de déplacer une borne de quarante millisecondes pour ne pas
 * couper un mot : la copie de flux annulerait ce travail par un facteur
 * vingt. Le réencodage, sur les mêmes coupes, tombe à +3…+13 ms — la durée
 * d'une image. On paie donc du CPU pour tenir la promesse du lot précédent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT NULLE PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • aucun `shell` : `execFile` avec un TABLEAU d'arguments, comme partout
 *     ailleurs — l'URL signée et ses `&` ne peuvent rien enchaîner ;
 *   • aucune URL rendue, journalisée ou persistée : elle est fabriquée sur le
 *     nom INTERNE du stockage, vit quelques minutes, et tout ce qui remonte
 *     d'ici passe par `masquerUrls` ;
 *   • aucun fichier qui survive : un répertoire par jeu, supprimé dans un
 *     `finally` dont l'échec est RENDU, jamais avalé — la leçon de M3-D2 ;
 *   • aucun crédit, aucun fournisseur, aucun réseau sortant.
 */
import { mkdtemp, rm, stat } from 'fs/promises';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { bucketAutorise } from '@/lib/storage/buckets';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import { clientMinio, signeurInterne } from '@/lib/storage/minio-client';
import {
  BORNE_MINIO, TTL_URL_SECONDES, PROTOCOLES_AUTORISES, masquerUrls, lancer,
} from './extraction';
import {
  BUCKET_CLIPS, CONTENT_TYPE, CRF, PRESET, PIXEL_FORMAT,
  AUDIO_BITRATE, AUDIO_FREQUENCE, CLIP_OCTETS_MAX,
  TIMEOUT_CLIP_MS, TIMEOUT_TELEVERSEMENT_MS,
  arrondirSeconde, nombreFini, cleClip,
  type ClipMaterialise, type MotifClips,
} from './clip-contrat';
import type { Coupe } from './coupe-contrat';

/** Délai de lecture/écriture réseau imposé à ffmpeg, en MICROsecondes. */
const RW_TIMEOUT_US = '15000000';

/** Plafond du tampon de sortie d'un processus. `stderr` n'est ici qu'une cause. */
const SORTIE_MAX = 2 * 1024 * 1024;

/**
 * Les arguments de la découpe. Exportés pour être PROUVABLES.
 *
 * Chacun porte une garantie qu'un test peut vérifier sans exécuter ffmpeg :
 *
 *   • `-protocol_whitelist` ferme la porte SSRF qu'ouvrirait un fichier
 *     reconnu comme playlist HLS — le conteneur voisine la base et MinIO ;
 *   • `-ss` / `-to` AVANT `-i` : c'est ce qui rend la recherche à la fois
 *     rapide et exacte, le décodeur repartant de l'image-clé précédente et
 *     jetant ce qui précède la borne ;
 *   • `-map 0:a:0?` : le point d'interrogation est ce qui fait qu'un rush
 *     MUET ne fait pas échouer la découpe — vérifié, le clip sort avec sa
 *     seule piste vidéo ;
 *   • `-sn -dn` : ni sous-titres ni données, qui n'ont rien à faire dans un
 *     intermédiaire de montage ;
 *   • `+faststart` : l'index en tête, sans quoi un navigateur doit tout
 *     télécharger avant d'afficher la première image.
 *
 * Le codec, la résolution et la cadence de la SOURCE sont conservés :
 * normaliser à l'aveugle dégraderait un rush déjà conforme. Les sources
 * exotiques sont une dette assumée du lot suivant.
 */
export function argumentsDecoupe(url: string, coupe: Coupe, sortie: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
    '-protocol_whitelist', PROTOCOLES_AUTORISES,
    '-rw_timeout', RW_TIMEOUT_US,
    '-ss', String(coupe.debutSecondes),
    '-to', String(coupe.finSecondes),
    '-i', url,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF),
    '-pix_fmt', PIXEL_FORMAT,
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ar', String(AUDIO_FREQUENCE),
    '-movflags', '+faststart',
    '-y', sortie,
  ];
}

/** Les arguments de la mesure. Ce que le fichier PRODUIT contient vraiment. */
export function argumentsMesure(fichier: string): string[] {
  return [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration:stream=nb_frames,start_time',
    '-of', 'json',
    fichier,
  ];
}

export interface SourceRush {
  bucket: string;
  cleObjet: string;
  userId: string;
}

export type ResultatClip =
  | { ok: true; clip: ClipMaterialise }
  | { ok: false; motif: MotifClips };

/**
 * Une URL signée, interne et brève, sur le rush.
 *
 * Elle ne sort JAMAIS de ce module : elle est passée à ffmpeg et oubliée.
 * Le périmètre est vérifié ici plutôt que supposé fait en amont — une garde
 * qu'on suppose tenue ailleurs est une garde absente.
 */
export async function signerSource(
  source: SourceRush,
): Promise<{ ok: true; url: string } | { ok: false; motif: MotifClips }> {
  if (!bucketAutorise(source.bucket)) return { ok: false, motif: 'source_inaccessible' };
  if (typeof source.userId !== 'string' || !/^[\w-]{1,64}$/.test(source.userId)) {
    return { ok: false, motif: 'source_inaccessible' };
  }
  const cle = source.cleObjet;
  // Le préfixe EST la preuve de propriété. Qu'un objet EXISTE ne prouve rien.
  if (typeof cle !== 'string' || !cle.startsWith(`${source.userId}/`)) {
    return { ok: false, motif: 'source_inaccessible' };
  }
  // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
  if (cle.includes('..') || cle.includes('://')) {
    return { ok: false, motif: 'source_inaccessible' };
  }

  const signeur = signeurInterne(BORNE_MINIO);
  if (!signeur) return { ok: false, motif: 'source_inaccessible' };
  try {
    const url = await signeur.presignedGetObject(source.bucket, cle, TTL_URL_SECONDES);
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return { ok: false, motif: 'source_inaccessible' };
    }
    return { ok: true, url };
  } catch {
    // Le message n'est PAS repris : il nomme l'hôte du stockage.
    return { ok: false, motif: 'source_inaccessible' };
  }
}

/**
 * Ce que `ffprobe` lit dans le fichier produit.
 *
 * Rendu `null` plutôt que deviné : une mesure absente se dit, elle ne
 * s'invente pas. Elle sert à rendre la précision auditable, pas à décider.
 */
export function lireMesure(json: string): { debut: number | null; duree: number | null } {
  try {
    const o = JSON.parse(json) as {
      format?: { duration?: unknown };
      streams?: Array<{ start_time?: unknown }>;
    };
    const duree = nombreFini(o.format?.duration);
    const debut = nombreFini(o.streams?.[0]?.start_time);
    return {
      debut: debut === null ? null : arrondirSeconde(debut),
      duree: duree === null ? null : arrondirSeconde(duree),
    };
  } catch {
    return { debut: null, duree: null };
  }
}

/**
 * Découpe UNE coupe et la téléverse.
 *
 * Ne lève jamais : tout échec est un motif fermé. Le fichier temporaire est
 * la responsabilité de l'appelant, qui possède le répertoire du jeu — c'est
 * lui qui garantit la suppression, pour tous les clips d'un coup.
 */
export async function materialiserClip(entree: {
  url: string;
  coupe: Coupe;
  userId: string;
  clipSetId: string;
  dossier: string;
}): Promise<ResultatClip> {
  const { url, coupe, userId, clipSetId, dossier } = entree;
  const sortie = join(dossier, `rang-${String(coupe.rang).padStart(2, '0')}.mp4`);

  // ── 1. La découpe ────────────────────────────────────────────────────
  const proc = await lancer(cheminFfmpeg(), argumentsDecoupe(url, coupe, sortie), {
    timeoutMs: TIMEOUT_CLIP_MS, maxSortie: SORTIE_MAX,
  });
  if (proc.introuvable) return { ok: false, motif: 'outil_absent' };
  if (proc.timeout) return { ok: false, motif: 'timeout' };
  // Un code non nul couvre le rush illisible ET l'intervalle impossible. Les
  // deux se disent `media_illisible` : dans les deux cas la découpe n'a pas
  // eu lieu, et c'est la seule chose qu'on ait le droit d'affirmer.
  if (proc.code !== 0) return { ok: false, motif: 'media_illisible' };

  let octets: number;
  try { octets = (await stat(sortie)).size; } catch { return { ok: false, motif: 'extraction_echouee' }; }
  // ffmpeg peut sortir 0 sur un intervalle vide : un fichier sans octet n'est
  // pas un clip, et l'envoyer au stockage serait le pire des résultats.
  if (octets <= 0) return { ok: false, motif: 'extraction_echouee' };
  if (octets > CLIP_OCTETS_MAX) return { ok: false, motif: 'extraction_echouee' };

  // ── 2. La mesure — ce que le fichier CONTIENT, pas ce qu'on espérait ──
  const mesure = await lancer(cheminFfprobe(), argumentsMesure(sortie), {
    timeoutMs: 20_000, maxSortie: SORTIE_MAX,
  });
  const lu = mesure.code === 0
    ? lireMesure(mesure.stdout.toString('utf8'))
    : { debut: null, duree: null };

  // ── 3. Le téléversement ──────────────────────────────────────────────
  //
  // ⚠️ LA CLÉ VIENT DU SERVEUR. Elle est fabriquée depuis la session et
  // l'identifiant du jeu ; aucun fragment ne vient de l'appelant.
  const cle = cleClip(userId, clipSetId, coupe.rang);
  let corps: Buffer;
  try { corps = await readFile(sortie); } catch { return { ok: false, motif: 'extraction_echouee' }; }

  try {
    await Promise.race([
      clientMinio(BORNE_MINIO).putObject(
        BUCKET_CLIPS, cle, corps, corps.length, { 'Content-Type': CONTENT_TYPE },
      ),
      new Promise((_, rejeter) => setTimeout(
        () => rejeter(new Error('delai televersement')), TIMEOUT_TELEVERSEMENT_MS,
      )),
    ]);
  } catch {
    // Le message n'est PAS repris : il nomme l'hôte du stockage.
    return { ok: false, motif: 'televersement_echoue' };
  }

  return {
    ok: true,
    clip: {
      rang: coupe.rang,
      debutSecondes: coupe.debutSecondes,
      finSecondes: coupe.finSecondes,
      dureeSecondes: coupe.dureeSecondes,
      bucket: BUCKET_CLIPS,
      cle,
      octets,
      debutMesureSecondes: lu.debut,
      dureeMesureeSecondes: lu.duree,
    },
  };
}

/**
 * Supprime un objet déjà téléversé. Best-effort, et l'issue est RENDUE.
 *
 * ⚠️ Le jeu est ATOMIQUE : si le troisième clip échoue, les deux premiers
 * n'ont plus de raison d'exister. Mais il n'existe aucune transaction commune
 * à PostgreSQL et à MinIO — la suppression peut rater, et le taire laisserait
 * des objets orphelins sans qu'aucun signal n'existe. On ne promet donc pas
 * ce qu'on ne tient pas : on rapporte.
 */
export async function supprimerObjet(bucket: string, cle: string): Promise<boolean> {
  try {
    const client = clientMinio(BORNE_MINIO) as unknown as {
      removeObject?: (b: string, c: string) => Promise<unknown>;
    };
    if (typeof client.removeObject !== 'function') return false;
    await client.removeObject(bucket, cle);
    return true;
  } catch {
    return false;
  }
}

/** Crée le répertoire temporaire d'un jeu. Le nom ne porte rien de l'appelant. */
export async function ouvrirDossier(): Promise<string | null> {
  try {
    return await mkdtemp(join(tmpdir(), 'studiio-m3f-'));
  } catch {
    return null;
  }
}

/**
 * Supprime le répertoire d'un jeu. Rend `false` si la suppression a raté.
 *
 * Comme en M3-D2 : « tentée », jamais « garantie ». `rm` échoue sur `EBUSY`,
 * `EPERM`, un volume en lecture seule. Avaler l'erreur permettrait d'écrire
 * que rien ne survit ; ce serait faux, et faux en silence — le disque se
 * remplirait un clip à la fois.
 */
export async function fermerDossier(dossier: string): Promise<boolean> {
  try {
    await rm(dossier, { recursive: true, force: true });
    return true;
  } catch {
    // Le message système n'est pas repris : il contient le chemin.
    return false;
  }
}

/** Ce que le journal a le droit de dire d'une sortie de processus. */
export function diagnosticSur(stderr: string): string {
  return masquerUrls(String(stderr ?? '')).slice(-200);
}
