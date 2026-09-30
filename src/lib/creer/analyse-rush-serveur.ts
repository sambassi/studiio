/**
 * SMART MONTAGE — analyse d'un rush CÔTÉ SERVEUR (Autopilote), gratuite.
 *
 * Même sortie (`AnalyseRush`) et MÊME arithmétique par image
 * (`mesurerImage`) que l'analyseur navigateur de Créer : l'Autopilote note
 * les extraits avec le moteur de Créer (`planMontage`), pas un second.
 *
 * ffmpeg décode le rush à `1/pas` image par seconde, réduit en 64×36 niveaux
 * de gris, et l'écrit brut sur sa sortie ; une seconde passe lit l'audio en
 * mono 8 kHz pour l'énergie. Toute erreur rend `null` : l'appelant garde le
 * montage simple et l'ÉCRIT dans les métadonnées (jamais en silence).
 */
import { spawn } from 'child_process';
import {
  mesurerImage, ANALYSE_L, ANALYSE_H, type AnalyseRush, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { analyserRythme, type RythmeMusique } from '@/lib/creer/rythme-musique';

/** Au-delà, on n'analyse pas (coût serveur) : les extraits viennent du début. */
const DUREE_ANALYSEE_MAX = 180;
const ECHANTILLONS_MAX = 240;
const TIMEOUT_MS = 90_000;
const AUDIO_HZ = 8000;

function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (p && require('fs').existsSync(p)) return p;
  } catch { /* paquet absent : binaire système */ }
  return 'ffmpeg';
}

/** Lance ffmpeg ; rend sa sortie standard et son journal (bornés en temps). */
function executer(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const morceaux: Buffer[] = [];
    let stderr = '';
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('analyse : délai dépassé')); }, TIMEOUT_MS);
    p.stdout.on('data', (b: Buffer) => morceaux.push(b));
    p.stderr.on('data', (b: Buffer) => { if (stderr.length < 4_000_000) stderr += b.toString(); });
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve({ stdout: Buffer.concat(morceaux), stderr });
      else reject(new Error(`ffmpeg code ${code}`));
    });
  });
}

/** Instants (s) des images émises, lus dans le journal `showinfo`. Pur, testable. */
export function instantsShowinfo(journal: string): number[] {
  const out: number[] = [];
  const re = /pts_time:\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(journal))) out.push(Number(m[1]));
  return out;
}

/** Découpe une sortie brute en images grises (0..1). Pure, testable. */
export function imagesDepuisBrut(brut: Uint8Array): Float32Array[] {
  const taille = ANALYSE_L * ANALYSE_H;
  const out: Float32Array[] = [];
  for (let o = 0; o + taille <= brut.length; o += taille) {
    const g = new Float32Array(taille);
    for (let i = 0; i < taille; i++) g[i] = brut[o + i] / 255;
    out.push(g);
  }
  return out;
}

/** Énergie RMS (0..1) par fenêtre de `pas` secondes, depuis du PCM s16le mono. */
export function energieDepuisPcm(pcm: Uint8Array, pas: number, n: number, hz = AUDIO_HZ): number[] {
  const vue = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const total = Math.floor(pcm.byteLength / 2);
  const parFenetre = Math.max(1, Math.floor(pas * hz));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * parFenetre;
    const b = Math.min(total, a + parFenetre);
    let s = 0;
    for (let j = a; j < b; j++) { const v = vue.getInt16(j * 2, true) / 32768; s += v * v; }
    out.push(b > a ? Math.min(1, Math.sqrt(s / (b - a)) * 4) : 0);
  }
  return out;
}

/** Bucket + clé d'une URL publique du stockage Studiio, sinon `null`. Pur. */
export function objetDeUrlPublique(url: string): { bucket: string; cle: string } | null {
  const m = /\/storage\/v1\/object\/public\/([^/?#]+)\/([^?#]+)/.exec(url);
  return m ? { bucket: m[1], cle: decodeURIComponent(m[2]) } : null;
}

/**
 * URL que ffmpeg LIT : signée INTERNE (MinIO en direct, réseau Docker) quand
 * le fichier est dans notre stockage.
 *
 * ⚠️ Test réel staging 30/09 16:00 : lu par son adresse PUBLIQUE, le rush
 * `lv_0` (4K, 234 Mo) traversait le proxy puis l'application, et l'analyse
 * dépassait son délai → plan bâti sur deux rushes de 8 s → 4 extraits, 5,8 s,
 * A → B → A → B. Même fichier lu en direct : ~0,6 s d'analyse.
 */
export async function urlDeLecture(url: string): Promise<string> {
  const objet = objetDeUrlPublique(url);
  if (!objet) return url;
  try {
    const { signeurInterne } = await import('@/lib/storage/minio-client');
    const signeur = signeurInterne();
    if (!signeur) return url;
    const interne = await signeur.presignedGetObject(objet.bucket, objet.cle, 600);
    return typeof interne === 'string' && /^https?:\/\//.test(interne) ? interne : url;
  } catch {
    return url;
  }
}

/**
 * Analyse NEUTRE d'un rush dont la mesure a échoué : il reste montable
 * (matière disponible) sans rien prétendre de son contenu — mouvement moyen,
 * exposition correcte, aucune empreinte, aucun son mesuré.
 */
export function analyseNeutre(url: string, duree: number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    echantillons.push({ t: Math.round(t * 1000) / 1000, mouvement: 0.03, luminosite: 0.5, nettete: 0.1, audio: 0 });
  }
  return { url, duree, echantillons };
}

/** Analyse un rush dont la durée est connue (sondée par l'appelant). */
export async function analyserRushServeur(url: string, dureeSecondes: number | null): Promise<AnalyseRush | null> {
  if (!(typeof dureeSecondes === 'number' && dureeSecondes >= 1)) return null;
  const duree = Math.min(dureeSecondes, DUREE_ANALYSEE_MAX);
  const pas = Math.max(0.5, duree / ECHANTILLONS_MAX);
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs/promises');
  const source = await urlDeLecture(url);
  const audioTmp = path.join(os.tmpdir(), `studiio-analyse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`);
  try {
    // ⚠️ IMAGES-CLÉS SEULEMENT (`-skip_frame nokey`). Décoder chaque image
    // d'un rush 4K 60 i/s de 40 s dépassait le délai de 120 s sur le serveur
    // de staging : AUCUNE analyse n'aboutissait, et l'Autopilote retombait
    // en montage simple (test réel du 30/09, 13:43). Les images-clés (une
    // toutes les 0,5–2 s sur un téléphone) suffisent à des mesures en 64×36,
    // pour environ 7× moins de calcul. `select` borne leur densité à 1 / `pas`
    // (vidéos tout-intra). Les instants réels viennent de `showinfo`.
    // UN SEUL passage pour l'image ET le son.
    const argsImages = (clesSeules: boolean, avecSon = true) => [
      '-hide_banner', '-loglevel', 'info', '-nostats', '-threads', '0',
      ...(clesSeules ? ['-skip_frame', 'nokey'] : ['-skip_loop_filter', 'all']),
      '-t', String(duree), '-i', source,
      '-map', '0:v:0',
      '-vf', clesSeules
        ? `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${pas})',scale=${ANALYSE_L}:${ANALYSE_H}:flags=fast_bilinear,format=gray,showinfo`
        : `fps=${1 / pas},scale=${ANALYSE_L}:${ANALYSE_H}:flags=fast_bilinear,format=gray,showinfo`,
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
      ...(avecSon ? ['-map', '0:a:0?', '-ac', '1', '-ar', String(AUDIO_HZ), '-f', 's16le', '-y', audioTmp] : []),
    ];
    // Un rush SANS piste audio laisse la sortie son vide, et ffmpeg refuse
    // alors tout le passage : on relance sans elle (énergie audio à 0).
    const lancer = (clesSeules: boolean) => executer(argsImages(clesSeules))
      .catch((e) => (String(e?.message).includes('délai') ? Promise.reject(e) : executer(argsImages(clesSeules, false))));
    let { stdout: brut, stderr } = await lancer(true);
    // Images-clés trop rares (vidéo courte, ou encodée avec une seule
    // image-clé — fréquent sur les vidéos générées) : décodage complet,
    // peu coûteux justement sur ces fichiers-là.
    if (imagesDepuisBrut(brut).length < Math.max(3, Math.floor(duree / 4))) {
      ({ stdout: brut, stderr } = await lancer(false));
    }
    const pcm = await fs.readFile(audioTmp).catch(() => Buffer.alloc(0));
    const images = imagesDepuisBrut(brut);
    if (images.length < 2) return null;
    const instants = instantsShowinfo(stderr);
    const t0 = instants[0] ?? 0;
    // Énergie audio par demi-seconde, relue à l'instant de chaque image.
    const audio = energieDepuisPcm(pcm, 0.5, Math.ceil(duree / 0.5) + 1);
    const echantillons: EchantillonRush[] = [];
    let prec: Float32Array | null = null;
    images.forEach((g, i) => {
      const m = mesurerImage(g, prec);
      prec = g;
      const t = Math.max(0, (instants[i] ?? i * pas) - t0);
      echantillons.push({ t: Math.round(t * 1000) / 1000, ...m, audio: audio[Math.floor(t / 0.5)] ?? 0 });
    });
    return { url, duree, echantillons };
  } catch (err) {
    console.warn('[SmartMontage/serveur] analyse impossible :', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await fs.unlink(audioTmp).catch(() => {});
  }
}

// ── Cache : l'analyse TECHNIQUE d'un rush ne dépend pas du thème ─────────
// Calculée une fois, réutilisée par toutes les vidéos d'un cycle et les
// productions suivantes ; seule la sélection (pertinence) change.
const CACHE_TTL_MS = 12 * 3600_000;
const CACHE_MAX = 60;
const cache = new Map<string, { at: number; analyse: Promise<AnalyseRush | null> }>();

/** Analyse avec cache par rush (clé = URL, durée). Une erreur n'est pas mise en cache. */
export function analyserRushServeurCache(url: string, dureeSecondes: number | null): Promise<AnalyseRush | null> {
  const cle = `${url}@${dureeSecondes ?? ''}`;
  const hit = cache.get(cle);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.analyse;
  const analyse = analyserRushServeur(url, dureeSecondes).then((a) => { if (!a) cache.delete(cle); return a; });
  cache.set(cle, { at: Date.now(), analyse });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return analyse;
}

// ── Musique : rythme analysé UNE fois par fichier (cache) ────────────────
const cacheMusique = new Map<string, { at: number; rythme: Promise<RythmeMusique | null> }>();
const MUSIQUE_HZ = 11025;
const MUSIQUE_MAX_S = 240;

/** Rythme d'une musique (serveur, ffmpeg), avec cache. `null` si illisible. */
export function analyserMusiqueServeur(url: string): Promise<RythmeMusique | null> {
  const hit = cacheMusique.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rythme;
  const rythme = urlDeLecture(url).then((source) => executer([
    '-hide_banner', '-loglevel', 'error', '-t', String(MUSIQUE_MAX_S), '-i', source,
    '-vn', '-ac', '1', '-ar', String(MUSIQUE_HZ), '-f', 'f32le', 'pipe:1',
  ])).then(({ stdout }) => {
    const signal = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
    return signal.length > MUSIQUE_HZ ? analyserRythme(signal, MUSIQUE_HZ) : null;
  }).catch((err) => {
    console.warn('[SmartMontage/serveur] rythme de la musique illisible :', err instanceof Error ? err.message : err);
    cacheMusique.delete(url);
    return null;
  });
  cacheMusique.set(url, { at: Date.now(), rythme });
  while (cacheMusique.size > 20) cacheMusique.delete(cacheMusique.keys().next().value as string);
  return rythme;
}
