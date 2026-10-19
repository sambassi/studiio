import { execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Délai laissé à ffmpeg pour quitter sur SIGTERM avant SIGKILL. */
const GRACE_ARRET_MS = 5_000;

/** Se règle quand le processus est RÉELLEMENT terminé (SIGKILL au besoin). */
async function attendreArretReel(enfant: ChildProcess | undefined): Promise<void> {
  if (!enfant || enfant.exitCode !== null || enfant.signalCode !== null) return;
  await new Promise<void>((resoudre) => {
    const fini = () => { clearTimeout(minuteur); resoudre(); };
    enfant.once('exit', fini);
    const minuteur = setTimeout(() => {
      try { enfant.kill('SIGKILL'); } catch { /* déjà mort */ }
    }, GRACE_ARRET_MS);
    // Re-vérifie après l'abonnement : la sortie a pu arriver entre-temps.
    if (enfant.exitCode !== null || enfant.signalCode !== null) fini();
  });
}

/**
 * Server-side WebM → MP4 transcode with progressive quality ladder.
 *
 * Why a ladder? Vercel serverless functions cap at maxDuration 300s. A 60s
 * 1080p WebM with audio can take 200-280s on the slowest Vercel instance,
 * leaving no headroom. If the first attempt fails (timeout, OOM), we fall
 * back to a smaller resolution that converts faster but is still acceptable
 * for IG/FB/TikTok publish (1080p → 720p → 540p).
 *
 * The single-attempt entry point is used by both:
 *  - /api/convert/to-mp4 (calendar/desktop export)
 *  - /api/cron/publish    (Instagram/Facebook publish chain)
 *
 * Both call sites preserve their own download/upload logic and just delegate
 * the actual transcode to this helper.
 */

interface LadderAttempt {
  /** Max width in pixels (the height is capped to maintain aspect ratio). */
  maxW: number;
  /** Max height in pixels. */
  maxH: number;
  /** libx264 CRF (lower = better quality, slower). 28 is the sweet spot for
   *  ultrafast preset; 30 is acceptable last-resort for 540p. */
  crf: number;
  /** Per-attempt timeout in ms. Sum of all attempts must stay < Vercel's
   *  maxDuration (300s) including download/upload overhead. */
  timeoutMs: number;
  /** Human-readable label for logs. */
  label: string;
}

const LADDER: LadderAttempt[] = [
  { maxW: 1080, maxH: 1920, crf: 28, timeoutMs: 240000, label: '1080p CRF28' },
  { maxW: 720,  maxH: 1280, crf: 28, timeoutMs: 180000, label: '720p CRF28 fallback' },
  { maxW: 540,  maxH: 960,  crf: 30, timeoutMs: 120000, label: '540p CRF30 last resort' },
];

/** Durée maximale de toute l'échelle (somme des délais par palier), en ms. */
export const DUREE_MAX_ECHELLE_MS = LADDER.reduce((total, a) => total + a.timeoutMs, 0);

/**
 * Build the FFmpeg arg vector for a given attempt. Uses:
 *  - `ultrafast` preset + `zerolatency` tune + `-threads 0`
 *    → ~30% faster than baseline.
 *  - `-crf 28` instead of 23 → ~40% faster, visible quality drop is minor
 *    on social-media playback at <1080p.
 *  - `-vf scale=...` caps the resolution and ensures even dimensions
 *    (required by H.264, otherwise FFmpeg refuses or crashes).
 *  - `baseline` profile + level 3.1 + yuv420p → max compatibility with
 *    Instagram, Facebook, TikTok, QuickTime.
 *  - `+faststart` moves moov atom to the start of the file for streaming.
 *
 * Audio flags are always included; FFmpeg gracefully skips them if the
 * source has no audio track (emits a cosmetic "Codec AVOption b not used"
 * warning, no error).
 */
function buildFFmpegArgs(inputPath: string, outputPath: string, attempt: LadderAttempt): string[] {
  const scale = `scale='min(${attempt.maxW},iw)':'min(${attempt.maxH},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  return [
    // Régénérer les PTS (timestamps) cassés du WebM source : Chrome's
    // captureStream(0) + MediaRecorder produit des timestamps incohérents,
    // qui font hériter le MP4 d'une durée erronée (ex: 1:21 au lieu de 14s).
    '-fflags', '+genpts',
    '-i', inputPath,
    '-threads', '0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', String(attempt.crf),
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-pix_fmt', 'yuv420p',
    '-vf', scale,
    // Force CFR 30fps en sortie pour durée correcte (sinon VFR hérite des PTS cassés)
    '-r', '30',
    '-vsync', 'cfr',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    // Resync audio en cas de décalage (audio drift sur sources VFR)
    '-async', '1',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];
}

export interface TranscodeResult {
  /** The attempt label that succeeded (e.g. '1080p CRF28' or '720p CRF28 fallback'). */
  attempt: string;
  /** Last 2KB of FFmpeg stderr (for diagnostic when the call site wants to log). */
  stderr: string;
  /** Total wall-clock time across all attempts (ms). */
  elapsedMs: number;
}

/**
 * Run FFmpeg with the quality ladder. Returns on first success. Throws if
 * all 3 attempts fail — in that case the call site should surface a clear
 * error to the user (file too long, source corrupt, etc.).
 */
export async function transcodeWebmToMp4WithLadder(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  logPrefix: string = '[FFMPEG]',
  /**
   * Facultatif. `signal` : un abandon TUE le ffmpeg en cours (execFile) et
   * arrête l'échelle — la promesse ne se règle qu'une fois le processus
   * terminé. Sans options (cron), comportement strictement inchangé.
   */
  options: { signal?: AbortSignal } = {},
): Promise<TranscodeResult> {
  const start = Date.now();
  let lastStderr = '';
  let lastError: Error | null = null;
  const { signal } = options;

  for (const attempt of LADDER) {
    if (signal?.aborted) {
      throw new Error(`${logPrefix} conversion abandonnée par le client`);
    }
    const attemptStart = Date.now();
    console.log(`${logPrefix} Attempting ${attempt.label} (timeout ${attempt.timeoutMs / 1000}s)`);
    const lancement = execFileAsync(ffmpegPath, buildFFmpegArgs(inputPath, outputPath, attempt), {
      timeout: attempt.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    });
    try {
      const result = await lancement;
      const elapsedMs = Date.now() - start;
      const attemptMs = Date.now() - attemptStart;
      console.log(`${logPrefix} ✅ Succeeded with ${attempt.label} in ${(attemptMs / 1000).toFixed(1)}s (total ${(elapsedMs / 1000).toFixed(1)}s)`);
      return { attempt: attempt.label, stderr: result.stderr || '', elapsedMs };
    } catch (err: unknown) {
      // Abandon : execFile rejette DÈS l'envoi de SIGTERM, pas à la mort du
      // processus. On attend sa fin réelle (SIGKILL après un délai de grâce)
      // pour que l'appelant ne rende son jeton — ni ne supprime les fichiers
      // temporaires — qu'une fois ffmpeg vraiment arrêté.
      if (signal?.aborted) {
        await attendreArretReel((lancement as unknown as { child?: ChildProcess }).child);
        throw new Error(`${logPrefix} conversion abandonnée par le client`);
      }
      const errObj = err as { stderr?: string; message?: string; code?: number; killed?: boolean };
      lastStderr = errObj.stderr || '';
      lastError = err as Error;
      const reason = errObj.killed ? 'TIMEOUT' : `exit ${errObj.code ?? '?'}`;
      console.warn(`${logPrefix} ❌ ${attempt.label} failed (${reason}) — trying next:`, (errObj.message || '').slice(0, 200));
      console.warn(`${logPrefix} stderr (last 1KB):`, lastStderr.slice(-1000));
    }
  }

  const elapsedMs = Date.now() - start;
  throw new Error(`Toutes les tentatives FFmpeg ont échoué (1080p, 720p, 540p) après ${(elapsedMs / 1000).toFixed(1)}s. Dernière erreur : ${lastError?.message || 'inconnue'}. stderr : ${lastStderr.slice(-500)}`);
}
