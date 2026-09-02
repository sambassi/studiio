/**
 * M3-H — L'EXÉCUTION : DU PLAN AUX ARGUMENTS, ET DES ARGUMENTS AU FICHIER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN SEUL PASSAGE, ET AUCUNE DÉCISION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les N plans sont découpés, recadrés, mis à l'échelle et concaténés dans un
 * UNIQUE `filter_complex`. Réencoder chaque plan puis réencoder le tout
 * ajouterait une génération de perte pour rien.
 *
 * Tout ce qui est appliqué ici vient du plan persisté : l'ordre, les durées,
 * les rectangles, le format, la cadence. Ce module ne calcule aucune borne et
 * ne recadre rien de sa propre initiative — il TRADUIT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT NULLE PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • aucun `shell` : `execFile` avec un TABLEAU d'arguments, comme M3-F —
 *     un chemin ou une durée ne peuvent rien enchaîner ;
 *   • aucune URL rendue, journalisée ou persistée : tout ce qui remonte
 *     d'ici passe par `masquerUrls` ;
 *   • aucun fichier qui survive : un répertoire par rendu, supprimé dans un
 *     `finally` dont l'échec est RENDU, jamais avalé — la leçon de M3-D2 ;
 *   • aucun crédit, aucun fournisseur, aucun réseau sortant hors du stockage.
 */
import { mkdtemp, rm, stat } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { bucketAutorise } from '@/lib/storage/buckets';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import { clientMinio, lecteurMinio } from '@/lib/storage/minio-client';
import { masquerUrls, lancer } from './extraction';
import { arrondirSeconde, nombreFini } from './clip-contrat';
import type { Recadrage } from './montage-contrat';
import {
  AUDIO_BITRATE_RENDU, AUDIO_FREQUENCE_RENDU, CRF_RENDU, PIXEL_FORMAT_RENDU,
  PRESET_RENDU, RENDU_OCTETS_MAX, TIMEOUT_MESURE_MS, TIMEOUT_TRANSFERT_SOURCE_MS,
  TIMEOUT_TELEVERSEMENT_RENDU_MS, BUCKET_RENDUS_MONTAGE, CONTENT_TYPE_RENDU,
  COMPOSANT_CLE, cleRendu, cleValide, timeoutEncodage,
  type MotifRendu, type RenduMaterialise,
} from './rendu-contrat';

/** Le plafond de sortie d'un processus : ffprobe rend un JSON, pas un flux. */
const SORTIE_MAX = 1024 * 1024;

// ───────────────────────────────────────────────────────────────────────────
// Le répertoire de travail
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un répertoire par rendu, au nom tiré au sort par le système.
 *
 * ⚠️ `mkdtemp` ET NON UN NOM DÉRIVÉ DE L'IDENTIFIANT. Un chemin construit sur
 * le `renduId` serait devinable et réutilisable : deux rendus qui se
 * chevauchent — l'un relancé après une péremption mal calibrée — écriraient
 * dans le même dossier. Le suffixe aléatoire rend la collision impossible.
 */
export async function ouvrirDossierRendu(): Promise<string | null> {
  try {
    return await mkdtemp(join(tmpdir(), 'studiio-m3h-'));
  } catch {
    return null;
  }
}

/**
 * Supprime le répertoire, et DIT si elle a échoué.
 *
 * L'échec est rendu, jamais avalé : un disque qui ne se vide plus est un
 * incident, pas un détail. Le message système n'est pas repris — il contient
 * le chemin.
 */
export async function fermerDossierRendu(dossier: string): Promise<boolean> {
  try {
    await rm(dossier, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Le nom local d'une source : FABRIQUÉ à partir du RANG, jamais de la clé.
 *
 * ⚠️ LA CLÉ PERSISTÉE NE DOIT PAS DEVENIR UN CHEMIN. Elle contient des `/`,
 * et rien n'interdit à une ligne écrite par une version future d'y glisser
 * `..`. Un nom dérivé du rang — un entier que le plan borne — ne peut
 * désigner que le dossier du rendu, et deux plans du même montage ne peuvent
 * pas se recouvrir.
 */
export function nomSourceLocale(dossier: string, indice: number): string {
  // ⚠️ UN ENTIER DU SERVEUR, PAS UN CHAMP DU PLAN. `padStart` sur une chaîne
  // plus longue que deux caractères est un no-op : un `ordre` resté chaîne
  // dans le `jsonb` traverserait intact. L'indice de boucle ne le peut pas.
  const i = Math.max(0, Math.floor(Number(indice) || 0));
  return join(dossier, `src-${String(i).padStart(2, '0')}.mp4`);
}

// ───────────────────────────────────────────────────────────────────────────
// Le recadrage, calculé ICI et non dans ffmpeg
// ───────────────────────────────────────────────────────────────────────────

export interface RectangleCrop {
  largeur: number; hauteur: number; x: number; y: number;
}

/**
 * Traduit le rectangle NORMALISÉ du plan en pixels entiers et PAIRS.
 *
 * ⚠️ CALCULÉ EN TYPESCRIPT, JAMAIS PAR UNE EXPRESSION FFMPEG. `crop` accepte
 * des expressions, mais avec son défaut `exact=0` il RABOTE silencieusement
 * la largeur sur l'alignement chroma — 607,5 devient 606 sans un mot. Une
 * valeur calculée ici est testable sans lancer ffmpeg, comme
 * `argumentsDecoupe` de M3-F.
 *
 * Arrondi au pair le PLUS PROCHE, et non tronqué : 1920 × 0,316406 = 607,4995
 * donne 608, alors que la troncature donnerait 606 — deux pixels plus loin de
 * ce que le plan demande. `yuv420p` sous-échantillonne la chrominance par
 * deux : une dimension impaire est refusée.
 *
 * Le rectangle est ensuite RAMENÉ DANS LA SOURCE : un arrondi vers le haut
 * près du bord ferait sortir le cadre, et ffmpeg échouerait sur un plan
 * pourtant valide.
 */
export function rectangleCrop(
  largeurSource: number, hauteurSource: number, recadrage: Recadrage,
): RectangleCrop | null {
  const ls = nombreFini(largeurSource);
  const hs = nombreFini(hauteurSource);
  if (ls === null || hs === null || ls < 2 || hs < 2) return null;

  const fractions = [recadrage?.x, recadrage?.y, recadrage?.largeur, recadrage?.hauteur]
    .map((v) => nombreFini(v));
  if (fractions.some((v) => v === null || v < 0 || v > 1)) return null;
  const [fx, fy, fl, fh] = fractions as number[];
  if (fl <= 0 || fh <= 0) return null;

  // ⚠️ UN RECTANGLE QUI SORT DU CADRE EST REFUSÉ, JAMAIS REPOSITIONNÉ.
  //
  // Le clamp plus bas existe pour l'ARRONDI — les deux pixels gagnés en
  // montant au pair supérieur près du bord. Il ne doit pas servir à rattraper
  // un plan qui demande vraiment l'impossible : `x = 0,9` avec
  // `largeur = 0,9` se retrouvait déplacé de 1536 pixels, et le montage
  // sortait cadré ailleurs que là où M3-G l'avait décidé — sans un mot. M3-G
  // décide, M3-H exécute ou refuse ; il ne réinterprète pas.
  //
  // Le seuil est exprimé en PIXELS et non en fractions : `0,1 + 0,9` vaut
  // 1,0000000000000002 en virgule flottante, et refuser là-dessus
  // condamnerait un plan parfaitement légitime. Un pixel de dépassement est
  // du bruit de représentation ; au-delà, c'est une intention.
  if (ls * (fx + fl) > ls + 1) return null;
  if (hs * (fy + fh) > hs + 1) return null;

  // ⚠️ DEUX ARRONDIS, ET NON UN SEUL. Une DIMENSION ne peut pas valoir zéro —
  // `yuv420p` sous-échantillonne par deux, un côté nul n'est pas une image.
  // Une COORDONNÉE, si : un plan qui demande `x = 0` demande le bord gauche,
  // et le forcer à 2 déplacerait le cadre de deux pixels par rapport à ce que
  // M3-G a décidé. Confondre les deux revenait à ne pas appliquer le plan.
  const dimension = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const coordonnee = (v: number) => Math.max(0, Math.round(v / 2) * 2);

  const largeur = Math.min(dimension(ls * fl), Math.floor(ls / 2) * 2);
  const hauteur = Math.min(dimension(hs * fh), Math.floor(hs / 2) * 2);

  // Ramené dans la source : un arrondi vers le haut près du bord ferait
  // sortir le cadre, et ffmpeg échouerait sur un plan pourtant valide.
  const x = Math.min(coordonnee(ls * fx), Math.floor((ls - largeur) / 2) * 2);
  const y = Math.min(coordonnee(hs * fy), Math.floor((hs - hauteur) / 2) * 2);

  return { largeur, hauteur, x, y };
}

// ───────────────────────────────────────────────────────────────────────────
// Les arguments
// ───────────────────────────────────────────────────────────────────────────

export interface SourceLocale {
  /** L'ordre du plan. C'est lui qui décide de la place, jamais le nom. */
  ordre: number;
  chemin: string;
  entreeSecondes: number;
  dureeRetenueSecondes: number;
  crop: RectangleCrop;
  /** Le fichier porte-t-il une piste audio ? Constaté, jamais supposé. */
  aAudio: boolean;
}

export interface CibleRendu {
  largeur: number; hauteur: number; fps: number;
}

/** Le nombre de décimales d'une durée : le pas de la base et du contrat. */
function duree(v: number): string {
  return String(arrondirSeconde(v));
}

/**
 * Les arguments de l'unique passage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CHAQUE MORCEAU GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • `-protocol_whitelist file` : les entrées sont des fichiers LOCAUX. La
 *     valeur de M3-F (`http,https,tcp,tls`) les refuserait, et l'inverse —
 *     tout autoriser — laisserait un MP4 reconnu comme liste de lecture
 *     ouvrir des ressources distantes. Les octets viennent de l'utilisateur.
 *   • `-f mp4` devant CHAQUE entrée : ferme la détection de démuxeur à la
 *     source. Un fichier maquillé ne peut pas se faire passer pour autre
 *     chose.
 *   • `trim=start=..:duration=..` : les deux champs du plan, sans
 *     arithmétique — `duration` se compte depuis `start`.
 *   • `setpts=PTS-STARTPTS` : INDISPENSABLE. `trim` ne réécrit pas les
 *     horodatages ; sans remise à zéro, le second segment arriverait avec des
 *     PTS déjà consommés, et la jonction gèlerait.
 *   • `crop` puis `scale` puis `setsar=1` : `concat` compare le rapport de
 *     pixel, et `crop`/`scale` le PROPAGENT. Un clip anamorphique sortirait
 *     en 1080×1920 avec un SAR faux — la résolution mesurée serait juste et
 *     l'image étirée.
 *   • `fps=N` dans chaque branche ET `-r N` en sortie : le filtre normalise
 *     une source à cadence variable, l'option épingle la base de temps.
 *   • `aformat` + `aresample` : `concat` exige la même fréquence, le même
 *     format d'échantillon et la même disposition de canaux. Un rush mono
 *     mêlé à du stéréo ferait échouer le graphe.
 *   • `-map_metadata -1 -map_chapters -1` : un rush de téléphone porte la
 *     date de prise de vue et souvent les COORDONNÉES GPS. Elles n'ont rien à
 *     faire dans un fichier destiné à être publié.
 *   • `+faststart` : l'index en tête. Le défaut inverse est exactement le bug
 *     que le dépôt documente — un `moov` en fin de fichier qui empêche la
 *     lecture en flux.
 */
export function argumentsRendu(
  sources: readonly SourceLocale[], cible: CibleRendu, sortie: string,
): string[] {
  const ordonnees = [...sources].sort((a, b) => a.ordre - b.ordre);
  // ⚠️ TOUT LE MONTAGE PORTE DE L'AUDIO, OU AUCUN. `concat` exige le même
  // nombre de flux par segment ; le silence comble les sources muettes plutôt
  // que de sacrifier le son des autres.
  const avecAudio = ordonnees.some((s) => s.aAudio);

  const entrees: string[] = [];
  const chaines: string[] = [];
  const liens: string[] = [];

  ordonnees.forEach((s, i) => {
    entrees.push('-f', 'mp4', '-i', s.chemin);
    const d = duree(s.dureeRetenueSecondes);
    const debut = duree(s.entreeSecondes);
    const c = s.crop;
    chaines.push(
      `[${i}:v]trim=start=${debut}:duration=${d},setpts=PTS-STARTPTS,`
      + `crop=${c.largeur}:${c.hauteur}:${c.x}:${c.y},`
      + `scale=${cible.largeur}:${cible.hauteur}:flags=bicubic,setsar=1,`
      + `fps=${cible.fps},format=${PIXEL_FORMAT_RENDU}[v${i}]`,
    );
    liens.push(`[v${i}]`);
    if (!avecAudio) return;
    chaines.push(
      s.aAudio
        ? `[${i}:a]atrim=start=${debut}:duration=${d},asetpts=PTS-STARTPTS,`
          + `aresample=${AUDIO_FREQUENCE_RENDU},`
          + `aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
        // Le silence n'est pas du contenu inventé : c'est la représentation
        // exacte d'une absence de son, et il est compté dans `usage`.
        : `anullsrc=r=${AUDIO_FREQUENCE_RENDU}:cl=stereo,`
          + `atrim=duration=${d},asetpts=PTS-STARTPTS,`
          + `aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
    );
    liens.push(`[a${i}]`);
  });

  // ⚠️ LES PADS S'ENTRELACENT PAR SEGMENT — `[v0][a0][v1][a1]…`, jamais tous
  // les `v` puis tous les `a`. L'erreur produit un montage mélangé, sans
  // aucun message.
  const filtre = `${chaines.join(';')};${liens.join('')}`
    + `concat=n=${ordonnees.length}:v=1:a=${avecAudio ? 1 : 0}`
    + `[vout]${avecAudio ? '[aout]' : ''}`;

  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
    '-protocol_whitelist', 'file',
    ...entrees,
    '-filter_complex', filtre,
    '-map', '[vout]',
    ...(avecAudio ? ['-map', '[aout]'] : []),
    '-c:v', 'libx264', '-preset', PRESET_RENDU, '-crf', String(CRF_RENDU),
    '-pix_fmt', PIXEL_FORMAT_RENDU, '-r', String(cible.fps),
    ...(avecAudio
      ? ['-c:a', 'aac', '-b:a', AUDIO_BITRATE_RENDU,
        '-ar', String(AUDIO_FREQUENCE_RENDU), '-ac', '2']
      : ['-an']),
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-movflags', '+faststart', '-y', sortie,
  ];
}

/** La sonde qui dit si une source porte de l'audio. Une passe, avant le graphe. */
export function argumentsSondeSource(fichier: string): string[] {
  return [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height',
    '-of', 'json', fichier,
  ];
}

/**
 * La mesure du fichier produit.
 *
 * ⚠️ SANS `-select_streams v:0`, CONTRAIREMENT À M3-F. Le filtrer rendrait
 * l'audio invisible, et `aAudio` serait faux pour tout le monde. Conséquence :
 * les flux ne sont plus indexés par position — on les retrouve par
 * `codec_type`, jamais par `streams[0]`.
 */
export function argumentsMesureRendu(fichier: string): string[] {
  return [
    '-v', 'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,'
    + 'r_frame_rate,avg_frame_rate,pix_fmt,sample_rate,channels',
    '-of', 'json', fichier,
  ];
}

/**
 * Ce que la mesure locale sait dire — tout `RenduMaterialise` SAUF l'adresse.
 *
 * ⚠️ DÉRIVÉ DU TYPE DE H1, ET NON RÉÉCRIT. Le compartiment et la clé ne sont
 * connus qu'au téléversement ; le jour où un champ sera ajouté au contrat,
 * cette mesure cassera à la compilation au lieu de rendre un objet incomplet.
 */
export type MesureRendu = Omit<RenduMaterialise, 'bucket' | 'cle'> & {
  /**
   * Deux champs de PLUS que `RenduMaterialise`, et ils ne s'y ajoutent pas.
   *
   * Le format de pixel et la fréquence audio servent à VALIDER le fichier ;
   * ils n'ont pas à être persistés une fois la validation passée. Les
   * déclarer ici plutôt que de les faire transiter par un `as` évite qu'un
   * cast masque un jour leur disparition.
   */
  pixelFormat: string;
  frequenceAudio: number | null;
};

/** Une fraction ffprobe (`30/1`, `30000/1001`) en nombre, ou `null`. */
export function fractionEnNombre(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const [n, d] = v.split('/');
  const num = nombreFini(n);
  const den = nombreFini(d ?? '1');
  // `0/0` est ce que ffprobe rend sur un flux sans cadence — un flux audio.
  if (num === null || den === null || den === 0) return null;
  return num / den;
}

export function lireMesureRendu(json: string, octets: number): MesureRendu | null {
  try {
    const o = JSON.parse(json) as {
      format?: { duration?: unknown };
      streams?: Array<Record<string, unknown>>;
    };
    const flux = Array.isArray(o.streams) ? o.streams : [];
    const video = flux.find((f) => f.codec_type === 'video');
    const audio = flux.find((f) => f.codec_type === 'audio');
    if (!video) return null;

    const dureeMesureeSecondes = nombreFini(o.format?.duration);
    const largeur = nombreFini(video.width);
    const hauteur = nombreFini(video.height);
    if (dureeMesureeSecondes === null || largeur === null || hauteur === null) return null;

    return {
      octets,
      dureeMesureeSecondes: arrondirSeconde(dureeMesureeSecondes),
      largeur,
      hauteur,
      // `r_frame_rate` est la cadence DÉCLARÉE, celle qu'x264 écrit en
      // cadence constante. `avg_frame_rate` vaut images/durée : il dérive
      // dès que la durée est rognée d'un quantum, sur un fichier pourtant
      // sain, et le comparer à une tolérance produirait un faux rejet.
      fpsMesure: fractionEnNombre(video.r_frame_rate),
      codecVideo: typeof video.codec_name === 'string' ? video.codec_name : '',
      pixelFormat: typeof video.pix_fmt === 'string' ? video.pix_fmt : '',
      aAudio: Boolean(audio),
      codecAudio: audio && typeof audio.codec_name === 'string' ? audio.codec_name : null,
      frequenceAudio: audio ? nombreFini(audio.sample_rate) : null,
    };
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Le téléchargement des sources
// ───────────────────────────────────────────────────────────────────────────

export interface SourceDistante {
  ordre: number;
  bucket: string;
  cle: string;
}

/**
 * Descend une source dans le répertoire du rendu.
 *
 * ⚠️ LES MÊMES GARDES QUE `signerSource` DE M3-F, ET DANS LE MÊME ORDRE. Le
 * compartiment doit être autorisé, et la clé doit vivre sous le préfixe de
 * l'utilisateur : qu'un objet EXISTE ne prouve rien, c'est le préfixe qui
 * prouve à qui il appartient. Le plan est persisté côté serveur, mais ses
 * champs restent du `text` en base — une ligne écrite par une version future
 * ne doit pas pouvoir faire lire l'espace d'un tiers.
 */
export async function descendreSource(
  userId: string, source: SourceDistante, dossier: string, indice: number,
): Promise<{ ok: true; chemin: string; octets: number } | { ok: false; motif: MotifRendu }> {
  // ⚠️ LES TROIS GARDES DE `signerSource`, DANS LE MÊME ORDRE ET POUR LA MÊME
  // RAISON. Le plan est persisté côté serveur, mais ses `bucket` et `cle`
  // restent du `text` dans un `jsonb` : `planValide` de M3-G ne refuse
  // aujourd'hui que `://`, PAS `..` — contrairement à son jumeau `clipValide`
  // de M3-F, qui refuse les deux. La garde est donc posée ICI, à la lecture,
  // avant le moindre accès au stockage.
  if (!COMPOSANT_CLE.test(userId)) return { ok: false, motif: 'source_inaccessible' };
  if (!bucketAutorise(source.bucket)) return { ok: false, motif: 'source_inaccessible' };
  if (!cleValide(source.cle, userId)) return { ok: false, motif: 'source_inaccessible' };

  const chemin = nomSourceLocale(dossier, indice);
  try {
    // ⚠️ AUCUNE URL SIGNÉE N'EST PRODUITE, NULLE PART.
    //
    // H1 avait dimensionné `TTL_SOURCE_RENDU_SECONDES` en supposant qu'on
    // signerait chaque source pour la télécharger. Lire par la connexion
    // interne rend cette signature INUTILE : ffmpeg ne voit que des fichiers
    // locaux, il n'y a donc ni signature à faire expirer, ni fenêtre d'accès
    // à borner. Le risque que la TTL protégeait n'existe pas sur ce chemin.
    //
    // ⚠️ ET LE FLUX VA DIRECTEMENT AU DISQUE. `lecteurMinio` avertit qu'il ne
    // matérialise rien en mémoire « et que l'appelant doit se garder de le
    // faire » : un clip pèse jusqu'à 64 Mio, six en mémoire tiendraient mal
    // sur les trois gigaoctets disponibles. `pipeline` les écrit au fil de
    // l'eau et propage l'échec.
    const flux = await lecteurMinio({ timeoutMs: TIMEOUT_TRANSFERT_SOURCE_MS })
      .getObject(source.bucket, source.cle);
    await pipeline(flux, createWriteStream(chemin));
  } catch (e: unknown) {
    // ⚠️ UNE PANNE D'INFRA N'EST PAS UNE SOURCE INACCESSIBLE. Le `catch`
    // couvre aussi l'écriture locale : imputer un disque plein à la source de
    // l'utilisateur l'enverrait chercher un problème qui n'est pas le sien.
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOSPC' || code === 'EDQUOT') {
      return { ok: false, motif: 'capacite_saturee' };
    }
    // Le message nomme l'hôte du stockage : il ne remonte pas.
    return { ok: false, motif: 'source_inaccessible' };
  }

  try {
    const { size } = await stat(chemin);
    // Un objet vide n'est pas une source : ffmpeg échouerait plus loin, avec
    // un diagnostic moins clair.
    if (size <= 0) return { ok: false, motif: 'clip_illisible' };
    return { ok: true, chemin, octets: size };
  } catch {
    return { ok: false, motif: 'clip_illisible' };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Les lancements
// ───────────────────────────────────────────────────────────────────────────

export interface ResultatProcessus {
  ok: boolean;
  motif: MotifRendu | null;
  /** Ce que le processus a écrit, MASQUÉ et tronqué. Pour le journal seul. */
  diagnostic: string;
}

/** Traduit une sortie de processus en motif fermé. Jamais un message brut. */
function motifProcessus(proc: {
  code: number | null; introuvable: boolean; timeout: boolean;
}, echec: MotifRendu): MotifRendu {
  if (proc.introuvable) return 'outil_absent';
  if (proc.timeout) return 'delai_depasse';
  return echec;
}

/**
 * Lance l'unique passage, et rend un motif — jamais la sortie de ffmpeg.
 *
 * ⚠️ LE DÉLAI TUE VRAIMENT. `lancer` passe `timeout` et `killSignal: SIGKILL`
 * à `execFile` : à l'échéance le processus est ABATTU, et la promesse ne se
 * résout qu'ensuite. Une course de promesses aurait rendu la main en laissant
 * ffmpeg brûler les quatre cœurs derrière — c'est la fausse borne que le
 * dépôt documente ailleurs.
 */
export async function encoder(
  args: string[], dureeSecondes: number, dossier?: string,
): Promise<ResultatProcessus> {
  const proc = await lancer(cheminFfmpeg(), args, {
    timeoutMs: timeoutEncodage(dureeSecondes),
    maxSortie: SORTIE_MAX,
  });
  const diagnostic = diagnosticRendu(proc.stderr, dossier);
  if (proc.code === 0 && !proc.timeout && !proc.introuvable) {
    return { ok: true, motif: null, diagnostic };
  }
  return { ok: false, motif: motifProcessus(proc, 'encodage_echoue'), diagnostic };
}

export interface SondeSource {
  aAudio: boolean;
  /** Les dimensions DÉCODÉES, celles sur lesquelles le recadrage s'applique. */
  largeur: number | null;
  hauteur: number | null;
  /**
   * Renseigné quand la sonde n'a pas abouti.
   *
   * ⚠️ « PAS D'AUDIO » ET « JE N'AI PAS PU REGARDER » NE SONT PAS LA MÊME
   * CHOSE. Les confondre ferait partir le graphe sans piste sonore, et le
   * montage serait déclaré réussi avec sa bande son perdue — l'audio n'étant
   * pas une condition de conformité, puisqu'un rush muet est légitime.
   */
  motif: MotifRendu | null;
}

/**
 * Sonde une source : audio, et surtout DIMENSIONS RÉELLES.
 *
 * ⚠️ LE PIÈGE DE LA ROTATION. Un rush filmé au téléphone porte souvent une
 * matrice d'affichage `rotate=90` : il se SONDE en 1920×1080 et se DÉCODE en
 * 1080×1920, ffmpeg appliquant l'autorotation. Le plan a été calculé sur les
 * dimensions que M3-B avait mesurées ; si elles ne correspondent pas à ce que
 * le décodeur produit, le rectangle de M3-G tomberait à côté — et le montage
 * serait recadré de travers, sans le moindre message.
 *
 * On constate donc ici, et l'orchestration compare.
 */
export async function sonderSource(fichier: string): Promise<SondeSource> {
  const vide = { aAudio: false, largeur: null, hauteur: null };
  const proc = await lancer(cheminFfprobe(), argumentsSondeSource(fichier), {
    timeoutMs: TIMEOUT_MESURE_MS, maxSortie: SORTIE_MAX,
  });
  if (proc.introuvable) return { ...vide, motif: 'outil_absent' };
  if (proc.timeout) return { ...vide, motif: 'delai_depasse' };
  if (proc.code !== 0) return { ...vide, motif: 'clip_illisible' };
  try {
    const o = JSON.parse(proc.stdout.toString('utf8')) as {
      streams?: Array<Record<string, unknown>>;
    };
    const flux = Array.isArray(o.streams) ? o.streams : [];
    const video = flux.find((f) => f.codec_type === 'video');
    if (!video) return { ...vide, motif: 'clip_illisible' };
    return {
      aAudio: flux.some((f) => f.codec_type === 'audio'),
      largeur: nombreFini(video.width),
      hauteur: nombreFini(video.height),
      motif: null,
    };
  } catch {
    return { ...vide, motif: 'clip_illisible' };
  }
}

/**
 * Mesure le fichier produit.
 *
 * ⚠️ UN CODE 0 DE FFMPEG NE VAUT PAS UN FICHIER VALIDE. C'est ici que le
 * résultat est constaté : taille, durée, dimensions, cadence, codecs. Chez
 * M3-F la mesure était décorative et retombait sur `null` ; ici elle est la
 * validation, et son échec fait échouer le rendu.
 */
export async function mesurer(
  fichier: string,
): Promise<{ mesure: MesureRendu | null; motif: MotifRendu | null }> {
  let octets = 0;
  try {
    octets = (await stat(fichier)).size;
  } catch {
    return { mesure: null, motif: 'resultat_invalide' };
  }
  if (octets <= 0) return { mesure: null, motif: 'resultat_invalide' };
  if (octets > RENDU_OCTETS_MAX) return { mesure: null, motif: 'resultat_invalide' };

  const proc = await lancer(cheminFfprobe(), argumentsMesureRendu(fichier), {
    timeoutMs: TIMEOUT_MESURE_MS, maxSortie: SORTIE_MAX,
  });
  if (proc.introuvable) return { mesure: null, motif: 'outil_absent' };
  if (proc.timeout) return { mesure: null, motif: 'delai_depasse' };
  if (proc.code !== 0) return { mesure: null, motif: 'resultat_invalide' };

  const mesure = lireMesureRendu(proc.stdout.toString('utf8'), octets);
  return mesure === null
    ? { mesure: null, motif: 'resultat_invalide' }
    : { mesure, motif: null };
}

/**
 * Ce qui a le droit d'aller au journal.
 *
 * Les URL sont masquées, les chemins locaux effacés, et la sortie tronquée.
 * Rien de tout cela ne va en base ni dans une réponse : la persistance ne
 * porte qu'un motif du vocabulaire fermé.
 */
export function diagnosticRendu(stderr: unknown, dossier?: string): string {
  // ⚠️ `masquerUrls` NE CONNAÎT QUE LES URL. Il ne masque ni `hote:9000`, ni
  // un chemin local — et H3 en produit, contrairement à M3-F : ffmpeg lit des
  // FICHIERS, donc son `stderr` porte le répertoire temporaire à chaque
  // erreur. Le dossier est effacé nommément, puis toute forme de chemin
  // temporaire qui aurait échappé.
  let texte = String(stderr ?? '');
  if (dossier) texte = texte.split(dossier).join('[tmp]');
  return masquerUrls(texte)
    .replace(/\/(?:private\/)?(?:tmp|var)\/[^\s'"]*/g, '[chemin]')
    .slice(-200);
}

// ───────────────────────────────────────────────────────────────────────────
// Le téléversement du montage final
// ───────────────────────────────────────────────────────────────────────────

/**
 * Envoie le montage validé vers le stockage.
 *
 * ⚠️ LA BORNE EST CELLE DU TRANSPORT, PAS UNE COURSE DE PROMESSES.
 * `transportMinioBorne` DÉTRUIT la requête à l'échéance ; une course rendrait
 * la main en laissant le transfert écrire l'objet derrière une erreur déjà
 * rendue — le dépôt documente cette fausse borne ailleurs, et M3-F l'a
 * retirée après revue.
 *
 * ⚠️ ET LA CLÉ EST FABRIQUÉE, JAMAIS REÇUE. `cleRendu` la dérive de la
 * session et de l'identifiant de ligne ; elle est déterministe, donc un rejeu
 * écrit AU MÊME ENDROIT plutôt que de semer un second objet.
 */
export async function televerserRendu(
  userId: string, renduId: string, fichier: string, octets: number,
): Promise<{ ok: true; bucket: string; cle: string } | { ok: false; motif: MotifRendu }> {
  let cle: string;
  try {
    cle = cleRendu(userId, renduId);
  } catch {
    // `cleRendu` refuse un composant malformé plutôt que de fabriquer un
    // chemin qui sortirait de l'espace de son propriétaire. Le motif est celui
    // de l'ÉTAPE — le fichier produit, lui, était bon.
    return { ok: false, motif: 'televersement_echoue' };
  }
  if (!cleValide(cle, userId)) return { ok: false, motif: 'televersement_echoue' };

  try {
    await clientMinio({ timeoutMs: TIMEOUT_TELEVERSEMENT_RENDU_MS }).putObject(
      BUCKET_RENDUS_MONTAGE, cle, createReadStream(fichier), octets,
      { 'Content-Type': CONTENT_TYPE_RENDU },
    );
    // ⚠️ ON RELIT CE QUI A ÉTÉ ÉCRIT. Le SDK n'impose pas la taille annoncée :
    // un fichier tronqué monte en 200 sans un mot. Et au-delà de la taille de
    // partie, il REPREND un envoi multiple inachevé — deux encodages ne sont
    // pas garantis identiques octet pour octet, si bien qu'un rejeu pourrait
    // assembler un fichier mêlant les deux. Comparer la taille attrape les
    // deux cas pour le prix d'un appel.
    const vu = await clientMinio({ timeoutMs: TIMEOUT_TELEVERSEMENT_RENDU_MS })
      .statObject(BUCKET_RENDUS_MONTAGE, cle);
    if (Number((vu as { size?: unknown }).size) !== octets) {
      return { ok: false, motif: 'televersement_echoue' };
    }
    return { ok: true, bucket: BUCKET_RENDUS_MONTAGE, cle };
  } catch {
    // Le message nomme l'hôte du stockage : il ne remonte pas.
    return { ok: false, motif: 'televersement_echoue' };
  }
}

/**
 * Retire un objet, et DIT si elle a échoué.
 *
 * ⚠️ C'EST LA COMPENSATION DU CAS SANS TRANSACTION. Le stockage et la base ne
 * partagent aucune transaction : quand l'objet est monté mais que la ligne ne
 * peut plus être écrite, il faut le retirer. Si le retrait échoue à son tour,
 * l'échec est RENDU — l'objet devient un orphelin qu'on trace, jamais une
 * fuite qu'on tait.
 */
export async function supprimerObjetRendu(bucket: string, cle: string): Promise<boolean> {
  try {
    const client = clientMinio({ timeoutMs: TIMEOUT_TELEVERSEMENT_RENDU_MS }) as unknown as {
      removeObject(b: string, c: string): Promise<unknown>;
    };
    await client.removeObject(bucket, cle);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ouvre le montage en lecture, pour le servir.
 *
 * ⚠️ SANS BORNE, ET C'EST DÉLIBÉRÉ. `transportMinioBorne` arme une échéance
 * ABSOLUE qui détruit la requête — corps de réponse compris, le minuteur
 * n'étant désarmé qu'à la fermeture. La poser ici couperait le téléchargement
 * d'un spectateur trop lent en plein milieu : deux cents mégaoctets en trois
 * minutes exigent près de dix mégabits par seconde soutenus, ce qu'une
 * connexion mobile ne tient pas. Le lecteur recevrait un fichier tronqué
 * contre une longueur promise.
 *
 * La borne existe pour les échanges INTERNES, dont la taille et la durée sont
 * connues d'avance. Servir un octet à un navigateur n'en est pas un.
 *
 * La limite « une requête partielle n'est pas servie » est LEVÉE : voir
 * `ouvrirRenduPartiel` juste en dessous.
 */
export async function ouvrirRendu(
  bucket: string, cle: string,
): Promise<NodeJS.ReadableStream | null> {
  try {
    return await lecteurMinio().getObject(bucket, cle);
  } catch {
    return null;
  }
}

/**
 * Ouvre UN MORCEAU du montage, pour répondre à un `Range`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE FONCTION EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mesuré en production : `Range: bytes=0-1023` recevait `200` et les
 * 11 958 505 octets du fichier entier, parce que le relais ne savait lire que
 * l'objet complet. Chrome ne peut alors ni se positionner ni remplir le
 * tampon de son lecteur — le `<video>` restait à `readyState: 0`, puis
 * `NETWORK_NO_SOURCE`, sur l'URL nue comme dans la page.
 *
 * ⚠️ RIEN N'EST MATÉRIALISÉ EN MÉMOIRE. `getPartialObject` rend un FLUX du
 * seul morceau demandé : le serveur ne charge jamais les douze méga-octets
 * pour en servir mille. C'est ce qui rend le déplacement dans la timeline
 * bon marché plutôt que ruineux.
 *
 * ⚠️ AUCUNE BORNE DE TEMPS, pour la même raison que `ouvrirRendu` : une
 * échéance absolue détruirait le corps de la réponse en plein transfert.
 *
 * `longueur` est le nombre d'octets voulus, jamais une borne de fin — c'est
 * la convention de `getPartialObject`, et la confondre avec un index de fin
 * donnerait un morceau d'un octet de trop.
 */
export async function ouvrirRenduPartiel(
  bucket: string, cle: string, decalage: number, longueur: number,
): Promise<NodeJS.ReadableStream | null> {
  try {
    return await lecteurMinio().getPartialObject(bucket, cle, decalage, longueur);
  } catch {
    return null;
  }
}
