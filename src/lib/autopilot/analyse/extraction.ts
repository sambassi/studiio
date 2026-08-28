/**
 * L'extraction locale : ce que le serveur MESURE d'un rush, lui-même.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA RÈGLE QUI GOUVERNE TOUT CE FICHIER : LE RUSH NE SE CHARGE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rush pèse couramment plusieurs centaines de méga-octets, et rien
 * n'empêche qu'il en pèse plusieurs milliers. Aucune ligne de ce module ne
 * doit donc :
 *
 *   • appeler `arrayBuffer()` / `blob()` / `text()` sur le rush,
 *   • en construire un `Buffer` complet,
 *   • le recopier dans `/tmp` ou ailleurs sur le disque,
 *   • passer par `downloadMediaToBuffer` / `downloadMediaToFile`.
 *
 * Le chemin est le suivant, et il n'y en a pas d'autre :
 *
 *   MinIO ──signature interne, TTL court──▶ URL http locale
 *        ──ffprobe / ffmpeg, protocole http, requêtes `Range`──▶
 *          quelques kilo-octets de JSON, quelques vignettes JPEG.
 *
 * C'est `-ss <seconde>` placé AVANT `-i` qui rend la chose possible : en
 * position d'entrée, il demande au démuxeur de se POSITIONNER, ce que le
 * protocole http traduit en requête `Range`. Placé après `-i`, le même
 * argument décoderait le fichier depuis le début — donc le téléchargerait en
 * entier. La position des arguments est ici une garantie de coût, pas un
 * détail de style.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'URL SIGNÉE NE SORT PAS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle est fabriquée sur le nom INTERNE du stockage (`studiio-minio`), donc
 * injouable ailleurs que sur le serveur, et elle vit quelques minutes. Elle
 * n'est ni rendue à l'appelant, ni écrite en base, ni journalisée : tout ce
 * qui remonte d'ici passe par `masquerUrls`, parce que ffmpeg répète
 * volontiers l'URL d'entrée dans ses messages d'erreur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ffprobe D'ABORD, ffmpeg EN REPLI — ET POURQUOI LES DEUX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ffmpeg-static`, la dépendance du projet, n'installe QU'UN binaire :
 * `ffmpeg`. Il n'y a pas de `ffprobe` à côté. En production, `ffprobe` existe
 * quand même — le `Dockerfile` installe le paquet Debian `ffmpeg`, qui livre
 * les deux — mais c'est une propriété observée de l'image, pas un contrat.
 *
 * On ne choisit donc pas entre les deux méthodes, on les ordonne :
 *
 *   • ffprobe rend du JSON. Un schéma, stable d'une version à l'autre, qui
 *     donne le fps en fraction exacte, la rotation en `side_data`, et
 *     distingue « pas de piste vidéo » de « fichier illisible ». C'est la
 *     mesure de référence.
 *   • ffmpeg `-i` ne rend que du texte destiné à un humain. On sait le lire,
 *     mais ce texte change de forme selon la version et n'expose ni le fps
 *     exact ni la taille du fichier. C'est un repli, pas un équivalent.
 *
 * Un `ENOENT` au lancement de ffprobe — et lui seul — bascule sur le repli.
 * Le champ `technique.sonde` dit toujours laquelle a produit la mesure, pour
 * qu'une donnée dégradée soit reconnaissable après coup.
 *
 * Aucune dépendance npm n'est ajoutée : `ffprobe-static` rendrait le repli
 * inutile, mais ferait payer ~30 Mo à toutes les installations pour couvrir
 * une absence qui ne se produit pas en production.
 */
import { execFile } from 'child_process';
import { bucketAutorise } from '@/lib/storage/buckets';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import { clientMinio, signeurInterne } from '@/lib/storage/minio-client';
import { vignettesValides, type VignetteAnalyse } from './contrat';

// ─────────────────────────────────────────────────────────────────────────
// Bornes
// ─────────────────────────────────────────────────────────────────────────

/** Plafond dur de vignettes. Huit images racontent un rush ; pas cinquante. */
export const VIGNETTES_MAX = 8;

/**
 * Où vont les vignettes. Doit appartenir à `ALLOWED_BUCKETS`.
 *
 * ⚠️ `media`, ET NON `images`, ET C'EST UNE DÉCISION DE RÉTENTION.
 *
 * Le nettoyage périodique (`/api/cron/cleanup-media`) ne balaie que `media`
 * et `audio`. Des vignettes rangées dans `images` ne seraient donc jamais
 * visitées : ni protégées, ni nettoyées — une fuite de stockage silencieuse
 * et permanente.
 *
 * L'inverse — ajouter `images` au balayage — ferait entrer sous rétention
 * tout le contenu préexistant de ce compartiment, avec de vraies
 * suppressions à la clé. On ne change pas le sort de données existantes pour
 * accommoder des données qui n'existent pas encore.
 *
 * `media` est aussi le compartiment du rush dont ces vignettes sont tirées.
 */
export const BUCKET_VIGNETTES = 'media';

/**
 * Durée de vie de l'URL signée, en secondes.
 *
 * Assez pour un sondage et huit extractions sur un fichier lent ; assez court
 * pour qu'une URL échappée par mégarde dans un journal ne serve plus à rien
 * le temps qu'on la lise.
 */
export const TTL_URL_SECONDES = 600;

/** Temps maximal accordé au sondage des métadonnées. */
export const TIMEOUT_SONDE_MS = 30_000;

/** Temps maximal accordé à UNE vignette. */
export const TIMEOUT_VIGNETTE_MS = 20_000;

/** Largeur maximale d'une vignette. La hauteur suit le rapport d'origine. */
export const LARGEUR_VIGNETTE = 640;

/** Plafond de sortie du sondage — le JSON de ffprobe tient en quelques Ko. */
const SORTIE_MAX_SONDE = 2 * 1024 * 1024;

/** Plafond de sortie d'une vignette. Une JPEG 640px en pèse ~60 Ko. */
const SORTIE_MAX_VIGNETTE = 8 * 1024 * 1024;

/**
 * Délai de lecture/écriture réseau imposé à ffmpeg, en MICROsecondes.
 *
 * Il existe pour que la socket rende la main AVANT le `timeout` du processus.
 * Sans lui, un stockage qui accepte la connexion puis se tait ferait attendre
 * ffmpeg jusqu'au `SIGKILL` — c'est-à-dire jusqu'au bout du budget, à chaque
 * vignette.
 */
const RW_TIMEOUT_US = '15000000';

// ─────────────────────────────────────────────────────────────────────────
// Vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les motifs d'échec. Fermé, comme les états de `contrat.ts`.
 *
 * Un motif libre finirait par contenir la sortie de ffmpeg — donc l'URL
 * signée, donc un secret — et personne ne pourrait plus compter les échecs
 * par cause.
 */
export const MOTIFS_EXTRACTION = [
  'cle_hors_perimetre',
  'objet_introuvable',
  'stockage_injoignable',
  'format_illisible',
  'extraction_impossible',
  'timeout',
] as const;
export type MotifExtraction = (typeof MOTIFS_EXTRACTION)[number];

export interface EntreeExtraction {
  bucket: string;
  cleObjet: string;
  userId: string;
  analysisId: string;
}

export interface ResultatExtraction {
  ok: boolean;
  motif: MotifExtraction | null;
  /**
   * Quelques mots sur l'échec, URLs masquées. Destiné au journal, jamais à
   * un compteur — c'est `motif` qui se compte.
   */
  detail: string | null;
  /** La durée MESURÉE, en secondes. `null` = pas mesurable. Jamais `0`. */
  dureeSecondes: number | null;
  /** Ce qui se mesure. Va tel quel dans `RushAnalysis.technique`. */
  technique: Record<string, unknown>;
  /** Des CLÉS, jamais des URLs. Validées par `vignettesValides`. */
  vignettes: VignetteAnalyse[];
}

// ─────────────────────────────────────────────────────────────────────────
// Point d'entrée
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mesure un rush et en tire au plus huit vignettes.
 *
 * Ne lève jamais : tout échec est un `motif`. Un moteur d'analyse qui doit
 * marquer une ligne `echouee` a besoin d'une cause, pas d'une exception à
 * rattraper — et une exception non rattrapée laisserait la ligne `en_cours`
 * pour toujours.
 *
 * Aucune reprise automatique. Chaque processus est lancé UNE fois : si le
 * stockage est en panne, réessayer trois fois de suite n'a jamais fait que
 * tripler l'attente avant le même échec. La reprise, si elle a lieu un jour,
 * appartient au moteur qui ordonnance les analyses.
 */
export async function extraireRush(entree: EntreeExtraction): Promise<ResultatExtraction> {
  try {
    return await executer(entree);
  } catch (e: unknown) {
    // Le filet, et il est là pour de bon. `clientMinio()` lève sur une
    // configuration incomplète, `require('minio')` lève sur un paquet
    // absent : sans ce `catch`, la promesse remonterait au moteur, qui
    // laisserait l'analyse `en_cours` pour toujours. Une ligne bloquée dans
    // un état actif est pire qu'un échec — le verrou d'unicité de M3-B1
    // interdit alors d'en relancer une.
    return {
      ok: false, motif: 'extraction_impossible',
      detail: masquerUrls(e instanceof Error ? e.message : String(e)).slice(0, 400),
      dureeSecondes: null, technique: {}, vignettes: [],
    };
  }
}

async function executer(entree: EntreeExtraction): Promise<ResultatExtraction> {
  const vide = (motif: MotifExtraction, detail?: string): ResultatExtraction => ({
    ok: false, motif, detail: detail ? masquerUrls(detail).slice(0, 400) : null,
    dureeSecondes: null, technique: {}, vignettes: [],
  });

  // ── 1. Le périmètre, avant tout accès ────────────────────────────────
  //
  // Mêmes gardes que `verifierObjet`, PAS le même module : celui-là valide
  // un MONTAGE et n'accepte que quatre types MIME. Un rush est ce que
  // l'utilisateur a filmé — du Matroska, de l'AVI — et le refuser sur son
  // type serait refuser un fichier parfaitement analysable. Seule la liste
  // blanche des compartiments est partagée, parce qu'une seconde liste
  // divergerait de la première.
  if (!bucketAutorise(entree.bucket)) return vide('cle_hors_perimetre', 'compartiment refusé');
  if (!identifiantSur(entree.userId)) return vide('cle_hors_perimetre', 'userId inexploitable');
  if (!identifiantSur(entree.analysisId)) return vide('cle_hors_perimetre', 'analysisId inexploitable');

  const cle = entree.cleObjet;
  // Le préfixe EST la preuve de propriété : les clés sont fabriquées par le
  // serveur sous la forme `<userId>/…`. Qu'un objet EXISTE ne prouve rien.
  if (typeof cle !== 'string' || !cle.startsWith(`${entree.userId}/`)) {
    return vide('cle_hors_perimetre', 'clé hors du préfixe utilisateur');
  }
  // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
  if (cle.includes('..') || cle.includes('://')) {
    return vide('cle_hors_perimetre', 'clé malformée');
  }

  // ── 2. L'objet existe-t-il ? ──────────────────────────────────────────
  //
  // Sondé AVANT la signature : une URL signée vers un objet absent produit
  // un « 404 » que ffmpeg range dans la même case qu'un fichier corrompu, et
  // « rush disparu » ne se soigne pas comme « rush illisible ».
  let taille = 0;
  try {
    const stat = await clientMinio().statObject(entree.bucket, cle);
    taille = Number(stat?.size ?? 0);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const absent = /not found|does not exist|NoSuchKey|NotFound/i.test(message);
    return vide(absent ? 'objet_introuvable' : 'stockage_injoignable', message);
  }
  if (taille <= 0) return vide('objet_introuvable', 'objet de taille nulle');

  // ── 3. L'URL signée, interne et brève ─────────────────────────────────
  const signeur = signeurInterne();
  if (!signeur) return vide('stockage_injoignable', 'stockage non configuré');

  let url: string;
  try {
    url = await signeur.presignedGetObject(entree.bucket, cle, TTL_URL_SECONDES);
  } catch (e: unknown) {
    return vide('stockage_injoignable', e instanceof Error ? e.message : String(e));
  }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return vide('stockage_injoignable', 'URL signée inexploitable');
  }

  // ── 4. Le sondage ─────────────────────────────────────────────────────
  const sonde = await sonder(url);
  if (!sonde.ok) return vide(sonde.motif ?? 'extraction_impossible', sonde.detail);

  const technique: Record<string, unknown> = { ...sonde.technique, tailleOctets: taille };
  const duree = sonde.dureeSecondes;

  // ── 5. Les vignettes ──────────────────────────────────────────────────
  //
  // Une vignette manquante n'annule PAS une mesure réussie : la durée et les
  // dimensions sont ce dont dépendent les lots suivants, les images ne sont
  // qu'un confort de lecture. On rend ce qu'on a pu produire.
  const vignettes = duree !== null && technique.codecVideo
    ? await produireVignettes(url, duree, entree)
    : [];

  return { ok: true, motif: null, detail: null, dureeSecondes: duree, technique, vignettes };
}

// ─────────────────────────────────────────────────────────────────────────
// Sondage
// ─────────────────────────────────────────────────────────────────────────

interface Sondage {
  ok: boolean;
  /** Renseigné SEULEMENT quand `ok` est faux. Un succès n'a pas de motif. */
  motif: MotifExtraction | null;
  detail: string;
  dureeSecondes: number | null;
  technique: Record<string, unknown>;
}

async function sonder(url: string): Promise<Sondage> {
  const parFfprobe = await sonderFfprobe(url);
  // Seule l'ABSENCE du binaire justifie le repli. Un fichier que ffprobe
  // déclare illisible l'est aussi pour ffmpeg : réessayer avec l'autre outil
  // ne ferait que retarder le même verdict.
  if (parFfprobe.motif !== 'extraction_impossible' || !parFfprobe.detail.includes('ENOENT')) {
    return parFfprobe;
  }
  return sonderFfmpeg(url);
}

/** ffprobe, en JSON. La mesure de référence. */
async function sonderFfprobe(url: string): Promise<Sondage> {
  const r = await lancer(cheminFfprobe(), [
    '-hide_banner',
    '-loglevel', 'error',
    // Options de PROTOCOLE, obligatoirement avant `-i`.
    '-rw_timeout', RW_TIMEOUT_US,
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    // L'URL est UN ARGUMENT du tableau. Elle n'est jamais concaténée dans une
    // ligne de commande, et aucun shell n'est lancé : rien de ce qu'elle
    // contient ne peut être relu comme un opérateur.
    '-i', url,
  ], { timeoutMs: TIMEOUT_SONDE_MS, maxSortie: SORTIE_MAX_SONDE });

  if (r.timeout) return echec('timeout', 'ffprobe interrompu');
  if (r.introuvable) return echec('extraction_impossible', 'ffprobe absent (ENOENT)');

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(r.stdout.toString('utf8')) as Record<string, unknown>;
  } catch {
    return echec(r.code === 0 ? 'extraction_impossible' : 'format_illisible', r.stderr);
  }

  const format = objet(json.format);
  const flux = Array.isArray(json.streams) ? json.streams as Record<string, unknown>[] : [];
  const video = flux.find((f) => f.codec_type === 'video');
  const audio = flux.find((f) => f.codec_type === 'audio');

  // Un conteneur sans piste vidéo n'est pas un rush. C'est peut-être un bon
  // fichier — un MP3 est un bon fichier — mais pas quelque chose dont on
  // puisse tirer une vignette.
  if (!video) return echec('format_illisible', 'aucune piste vidéo');

  const technique: Record<string, unknown> = {
    sonde: 'ffprobe',
    conteneur: texte(format.format_name),
    codecVideo: texte(video.codec_name),
    largeur: entier(video.width),
    hauteur: entier(video.height),
    fps: fraction(video.avg_frame_rate) ?? fraction(video.r_frame_rate),
    bitrate: entier(format.bit_rate) ?? entier(video.bit_rate),
    rotation: rotationDepuisFlux(video),
    aAudio: Boolean(audio),
    codecAudio: audio ? texte(audio.codec_name) : undefined,
    canauxAudio: audio ? entier(audio.channels) : undefined,
    frequenceAudio: audio ? entier(audio.sample_rate) : undefined,
  };

  const duree = dureePositive(format.duration) ?? dureePositive(video.duration);
  return { ok: true, motif: null, detail: '', dureeSecondes: duree, technique: elaguer(technique) };
}

/**
 * ffmpeg `-i`, stderr lu à la main. Le repli.
 *
 * ⚠️ `ffmpeg -i <entrée>` SANS sortie se termine TOUJOURS en code 1, sur
 * « At least one output file must be specified ». Le code de retour ne dit
 * donc rien ici : c'est d'avoir su lire une piste vidéo qui fait le succès.
 */
async function sonderFfmpeg(url: string): Promise<Sondage> {
  const r = await lancer(cheminFfmpeg(), [
    '-hide_banner',
    '-nostdin',
    '-rw_timeout', RW_TIMEOUT_US,
    '-i', url,
  ], { timeoutMs: TIMEOUT_SONDE_MS, maxSortie: SORTIE_MAX_SONDE });

  if (r.timeout) return echec('timeout', 'ffmpeg interrompu');
  if (r.introuvable) return echec('extraction_impossible', 'ffmpeg absent (ENOENT)');

  const err = r.stderr;
  const video = /Stream #\d+:\d+[^\n]*: Video: ([^\s,(]+)[^\n]*/.exec(err);
  if (!video) return echec('format_illisible', err);

  const ligneVideo = video[0];
  const dims = /, (\d{2,5})x(\d{2,5})[\s,]/.exec(ligneVideo);
  const fps = /([\d.]+) fps/.exec(ligneVideo);
  const debitVideo = /(\d+) kb\/s/.exec(ligneVideo);
  const conteneur = /Input #\d+, ([^,]+), from/.exec(err);
  const rotation = /rotation of (-?[\d.]+) degrees/.exec(err);
  const audio = /Stream #\d+:\d+[^\n]*: Audio: ([^\s,(]+)[^\n]*/.exec(err);
  const freq = audio ? /(\d+) Hz/.exec(audio[0]) : null;
  const dureeTexte = /Duration: (\d+):(\d{2}):(\d{2}\.\d+)/.exec(err);
  const debitGlobal = /bitrate: (\d+) kb\/s/.exec(err);

  const technique: Record<string, unknown> = {
    sonde: 'ffmpeg',
    conteneur: conteneur ? conteneur[1].trim() : undefined,
    codecVideo: video[1],
    largeur: dims ? Number(dims[1]) : undefined,
    hauteur: dims ? Number(dims[2]) : undefined,
    fps: fps ? Number(fps[1]) : undefined,
    bitrate: debitGlobal ? Number(debitGlobal[1]) * 1000
      : debitVideo ? Number(debitVideo[1]) * 1000 : undefined,
    rotation: rotation ? normaliserRotation(Number(rotation[1])) : undefined,
    aAudio: Boolean(audio),
    codecAudio: audio ? audio[1] : undefined,
    // `stereo` / `mono` / `5.1` : ffmpeg nomme la disposition, il ne compte
    // pas les canaux. On ne traduit que ce qui ne prête pas à discussion.
    canauxAudio: audio ? (/\bmono\b/.test(audio[0]) ? 1 : /\bstereo\b/.test(audio[0]) ? 2 : undefined) : undefined,
    frequenceAudio: freq ? Number(freq[1]) : undefined,
  };

  const duree = dureeTexte
    ? Number(dureeTexte[1]) * 3600 + Number(dureeTexte[2]) * 60 + Number(dureeTexte[3])
    : null;

  return {
    ok: true, motif: null, detail: '',
    dureeSecondes: duree && duree > 0 ? arrondir(duree) : null,
    technique: elaguer(technique),
  };
}

function echec(motif: MotifExtraction, detail: string): Sondage {
  return { ok: false, motif, detail: masquerUrls(detail).slice(0, 400), dureeSecondes: null, technique: {} };
}

// ─────────────────────────────────────────────────────────────────────────
// Vignettes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Où poser les vignettes sur la durée.
 *
 * Aux MILIEUX de tranches égales, pas aux bornes : la première image d'un
 * rush est souvent noire, la dernière aussi, et une vignette noire n'apprend
 * rien. Une vidéo de trois secondes donne trois vignettes, pas huit — huit
 * images d'un même instant ne sont pas huit informations.
 */
export function positionsVignettes(dureeSecondes: number): number[] {
  if (!Number.isFinite(dureeSecondes) || dureeSecondes <= 0) return [];
  const n = Math.min(VIGNETTES_MAX, Math.max(1, Math.floor(dureeSecondes)));
  return Array.from({ length: n }, (_, i) => arrondir(((i + 0.5) * dureeSecondes) / n));
}

async function produireVignettes(
  url: string, duree: number, entree: EntreeExtraction,
): Promise<VignetteAnalyse[]> {
  const client = clientMinio();
  const produites: VignetteAnalyse[] = [];

  for (const [index, seconde] of positionsVignettes(duree).entries()) {
    const r = await lancer(cheminFfmpeg(), [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-rw_timeout', RW_TIMEOUT_US,
      // ⚠️ `-ss` AVANT `-i` : positionnement du démuxeur, donc requête
      // `Range`. Après `-i`, ffmpeg décoderait depuis la première image et
      // téléchargerait tout le rush pour rendre une seule vignette.
      '-ss', String(seconde),
      '-i', url,
      '-frames:v', '1',
      // La vignette est bornée en largeur : ce qui revient tient en quelques
      // dizaines de kilo-octets, et le plafond de `maxBuffer` n'est jamais
      // le mécanisme qui protège la mémoire — seulement le dernier filet.
      '-vf', `scale='min(${LARGEUR_VIGNETTE},iw)':-2`,
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '5',
      // `-` : la JPEG revient par stdout. Aucun fichier temporaire, donc
      // aucun fichier oublié le jour où le processus meurt entre deux images.
      '-',
    ], { timeoutMs: TIMEOUT_VIGNETTE_MS, maxSortie: SORTIE_MAX_VIGNETTE });

    // Un échec de vignette est SILENCIEUX pour l'appelant et non fatal :
    // certaines positions tombent sur une zone sans image clé exploitable, et
    // perdre la mesure entière pour cela serait absurde.
    if (r.timeout || r.introuvable || r.code !== 0 || r.stdout.length === 0) continue;

    const cle = `${entree.userId}/analyse/${entree.analysisId}/vignette-${String(index + 1).padStart(2, '0')}.jpg`;
    try {
      await client.putObject(
        BUCKET_VIGNETTES, cle, r.stdout, r.stdout.length,
        { 'Content-Type': 'image/jpeg' },
      );
    } catch {
      continue;
    }
    produites.push({ bucket: BUCKET_VIGNETTES, cle, seconde });
  }

  // Repassées par le contrat de M3-B1 avant de sortir. Ce n'est pas une
  // politesse : si un jour ce module fabriquait une clé contenant `://` ou
  // visait un compartiment hors liste, l'erreur serait attrapée ici plutôt
  // qu'au moment de l'écriture en base.
  const controle = vignettesValides(produites);
  return controle.ok ? controle.valeur : [];
}

// ─────────────────────────────────────────────────────────────────────────
// Lancement de processus
// ─────────────────────────────────────────────────────────────────────────

interface SortieProcessus {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timeout: boolean;
  introuvable: boolean;
}

/**
 * Lance un binaire et rend sa sortie. Ne lève jamais.
 *
 * Quatre garanties, toutes nécessaires :
 *
 * 1. `execFile` avec un TABLEAU d'arguments, sans `shell`. Aucune chaîne
 *    n'est interprétée : l'URL signée, ses `&` et son `+` compris, arrive au
 *    binaire telle quelle et ne peut rien enchaîner.
 * 2. `timeout` + `killSignal: 'SIGKILL'`. Un `SIGTERM` sur un ffmpeg bloqué
 *    sur une socket peut n'être traité qu'à la prochaine boucle — c'est-à-dire
 *    jamais. `SIGKILL` ne se négocie pas : pas de zombie.
 * 3. `maxBuffer`. Node tue le processus dès que la sortie dépasse la borne,
 *    ce qui empêche une entrée hostile ou un binaire devenu bavard de faire
 *    grossir le tas indéfiniment.
 * 4. `stderr` tronqué et URLs masquées AVANT de revenir. Ce que ffmpeg écrit
 *    contient l'URL d'entrée dès qu'il échoue.
 */
function lancer(
  binaire: string, args: string[], opts: { timeoutMs: number; maxSortie: number },
): Promise<SortieProcessus> {
  return new Promise((resolve) => {
    execFile(binaire, args, {
      timeout: opts.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: opts.maxSortie,
      encoding: 'buffer',
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string }) | null;
      resolve({
        code: err ? (typeof e?.code === 'number' ? e.code : null) : 0,
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
        stderr: masquerUrls(
          (Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')),
        ).slice(-8000),
        timeout: Boolean(e?.killed) || e?.signal === 'SIGKILL',
        introuvable: e?.code === 'ENOENT',
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────────────────

/**
 * Remplace toute URL par un jeton.
 *
 * Volontairement AVEUGLE à l'URL précise qu'on vient de signer : masquer
 * uniquement celle-là laisserait passer une redirection, une URL réécrite par
 * ffmpeg, ou la même avec un paramètre en plus. Ce qui ressemble à une URL
 * disparaît, point.
 */
export function masquerUrls(texte: string): string {
  return String(texte ?? '').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url-masquee>');
}

/**
 * Un identifiant utilisable dans une clé d'objet.
 *
 * Les UUID passent. Tout ce qui porte `/`, `.` ou un caractère de contrôle
 * est refusé : ces trois-là sont précisément ce qui permettrait à une clé
 * fabriquée ici de sortir du préfixe de son propriétaire.
 */
function identifiantSur(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(valeur);
}

function objet(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function texte(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function entier(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** `"30000/1001"` → `29.97`. Le `0/0` de ffprobe rend `undefined`. */
function fraction(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v.includes('/')) return undefined;
  const [num, den] = v.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num <= 0) return undefined;
  return arrondir(num / den);
}

function dureePositive(v: unknown): number | null {
  const n = Number(v);
  // `0` est refusé sciemment : la table n'accepte jamais `0` pour une durée,
  // parce qu'un zéro se lit comme « vide » là où il veut dire « non mesurée ».
  return Number.isFinite(n) && n > 0 ? arrondir(n) : null;
}

/** ffprobe 5+ met la rotation dans `side_data_list` ; les vieux, dans `tags`. */
function rotationDepuisFlux(flux: Record<string, unknown>): number | undefined {
  const liste = Array.isArray(flux.side_data_list) ? flux.side_data_list as Record<string, unknown>[] : [];
  for (const sd of liste) {
    const r = Number(sd.rotation);
    if (Number.isFinite(r)) return normaliserRotation(r);
  }
  const tags = objet(flux.tags);
  const r = Number(tags.rotate);
  return Number.isFinite(r) ? normaliserRotation(r) : undefined;
}

/** `-90` et `270` décrivent la même image. On n'en garde qu'une écriture. */
function normaliserRotation(degres: number): number {
  const n = Math.round(degres) % 360;
  return n < 0 ? n + 360 : n;
}

function arrondir(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Retire les champs qu'on n'a pas su mesurer, plutôt que de stocker `undefined`. */
function elaguer(o: Record<string, unknown>): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) sortie[k] = v;
  return sortie;
}
