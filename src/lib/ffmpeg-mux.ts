/**
 * FFmpeg.wasm audio muxing utility.
 * Takes a silent video blob + audio blob and produces a final MP4 with AAC audio.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/** Load FFmpeg.wasm (cached — only loads once) */
async function ensureLoaded(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;

  if (loadPromise) {
    await loadPromise;
    return ffmpeg!;
  }

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  loadPromise = (async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg!.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    console.log('[FFmpeg] Loaded successfully');
  })();

  await loadPromise;
  return ffmpeg!;
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
  const ff = await ensureLoaded();

  onProgress?.(5);
  console.log('[FFmpeg] Video:', (videoBlob.size / 1024 / 1024).toFixed(2), 'MB, type:', videoBlob.type);
  console.log('[FFmpeg] Audio:', (audioBlob.size / 1024 / 1024).toFixed(2), 'MB, type:', audioBlob.type);

  const videoExt = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';

  await ff.writeFile(`input.${videoExt}`, await fetchFile(videoBlob));
  await ff.writeFile('audio.wav', await fetchFile(audioBlob));

  onProgress?.(20);

  // Mux: copy video stream, encode audio as AAC, output as MP4
  await ff.exec([
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

  onProgress?.(90);

  const data = await ff.readFile('output.mp4');
  const outputBlob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  console.log('[FFmpeg] Output:', (outputBlob.size / 1024 / 1024).toFixed(2), 'MB');

  try {
    await ff.deleteFile(`input.${videoExt}`);
    await ff.deleteFile('audio.wav');
    await ff.deleteFile('output.mp4');
  } catch { /* ignore cleanup errors */ }

  onProgress?.(100);
  return outputBlob;
}
