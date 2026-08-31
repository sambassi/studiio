/**
 * M3-D2 — L'EXTRACTION DE LA PISTE AUDIO, POUR ENVOI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DIFFÉRENCE AVEC M3-D1, ET ELLE EST TOTALE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-D1 MESURE : `-f null -`, la sortie décodée part au trou noir, il n'y a
 * aucun fichier à supprimer. M3-D2 doit ENVOYER : il faut donc produire des
 * octets, et un fichier temporaire devient inévitable.
 *
 * C'est la seule nouveauté risquée du lot. Un `finally` manqué remplit le
 * disque du conteneur, silencieusement, un fichier par transcription.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI CE MODULE N'EXPOSE PAS UN CHEMIN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une fonction qui rendrait `{ chemin }` ferait dépendre la suppression de la
 * discipline de son appelant — et l'appelant, un jour, prend une sortie
 * anticipée qu'il n'avait pas prévue. `avecAudioFlac` prend le TRAVAIL en
 * argument et enveloppe TOUT dans son propre `finally` : la suppression est
 * TENTÉE que le travail réussisse, échoue, ou lève.
 *
 * ⚠️ « TENTÉE », ET NON « GARANTIE ». `rm` peut échouer — `EBUSY`, `EPERM`,
 * un volume monté en lecture seule. Avaler cette erreur permettrait d'écrire
 * ici que le fichier ne survit jamais ; ce serait faux, et faux en silence :
 * le disque se remplirait un FLAC à la fois sans que rien ne l'annonce.
 *
 * L'issue du nettoyage est donc RENDUE (`nettoyage: 'ok' | 'echoue'`), et
 * l'appelant en fait quelque chose. Ce qu'il n'en fait PAS : relancer le
 * fournisseur. Le nettoyage a lieu APRÈS le travail — un résultat déjà obtenu
 * et déjà payé ne se rejette pas parce qu'un `rm` a raté.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EXISTE NULLE PART ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • aucun objet écrit dans MinIO — ce FLAC ne doit jamais devenir un média
 *     de plus à stocker, à signer et à purger ;
 *   • aucune URL présignée rendue à l'appelant : elle est fabriquée sur le
 *     nom INTERNE du stockage, elle vit quelques minutes, et tout ce qui
 *     remonte d'ici passe par `masquerUrls` ;
 *   • aucun `Buffer` du rush : ffmpeg lit l'URL, écrit le FLAC, et rien ne
 *     transite par le tas de Node.
 */
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { bucketAutorise } from '@/lib/storage/buckets';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { signeurInterne } from '@/lib/storage/minio-client';
import {
  BORNE_MINIO, TIMEOUT_MINIO_MS, TTL_URL_SECONDES, PROTOCOLES_AUTORISES, lancer,
} from './extraction';
import {
  FLAC_OCTETS_MAX, type MotifTranscription, type Nettoyage,
} from './transcription-contrat';

// ─────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Temps maximal accordé à l'extraction FLAC.
 *
 * La même valeur que la passe de mesure de M3-D1, et pour la même raison : la
 * bande son est entrelacée sur toute la durée du fichier, elle ne se lit pas
 * par requêtes `Range` — ffmpeg traverse le rush entier. Au-delà de deux
 * minutes, ce n'est plus « c'est long », c'est « le stockage ne suit pas ».
 */
export const TIMEOUT_FLAC_MS = 120_000;

/** Le pire cas de `avecAudioFlac` : une signature MinIO, puis la passe. */
export const BUDGET_FLAC_MS = TIMEOUT_MINIO_MS + TIMEOUT_FLAC_MS;

/**
 * Délai de lecture/écriture réseau imposé à ffmpeg, en MICROsecondes.
 *
 * Il existe pour que la socket rende la main AVANT le `timeout` du processus.
 * Sans lui, un stockage qui accepte la connexion puis se tait ferait attendre
 * ffmpeg jusqu'au `SIGKILL`, c'est-à-dire jusqu'au bout du budget.
 */
const RW_TIMEOUT_US = '15000000';

/** Plafond du tampon de sortie du processus. Ici `stderr` n'est qu'une cause d'échec. */
const SORTIE_MAX_FLAC = 2 * 1024 * 1024;

/**
 * Le format, tel que la documentation du fournisseur le recommande.
 *
 * 16 kHz mono FLAC : lossless, ~8 ko/s sur de la parole, soit moins de la
 * moitié d'un WAV PCM 16 bits à débit égal. Whisper travaille de toute façon
 * en 16 kHz mono — envoyer du 48 kHz stéréo, c'est payer le transfert d'une
 * information que le modèle jette.
 *
 * ⚠️ `-map 0:a:0` ET NON `-map 0:a`. La documentation du fournisseur précise
 * que seule la première piste d'un fichier multi-pistes est transcrite :
 * autant n'en envoyer qu'une, choisie par nous, plutôt que d'expédier des
 * octets qui seront ignorés — et de laisser le fournisseur décider laquelle.
 */
export const FREQUENCE_HZ = 16_000;
export const CANAUX = 1;

export interface EntreeAudioFlac {
  bucket: string;
  cleObjet: string;
  userId: string;
}

export interface FichierFlac {
  /** Le chemin local, valable UNIQUEMENT pendant le travail. */
  chemin: string;
  octets: number;
}

export type ResultatAudioFlac<T> =
  | { ok: true; valeur: T; octets: number; nettoyage: Nettoyage }
  | { ok: false; motif: MotifTranscription; nettoyage: Nettoyage };

/**
 * Les arguments de l'extraction. Exportés pour être PROUVABLES.
 *
 * Chacun porte une garantie qu'un test peut vérifier sans exécuter ffmpeg :
 * la liste blanche de protocoles ferme la porte SSRF qu'ouvrirait un fichier
 * reconnu comme playlist HLS ou `ffconcat` (le conteneur voisine
 * `studiio-postgrest` et `studiio-db`) ; `-vn -sn -dn` prouve qu'aucune image
 * n'est décodée ; `-ar/-ac/-c:a flac` prouvent le format envoyé.
 */
export function argumentsFlac(url: string, sortie: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
    // ⚠️ L'URL D'ENTRÉE EST SÛRE ; LE CONTENU DU FICHIER NE L'EST PAS.
    '-protocol_whitelist', PROTOCOLES_AUTORISES,
    '-rw_timeout', RW_TIMEOUT_US,
    '-i', url,
    '-vn', '-sn', '-dn',
    '-map', '0:a:0',
    '-ar', String(FREQUENCE_HZ),
    '-ac', String(CANAUX),
    '-c:a', 'flac',
    // `-y` : le fichier vient d'être créé par `mkdtemp`, il n'y a rien à
    // écraser. Il est là pour qu'aucune invite interactive ne puisse bloquer
    // un processus sans terminal.
    '-y', sortie,
  ];
}

/**
 * Extrait la piste audio dans un FLAC temporaire, exécute `travail` dessus,
 * puis SUPPRIME le répertoire — quoi qu'il arrive.
 *
 * Ne lève jamais pour ses propres pannes : tout échec est un `motif`. Une
 * exception levée par `travail`, en revanche, remonte — mais après le
 * nettoyage.
 */
export async function avecAudioFlac<T>(
  entree: EntreeAudioFlac,
  travail: (fichier: FichierFlac) => Promise<T>,
): Promise<ResultatAudioFlac<T>> {
  // Les refus qui arrivent AVANT la création du répertoire n'ont rien à
  // nettoyer : leur nettoyage est `ok` parce qu'il n'y avait rien à faire, et
  // non parce qu'on aurait réussi quelque chose.
  const refus = (motif: MotifTranscription): ResultatAudioFlac<T> => (
    { ok: false, motif, nettoyage: 'ok' }
  );

  // ── 1. Le périmètre, avant tout accès ────────────────────────────────
  //
  // Les mêmes gardes qu'en M3-B2 et M3-D1, répétées plutôt que supposées :
  // une garde qu'on suppose faite en amont est une garde absente.
  if (!bucketAutorise(entree.bucket)) return refus('cle_hors_perimetre');
  if (typeof entree.userId !== 'string' || !/^[\w-]{1,64}$/.test(entree.userId)) {
    return refus('cle_hors_perimetre');
  }
  const cle = entree.cleObjet;
  // Le préfixe EST la preuve de propriété. Qu'un objet EXISTE ne prouve rien.
  if (typeof cle !== 'string' || !cle.startsWith(`${entree.userId}/`)) {
    return refus('cle_hors_perimetre');
  }
  // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
  if (cle.includes('..') || cle.includes('://')) return refus('cle_hors_perimetre');

  // ── 2. L'URL signée, interne et brève ────────────────────────────────
  const signeur = signeurInterne(BORNE_MINIO);
  if (!signeur) return refus('stockage_injoignable');

  let url: string;
  try {
    url = await signeur.presignedGetObject(entree.bucket, cle, TTL_URL_SECONDES);
  } catch {
    // Le message n'est PAS repris : il peut nommer un hôte de stockage.
    return refus('stockage_injoignable');
  }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return refus('stockage_injoignable');
  }

  // ── 3. Le répertoire temporaire ──────────────────────────────────────
  let dossier: string;
  try {
    dossier = await mkdtemp(join(tmpdir(), 'studiio-m3d2-'));
  } catch {
    return refus('stockage_injoignable');
  }

  // ⚠️ À PARTIR D'ICI, IL Y A QUELQUE CHOSE À SUPPRIMER, ET LA SUPPRESSION
  // PEUT RATER. Le résultat porte donc son issue jusqu'à l'appelant.
  let nettoyageRate = false;
  let sortieResultat: ResultatAudioFlac<T>;
  try {
    const sortie = join(dossier, 'piste.flac');

    const proc = await lancer(cheminFfmpeg(), argumentsFlac(url, sortie), {
      timeoutMs: TIMEOUT_FLAC_MS,
      maxSortie: SORTIE_MAX_FLAC,
    });

    if (proc.introuvable) sortieResultat = refus('outil_absent');
    else if (proc.timeout) sortieResultat = refus('timeout');
    // Un code non nul couvre le fichier illisible ET l'absence de la piste
    // que `-map 0:a:0` réclamait. Les deux se disent `audio_illisible` : dans
    // les deux cas l'extraction n'a PAS eu lieu, et c'est la seule chose
    // qu'on ait le droit d'affirmer.
    else if (proc.code !== 0) sortieResultat = refus('audio_illisible');
    else {
      let octets: number | null = null;
      try { octets = (await stat(sortie)).size; } catch { octets = null; }

      // ffmpeg peut sortir 0 sur une piste vide : un FLAC sans échantillon
      // n'est pas un échec de transfert, c'est un fichier qu'il ne sert à
      // rien d'envoyer.
      if (octets === null || octets <= 0) sortieResultat = refus('audio_illisible');
      // ⚠️ LA BORNE EST VÉRIFIÉE ICI, AVANT le travail — donc avant l'appel
      // payant. Refuser après avoir envoyé serait payer pour rien ; tronquer
      // serait rendre un texte amputé sans le dire.
      else if (octets > FLAC_OCTETS_MAX) sortieResultat = refus('audio_trop_long');
      else {
        sortieResultat = {
          ok: true,
          valeur: await travail({ chemin: sortie, octets }),
          octets,
          nettoyage: 'ok',
        };
      }
    }
  } finally {
    // LA suppression, tentée quoi qu'il arrive : succès, refus contrôlé,
    // exception du travail, dépassement de délai. `force` pour qu'un
    // répertoire déjà disparu ne compte pas comme un échec.
    //
    // ⚠️ SON ÉCHEC EST CONSIGNÉ, JAMAIS AVALÉ. Une erreur d'`unlink` est rare
    // et anormale : la taire laisserait le disque se remplir sans qu'aucun
    // signal n'existe. Elle n'est PAS transformée en échec de transcription
    // pour autant — voir `MOTIF_NETTOYAGE_ECHOUE`.
    //
    // Le message système n'est pas repris : il contient le CHEMIN.
    try {
      await rm(dossier, { recursive: true, force: true });
    } catch {
      nettoyageRate = true;
    }
  }

  // ⚠️ SI `travail` LÈVE, L'EXCEPTION PART SANS L'ISSUE DU NETTOYAGE.
  //
  // C'est pourquoi `transcrireRush` rattrape l'échec du fournisseur DANS le
  // travail, et ne laisse rien traverser : sans cela, le seul chemin où le
  // nettoyage rate ET où on ne le saurait pas serait précisément celui d'un
  // fournisseur en panne — le moment où le disque a le plus de chances de
  // garder un fichier.
  //
  // L'issue est reportée ici, après le `finally` qui l'a établie.
  return nettoyageRate ? { ...sortieResultat, nettoyage: 'echoue' } : sortieResultat;
}
