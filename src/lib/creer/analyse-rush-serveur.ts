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

/** Au-delà, on n'analyse pas (coût serveur) : les extraits viennent du début. */
const DUREE_ANALYSEE_MAX = 180;
const ECHANTILLONS_MAX = 240;
const TIMEOUT_MS = 120_000;
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

/** Lance ffmpeg et rend sa sortie standard complète (bornée en temps). */
function executer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const morceaux: Buffer[] = [];
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('analyse : délai dépassé')); }, TIMEOUT_MS);
    p.stdout.on('data', (b: Buffer) => morceaux.push(b));
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve(Buffer.concat(morceaux));
      else reject(new Error(`ffmpeg code ${code}`));
    });
  });
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

/** Analyse un rush dont la durée est connue (sondée par l'appelant). */
export async function analyserRushServeur(url: string, dureeSecondes: number | null): Promise<AnalyseRush | null> {
  if (!(typeof dureeSecondes === 'number' && dureeSecondes >= 1)) return null;
  const duree = Math.min(dureeSecondes, DUREE_ANALYSEE_MAX);
  const pas = Math.max(0.5, duree / ECHANTILLONS_MAX);
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs/promises');
  const audioTmp = path.join(os.tmpdir(), `studiio-analyse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`);
  try {
    // UN SEUL décodage (donc un seul téléchargement) pour l'image ET le son :
    // l'image part sur la sortie standard, le son dans un fichier temporaire.
    // `-skip_loop_filter all` : décodage plus rapide, sans effet sur des
    // mesures faites en 64×36.
    const brut = await executer([
      '-hide_banner', '-loglevel', 'error', '-threads', '0', '-skip_loop_filter', 'all',
      '-t', String(duree), '-i', url,
      '-map', '0:v:0', '-vf', `fps=${1 / pas},scale=${ANALYSE_L}:${ANALYSE_H}:flags=fast_bilinear,format=gray`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
      '-map', '0:a:0?', '-ac', '1', '-ar', String(AUDIO_HZ), '-f', 's16le', '-y', audioTmp,
    ]);
    const pcm = await fs.readFile(audioTmp).catch(() => Buffer.alloc(0));
    const images = imagesDepuisBrut(brut);
    if (images.length < 2) return null;
    const audio = energieDepuisPcm(pcm, pas, images.length);
    const echantillons: EchantillonRush[] = [];
    let prec: Float32Array | null = null;
    images.forEach((g, i) => {
      const m = mesurerImage(g, prec);
      prec = g;
      echantillons.push({ t: Math.round(i * pas * 1000) / 1000, ...m, audio: audio[i] ?? 0 });
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
