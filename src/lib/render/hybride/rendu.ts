/**
 * RENDU HYBRIDE — exécution : images fixes (Remotion `renderStill`, mêmes
 * composants que le rendu complet) puis UN passage ffmpeg (`filtre.ts`).
 *
 * Éligible seulement quand le rendu complet n'apporterait rien de plus :
 * plan Smart Montage (≥ 2 extraits), textes en surimpression, aucune
 * séquence titre / cartes / CTA plein écran, son des rushes coupé, pas
 * d'images-clés de mixage. Sinon — ou au moindre échec — l'appelant garde le
 * rendu Remotion complet : l'hybride ne peut QUE accélérer.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';
import { argumentsHybride, type FenetreSurimpression, type EntreeHybride } from '@/lib/render/hybride/filtre';
import { urlDeLecture } from '@/lib/creer/analyse-rush-serveur';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';

const FPS = 30;
const TIMEOUT_MS = 10 * 60_000;

/** Volumes par défaut du mixage — `remotion/audio.tsx` (`defaultMusicVolume`). */
const volumeMusiqueParDefaut = (avecVoix: boolean) => (avecVoix ? 0.5 : 0.8);

export function estEligibleHybride(d: CreerSimpleRenderInput): boolean {
  const x = d as CreerSimpleRenderInput & { audioKeyframes?: unknown[]; rushLut?: unknown; sequenceBackgrounds?: unknown };
  return (x.montage?.length ?? 0) >= 2
    && !!x.surimpressions
    && !(x.introDuration && x.introDuration > 0)
    && !(x.cardsDuration && x.cardsDuration > 0)
    && !(x.ctaDuration && x.ctaDuration > 0)
    && (x.rushMuted === true || x.rushVolume === 0)
    && !(Array.isArray(x.audioKeyframes) && x.audioKeyframes.length > 0)
    && !x.rushLut;
}

function ffmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (p && require('fs').existsSync(p)) return p;
  } catch { /* binaire système */ }
  return 'ffmpeg';
}

function lancerFfmpeg(args: string[], totalSecondes: number, onFraction?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let journal = '';
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('hybride : délai dépassé')); }, TIMEOUT_MS);
    p.stderr.on('data', (b: Buffer) => {
      const t = b.toString();
      journal = (journal + t).slice(-4000);
      const m = /out_time_ms=(\d+)/.exec(t);
      if (m && onFraction) onFraction(Math.min(1, Number(m[1]) / 1e6 / Math.max(0.1, totalSecondes)));
    });
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg code ${code} : ${journal.split('\n').filter((l) => l && !/=/.test(l)).slice(-3).join(' | ')}`));
    });
  });
}

type ElementStill = 'voile' | 'titre' | 'cta' | 'filigrane' | { carte: number };

/** Rend les images fixes nécessaires (une seule ouverture de Chromium). */
async function rendreStills(design: CreerSimpleRenderInput, elements: ElementStill[], dossier: string): Promise<string[]> {
  const { getOrCreateBundle } = await import('@/lib/render/worker');
  const { openBrowser, selectComposition, renderStill } = await import('@remotion/renderer');
  const serveUrl = await getOrCreateBundle();
  const navigateur = await openBrowser('chrome', { chromiumOptions: { disableWebSecurity: true, gl: 'angle' } });
  try {
    const sorties: string[] = [];
    for (const [k, element] of elements.entries()) {
      // Aucune vidéo, aucun son : l'élément seul, sur fond transparent.
      const inputProps = {
        ...design,
        stillSurimpression: element,
        montage: null, rushs: null, videoUrl: null, musicUrl: null, voiceUrl: null, sequenceVoiceUrls: undefined,
        introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 1,
      };
      const composition = await selectComposition({ serveUrl, id: 'creer-simple-montage', inputProps, puppeteerInstance: navigateur });
      const sortie = path.join(dossier, `still-${k}.png`);
      await renderStill({ composition, serveUrl, output: sortie, inputProps, imageFormat: 'png', frame: 0, puppeteerInstance: navigateur });
      sorties.push(sortie);
    }
    return sorties;
  } finally {
    await navigateur.close({ silent: true }).catch(() => {});
  }
}

/**
 * Copie LOCALE de chaque source, une fois par fichier. Mesuré : lue par HTTP
 * sans requêtes partielles, `ffmpeg-static` 6.0 positionnait mal `-ss` et le
 * montage glissait à partir du 6e extrait ; en fichiers locaux, le résultat
 * est identique au rendu Remotion image pour image, quelle que soit la
 * version de ffmpeg. Les proxys font quelques dizaines de Mo.
 */
async function copieLocale(url: string, dossier: string, k: number): Promise<string> {
  if (!/^https?:\/\//.test(url)) return url;
  const { Readable } = await import('stream');
  const { pipeline } = await import('stream/promises');
  const rep = await fetch(url);
  if (!rep.ok || !rep.body) throw new Error(`source illisible (${rep.status})`);
  const sortie = path.join(dossier, `source-${k}${path.extname(new URL(url).pathname) || '.bin'}`);
  await pipeline(Readable.fromWeb(rep.body as never), fs.createWriteStream(sortie));
  return sortie;
}

export interface MesuresHybride { stillsMs: number; ffmpegMs: number; copieMs: number }

export async function rendreHybride(input: {
  jobId: string;
  design: CreerSimpleRenderInput;
  onProgress?: (p: { progress: number; stage: string }) => void;
}): Promise<{ outputPath: string; durationFrames: number; mesures: MesuresHybride }> {
  const d = input.design;
  if (!estEligibleHybride(d)) throw new Error('rendu hybride non applicable à ce montage');
  const plan = d.montage!;
  const s = d.surimpressions!;
  const duree = d.videoDuration ?? plan[plan.length - 1].fin;
  const format = (d.format === '16:9' ? '16:9' : d.format === '1:1' ? '1:1' : '9:16') as keyof typeof VIDEO_SIZE;
  const taille = VIDEO_SIZE[format];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `studiio-hybride-${input.jobId}-`));

  // ── 1. Images fixes (Remotion, mêmes composants) ──
  const t0 = Date.now();
  input.onProgress?.({ progress: 20, stage: 'Surimpressions...' });
  const elements: ElementStill[] = ['voile'];
  if (s.titre) elements.push('titre');
  s.cartes.forEach((c) => elements.push({ carte: c.index }));
  if (s.cta) elements.push('cta');
  if (d.watermark) elements.push('filigrane');
  const stills = await rendreStills(d, elements, dossier);
  const image = (e: ElementStill) => stills[elements.findIndex((x) => JSON.stringify(x) === JSON.stringify(e))];
  const stillsMs = Date.now() - t0;

  const fenetres: FenetreSurimpression[] = [];
  if (s.titre) fenetres.push({ texte: image('titre'), debut: s.titre[0], fin: s.titre[1] });
  for (const c of s.cartes) fenetres.push({ texte: image({ carte: c.index }), debut: c.debut, fin: c.fin });
  if (s.cta) fenetres.push({ texte: image('cta'), debut: s.cta[0], fin: s.cta[1] });

  // ── 2. Audio : volumes CONSTANTS, comme `mixAt` sans images-clés ──
  const voixUrls = d.sequenceVoiceUrls ?? {};
  const avecVoix = Object.values(voixUrls).some(Boolean);
  const voix: EntreeHybride['voix'] = [];
  for (const cle of ['titre', 'cartes', 'video', 'cta'] as const) {
    const url = (voixUrls as Record<string, string | undefined>)[cle];
    const depart = s.voix[cle];
    if (url && typeof depart === 'number' && depart < duree) voix.push({ source: url, depart, volume: d.voiceVolume ?? 1 });
  }

  // Sources : une copie locale par fichier distinct (voir `copieLocale`).
  const t2 = Date.now();
  const locales = new Map<string, string>();
  let k = 0;
  for (const u of Array.from(new Set([...plan.map((x) => x.url), ...(d.musicUrl ? [d.musicUrl] : []), ...voix.map((v) => v.source)]))) {
    locales.set(u, await copieLocale(await urlDeLecture(u), dossier, k));
    k += 1;
  }
  const local = (u: string) => locales.get(u) ?? u;
  voix.forEach((v) => { v.source = local(v.source); });
  const copieMs = Date.now() - t2;

  const entree: EntreeHybride = {
    segments: plan.map((seg) => ({
      source: local(seg.url), debut: seg.debut, fin: seg.fin, depuis: seg.depuis ?? 0, vitesse: seg.vitesse,
    })),
    duree,
    fps: FPS,
    largeur: taille.w,
    hauteur: taille.h,
    voile: image('voile'),
    filigrane: d.watermark ? image('filigrane') : null,
    surimpressions: fenetres,
    musique: d.musicUrl ? { source: local(d.musicUrl), volume: d.musicVolume ?? volumeMusiqueParDefaut(avecVoix) } : null,
    voix,
    sortie: path.join(os.tmpdir(), `studiio-render-${input.jobId}.mp4`),
  };

  // ── 3. UN passage ffmpeg ──
  const t1 = Date.now();
  input.onProgress?.({ progress: 25, stage: 'Montage...' });
  await lancerFfmpeg(argumentsHybride(entree), duree, (f) => input.onProgress?.({ progress: 25 + f * 70, stage: 'Montage...' }));
  const ffmpegMs = Date.now() - t1;
  fs.rmSync(dossier, { recursive: true, force: true });
  input.onProgress?.({ progress: 98, stage: 'Finalisation...' });
  return { outputPath: entree.sortie, durationFrames: Math.round(duree * FPS), mesures: { stillsMs, ffmpegMs, copieMs } };
}
