/**
 * FFmpeg.wasm audio muxing utility.
 * Takes a silent video blob + audio blob and produces a final MP4 with AAC audio.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loaded = false;

/** Load FFmpeg.wasm with timeout and error handling */
async function ensureLoaded(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg;

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  console.log('[FFmpeg] Loading core from unpkg...');
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

  // Race: load vs 30s timeout
  const loadResult = await Promise.race([
    (async () => {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      await ffmpeg!.load({ coreURL, wasmURL });
      return true;
    })(),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000)),
  ]);

  if (!loadResult) {
    throw new Error('FFmpeg.wasm load timeout (30s). SharedArrayBuffer may not be available — check COOP/COEP headers.');
  }

  loaded = true;
  console.log('[FFmpeg] Loaded successfully');
  return ffmpeg;
}

export interface MuxOptions {
  videoBlob: Blob;
  audioBlob: Blob;
  onProgress?: (pct: number) => void;
}

/**
 * Mux a silent video with an audio track into a final MP4.
 */
export async function muxVideoAudio(opts: MuxOptions): Promise<Blob> {
  const { videoBlob, audioBlob, onProgress } = opts;

  onProgress?.(5);
  console.log('[FFmpeg] Mux — video:', (videoBlob.size / 1024 / 1024).toFixed(2), 'MB', videoBlob.type,
    '| audio:', (audioBlob.size / 1024 / 1024).toFixed(2), 'MB', audioBlob.type);

  const ff = await ensureLoaded();
  onProgress?.(30);

  const videoExt = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';

  await ff.writeFile(`input.${videoExt}`, await fetchFile(videoBlob));
  await ff.writeFile('audio.wav', await fetchFile(audioBlob));
  onProgress?.(40);

  console.log('[FFmpeg] Running mux command...');
  const exitCode = await ff.exec([
    '-i', `input.${videoExt}`,
    '-i', 'audio.wav',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-shortest',
    '-movflags', '+faststart',
    '-y',
    'output.mp4',
  ]);

  if (exitCode !== 0) {
    throw new Error(`FFmpeg exited with code ${exitCode}`);
  }

  onProgress?.(90);

  const data = await ff.readFile('output.mp4');
  const outputBlob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  console.log('[FFmpeg] ✅ Output:', (outputBlob.size / 1024 / 1024).toFixed(2), 'MB');

  // Cleanup virtual filesystem
  try {
    await ff.deleteFile(`input.${videoExt}`);
    await ff.deleteFile('audio.wav');
    await ff.deleteFile('output.mp4');
  } catch { /* ignore */ }

  onProgress?.(100);
  return outputBlob;
}
