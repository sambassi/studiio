'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;

export interface MontageClipSpec {
  src: string;
  startSec: number;
  endSec: number;
}

export interface MontageSpec {
  clips: MontageClipSpec[];
  transition: 'crossfade' | 'cut';
  title: { text: string; color: string };
  subtitle: string;
  cta: { text: string; subText: string; color: string };
  posterUrl: string | null;
  musicUrl: string | null;
  totalDuration: number;
  format: '9:16' | '16:9';
  theme: string;
}

async function getFFmpeg(onLog: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => onLog(message));
  const baseURL = '/ffmpeg';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export async function renderMontage(
  spec: MontageSpec,
  onProgress: (pct: number, stage: string) => void,
): Promise<Blob> {
  onProgress(5, 'Chargement du moteur vidéo... (~30MB)');
  const ffmpeg = await getFFmpeg((m) => console.log('[ffmpeg]', m));

  onProgress(10, 'Téléchargement des vidéos...');

  const isPortrait = spec.format === '9:16';
  const w = isPortrait ? 1080 : 1920;
  const h = isPortrait ? 1920 : 1080;

  // Download and trim each clip
  const trimmedInputs: string[] = [];
  for (let i = 0; i < spec.clips.length; i++) {
    const clip = spec.clips[i];
    const inputName = `input${i}.mp4`;
    const trimmedName = `trimmed${i}.mp4`;
    onProgress(10 + ((i) / spec.clips.length) * 35, `Téléchargement clip ${i + 1}/${spec.clips.length}...`);

    const fileData = await fetchFile(clip.src);
    await ffmpeg.writeFile(inputName, fileData);

    onProgress(10 + ((i + 0.5) / spec.clips.length) * 35, `Découpage clip ${i + 1}/${spec.clips.length}...`);
    await ffmpeg.exec([
      '-i', inputName,
      '-ss', String(clip.startSec),
      '-to', String(clip.endSec),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30`,
      '-y', trimmedName,
    ]);
    trimmedInputs.push(trimmedName);
    onProgress(10 + ((i + 1) / spec.clips.length) * 35, `Clip ${i + 1} prêt`);
  }

  onProgress(50, 'Assemblage des clips...');

  if (trimmedInputs.length === 1) {
    const data = await ffmpeg.readFile(trimmedInputs[0]);
    await ffmpeg.writeFile('concat.mp4', data);
  } else {
    let concatList = '';
    for (const f of trimmedInputs) {
      concatList += `file '${f}'\n`;
    }
    await ffmpeg.writeFile('filelist.txt', concatList);
    await ffmpeg.exec([
      '-f', 'concat', '-safe', '0', '-i', 'filelist.txt',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-y', 'concat.mp4',
    ]);
  }

  onProgress(75, 'Ajout titre et CTA...');

  // Load font into FFmpeg virtual FS
  await ffmpeg.writeFile('anton.ttf', await fetchFile('/ffmpeg/Anton-Regular.ttf'));

  const escDt = (s: string) => s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\\\:')
    .replace(/'/g, "\\\\\\'")
    .replace(/\[/g, '\\\\[')
    .replace(/\]/g, '\\\\]')
    .replace(/#/g, '');
  const safeTitle = escDt(spec.title.text);
  const safeCta = escDt(spec.cta.text);
  const totalSec = spec.totalDuration;

  const titleFilter = `drawtext=fontfile=anton.ttf:text='${safeTitle}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=h/4:enable='between(t,0,2.5)':shadowcolor=black:shadowx=2:shadowy=2`;
  const ctaFilter = `drawtext=fontfile=anton.ttf:text='${safeCta}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=h-h/4:enable='gte(t,${Math.max(0, totalSec - 2)})':shadowcolor=black:shadowx=2:shadowy=2`;

  await ffmpeg.exec([
    '-i', 'concat.mp4',
    '-vf', `${titleFilter},${ctaFilter}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-y', 'final.mp4',
  ]);

  onProgress(95, 'Lecture du fichier final...');

  const outputData = await ffmpeg.readFile('final.mp4');
  const blob = new Blob([outputData], { type: 'video/mp4' });

  for (const f of trimmedInputs) { try { await ffmpeg.deleteFile(f); } catch {} }
  try { await ffmpeg.deleteFile('concat.mp4'); } catch {}
  try { await ffmpeg.deleteFile('final.mp4'); } catch {}
  try { await ffmpeg.deleteFile('filelist.txt'); } catch {}

  onProgress(100, 'Prêt !');
  return blob;
}
