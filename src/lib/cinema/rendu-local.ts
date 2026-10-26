/**
 * RENDU LOCAL — du montage au MP4, sans fournisseur et sans deploiement.
 *
 * Le rendu passe par le CLI Remotion du depot (`remotion/index.tsx`,
 * composition `cinema-film`) et non par `lib/render/worker.ts` : celui-la est
 * attache a la base, au stockage et aux credits, trois choses qu'un prototype
 * local n'a pas a toucher. La COMPOSITION, elle, est partagee — c'est le
 * morceau qui compte, et c'est celui qu'un futur rendu serveur reutilisera
 * tel quel.
 *
 * ffprobe sert a deux choses, et elles se repondent : mesurer les voix AVANT
 * le montage (pour que les durees suivent la parole) et verifier le MP4 APRES
 * (pour ne jamais annoncer un fichier qu'on n'a pas inspecte).
 */
import { spawn } from 'child_process';
import { mkdir, writeFile, stat } from 'fs/promises';
import path from 'path';
import { cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { MontageFilm } from '@/lib/cinema/montage';

export interface SortieCommande {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Sortie BRUTE, seulement en mode `binaire` (une image, des octets bruts). */
  stdoutBrut?: Buffer;
}

/**
 * Lance un binaire et rend sa sortie.
 *
 * `binaire: true` conserve les OCTETS au lieu de les concatener en texte :
 * une frame rendue en `rawvideo` passe par la sortie standard, et la
 * convertir en chaine la corromprait silencieusement.
 */
export function executer(
  commande: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; binaire?: boolean } = {},
): Promise<SortieCommande> {
  return new Promise((resolve, reject) => {
    const proc = spawn(commande, args, { cwd: options.cwd, env: process.env });
    const morceaux: Buffer[] = [];
    let stdout = '';
    let stderr = '';
    const minuterie = options.timeoutMs
      ? setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`delai depasse : ${commande}`)); }, options.timeoutMs)
      : null;
    proc.stdout.on('data', (d) => {
      if (options.binaire) morceaux.push(Buffer.from(d));
      else stdout += String(d);
    });
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('error', (e) => { if (minuterie) clearTimeout(minuterie); reject(e); });
    proc.on('close', (code) => {
      if (minuterie) clearTimeout(minuterie);
      resolve(options.binaire ? { code, stdout, stderr, stdoutBrut: Buffer.concat(morceaux) } : { code, stdout, stderr });
    });
  });
}

/** Duree d'un media, en secondes. `null` si ffprobe ne la lit pas. */
export async function dureeMedia(fichier: string): Promise<number | null> {
  try {
    const { stdout, code } = await executer(cheminFfprobe(), [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fichier,
    ], { timeoutMs: 20_000 });
    if (code !== 0) return null;
    const v = Number.parseFloat(stdout.trim());
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch { return null; }
}

/** Durees de plusieurs voix, par identifiant de plan. */
export async function dureesDesVoix(details: ReadonlyArray<{ planId: string; fichier: string }>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const d of details) {
    const duree = await dureeMedia(d.fichier);
    if (duree !== null) out[d.planId] = duree;
  }
  return out;
}

/** Ce que ffprobe dit du MP4 produit — jamais une promesse sur parole. */
export interface ControleMp4 {
  fichier: string;
  octets: number;
  dureeS: number | null;
  largeur: number | null;
  hauteur: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
}

export async function controlerMp4(fichier: string): Promise<ControleMp4> {
  const info = await stat(fichier);
  const { stdout } = await executer(cheminFfprobe(), [
    '-v', 'error', '-show_entries', 'format=duration', '-show_entries',
    'stream=codec_type,codec_name,width,height', '-of', 'json', fichier,
  ], { timeoutMs: 20_000 });
  let dureeS: number | null = null;
  let largeur: number | null = null;
  let hauteur: number | null = null;
  let codecVideo: string | null = null;
  let codecAudio: string | null = null;
  try {
    const json = JSON.parse(stdout);
    dureeS = json?.format?.duration ? Math.round(Number(json.format.duration) * 100) / 100 : null;
    for (const flux of json?.streams ?? []) {
      if (flux.codec_type === 'video') {
        codecVideo = flux.codec_name ?? null;
        largeur = flux.width ?? null;
        hauteur = flux.height ?? null;
      }
      if (flux.codec_type === 'audio') codecAudio = flux.codec_name ?? null;
    }
  } catch { /* un ffprobe muet laisse les champs a null, ce qui se voit */ }
  return { fichier, octets: info.size, dureeS, largeur, hauteur, codecVideo, codecAudio };
}

export interface OptionsRenduLocal {
  /** Racine du projet (ou vivent `remotion/index.tsx` et `package.json`). */
  racine: string;
  /** Fichier MP4 a produire. */
  sortie: string;
  /** Concurrence Remotion. 2 suffit en local et laisse la machine respirable. */
  concurrence?: number;
  timeoutMs?: number;
}

/**
 * Rend le montage en MP4 avec le CLI Remotion. Les props partent par FICHIER :
 * passees en ligne de commande, un film de cinq scenes depasse la limite
 * d'arguments du shell et l'echec serait illisible.
 */
export async function rendreMontage(montage: MontageFilm, options: OptionsRenduLocal): Promise<{ controle: ControleMp4; propsFichier: string; journal: string }> {
  await mkdir(path.dirname(options.sortie), { recursive: true });
  const propsFichier = path.join(path.dirname(options.sortie), `${montage.filmId || 'film'}-props.json`);
  await writeFile(propsFichier, JSON.stringify({ montage }, null, 2), 'utf-8');

  const args = [
    'remotion', 'render', 'remotion/index.tsx', 'cinema-film', options.sortie,
    `--props=${propsFichier}`,
    `--concurrency=${options.concurrence ?? 2}`,
    '--log=info',
  ];
  const sortie = await executer('npx', args, { cwd: options.racine, timeoutMs: options.timeoutMs ?? 900_000 });
  if (sortie.code !== 0) {
    throw new Error(`rendu Remotion en echec (code ${sortie.code})\n${sortie.stderr.slice(-4000)}`);
  }
  return { controle: await controlerMp4(options.sortie), propsFichier, journal: sortie.stderr.slice(-2000) };
}

/**
 * Recolle des MP4 deja rendus (`-c copy`, aucun reencodage).
 *
 * Les fichiers viennent tous de la MEME composition, donc des memes codecs,
 * de la meme taille et du meme fps : la copie de flux est licite. Recoller des
 * fichiers d'origines differentes sans reencoder produirait un fichier que
 * certains lecteurs refusent — c'est pour cela que la contrainte est ecrite
 * ici plutot que supposee.
 */
export async function concatener(fichiers: readonly string[], sortie: string): Promise<ControleMp4> {
  if (fichiers.length === 0) throw new Error('aucun fichier a recoller');
  const { cheminFfmpeg } = await import('@/lib/ffmpeg/binaires');
  await mkdir(path.dirname(sortie), { recursive: true });
  const liste = path.join(path.dirname(sortie), 'liste-concat.txt');
  await writeFile(liste, fichiers.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
  const r = await executer(cheminFfmpeg(), [
    '-f', 'concat', '-safe', '0', '-i', liste, '-c', 'copy', '-movflags', '+faststart', '-y', sortie,
  ], { timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error(`recollage ffmpeg en echec (code ${r.code})\n${r.stderr.slice(-2000)}`);
  return controlerMp4(sortie);
}

/**
 * RENDU PAR L'API NODE — un seul bundle pour tout le film.
 *
 * Le CLI (`rendreMontage`) rebundle a chaque appel : cinq scenes, cinq
 * bundles, pour un resultat identique. Ici le bundle est fait UNE fois et
 * chaque scene est rendue dessus, ce qui est aussi la forme qu'aura le rendu
 * serveur.
 *
 * ⚠️ Remotion est externalise du bundle Next (`next.config.js`) : les imports
 * sont DYNAMIQUES, comme partout ailleurs dans le depot. Un import statique
 * casse le build.
 */
export interface TacheRendu { montage: MontageFilm; sortie: string }

export interface OptionsPreparationRendu {
  racine: string;
  concurrence?: number;
  /**
   * Dossier des medias du rendu, a la place de `<racine>/public`.
   *
   * ⚠️ C'est ce qui garde les medias PRIVES hors de `public/` : Remotion copie
   * ce dossier dans son bundle et `staticFile()` y puise. Les medias d'un film
   * (rushes, voix, images) sont materialises dans un dossier de travail du
   * serveur, jamais dans le dossier que Next sert au monde entier.
   */
  publicDir?: string;
}

/**
 * Prepare le rendu UNE fois (le bundle prend des dizaines de secondes) et
 * rend une fonction qui produit UNE scene. Un executeur qui rend scene par
 * scene — pour noter sa progression et survivre a une interruption — ne paie
 * donc pas un bundle par scene.
 */
export async function preparerRendu(options: OptionsPreparationRendu): Promise<(tache: TacheRendu) => Promise<ControleMp4>> {
  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  const { remotionWebpackOverride } = await import('@/lib/render/webpackOverride');

  const serveUrl = await bundle({
    entryPoint: path.resolve(options.racine, 'remotion/index.tsx'),
    webpackOverride: remotionWebpackOverride,
    ...(options.publicDir ? { publicDir: options.publicDir } : {}),
  });

  return async (tache) => {
    await mkdir(path.dirname(tache.sortie), { recursive: true });
    const inputProps = { montage: tache.montage };
    const composition = await selectComposition({ serveUrl, id: 'cinema-film', inputProps });
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: tache.sortie,
      inputProps,
      concurrency: options.concurrence ?? 2,
      // Meme reglage que le rendu serveur existant (`lib/render/worker.ts`) : sur un
      // serveur sans GPU, c'est la voie deja eprouvee en production.
      chromiumOptions: { gl: 'angle' },
      // La piste audio est GARDEE : les voix des repliques sont dans la
      // composition (`<Audio>`), un rendu muet les perdrait en silence.
      muted: false,
      // ⚠️ PISTE AUDIO IMPOSEE, meme sur une scene sans replique. Le
      // recollage se fait en `-c copy` : un fichier sans flux audio au
      // milieu de fichiers qui en ont un fait echouer la concatenation.
      // Une piste silencieuse coute quelques kilo-octets ; le diagnostic de
      // l'echec de concat coute une heure.
      enforceAudioTrack: true,
      audioCodec: 'aac',
    });
    return controlerMp4(tache.sortie);
  };
}

export async function rendreMontages(
  taches: readonly TacheRendu[],
  options: { racine: string; concurrence?: number; publicDir?: string },
): Promise<ControleMp4[]> {
  if (!taches.length) return [];
  const rendre = await preparerRendu(options);
  const controles: ControleMp4[] = [];
  for (const tache of taches) controles.push(await rendre(tache));
  return controles;
}
