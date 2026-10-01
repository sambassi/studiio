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
// ⚠️ IMPORTS STATIQUES, jamais `await import('stream')` : `stream` est une
// FONCTION (le constructeur Stream). Compilé par webpack (serveur Next), un
// import DYNAMIQUE en fait un faux espace de noms qui n'a QUE `default` :
// `Readable` y valait `undefined`, la copie des sources levait « Cannot read
// properties of undefined (reading 'fromWeb') » et TOUT rendu hybride
// retombait sur Remotion (test réel staging 01/10, 12 min au lieu de ~2).
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';
import { argumentsHybride, type FenetreSurimpression, type EntreeHybride } from '@/lib/render/hybride/filtre';
import { urlDeLecture } from '@/lib/creer/analyse-rush-serveur';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';
import type { ElementLisibilite } from '@/lib/creer/conseiller/lisibilite';

const FPS = 30;
const TIMEOUT_MS = 10 * 60_000;

/** Volumes par défaut du mixage — `remotion/audio.tsx` (`defaultMusicVolume`). */
const volumeMusiqueParDefaut = (avecVoix: boolean) => (avecVoix ? 0.5 : 0.8);

/**
 * Pourquoi le rendu hybride ne s'applique PAS à ce montage (`null` = il
 * s'applique). Écrit tel quel dans les métadonnées : jamais de repli muet.
 */
export function raisonNonEligibleHybride(d: CreerSimpleRenderInput): string | null {
  const x = d as CreerSimpleRenderInput & { audioKeyframes?: unknown[]; rushLut?: unknown };
  if ((x.montage?.length ?? 0) < 2) return 'pas de plan Smart Montage (moins de 2 extraits)';
  if (!x.surimpressions) return 'textes en séquences plein écran (pas de surimpression)';
  if (x.introDuration && x.introDuration > 0) return 'séquence titre plein écran';
  if (x.cardsDuration && x.cardsDuration > 0) return 'séquence cartes plein écran';
  if (x.ctaDuration && x.ctaDuration > 0) return 'séquence CTA plein écran';
  if (!(x.rushMuted === true || x.rushVolume === 0)) return 'son des rushes conservé';
  if (Array.isArray(x.audioKeyframes) && x.audioKeyframes.length > 0) return 'images-clés de mixage audio';
  if (x.rushLut) return 'filtre couleur (LUT) sur le rush';
  return null;
}

export function estEligibleHybride(d: CreerSimpleRenderInput): boolean {
  return raisonNonEligibleHybride(d) === null;
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
  const rep = await fetch(url);
  if (!rep.ok || !rep.body) throw new Error(`source illisible (${rep.status})`);
  const sortie = path.join(dossier, `source-${k}${path.extname(new URL(url).pathname) || '.bin'}`);
  await pipeline(Readable.fromWeb(rep.body as never), fs.createWriteStream(sortie));
  return sortie;
}

/** Exécute une étape ; une erreur dit QUELLE étape a échoué. */
async function etape<T>(nom: string, f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (err) {
    throw new Error(`${nom} : ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface MesuresHybride { stillsMs: number; ffmpegMs: number; copieMs: number }

export async function rendreHybride(input: {
  jobId: string;
  design: CreerSimpleRenderInput;
  onProgress?: (p: { progress: number; stage: string }) => void;
}): Promise<{ outputPath: string; durationFrames: number; mesures: MesuresHybride; textes: ElementLisibilite[] | null }> {
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
  const stills = await etape('images fixes (Remotion renderStill)', () => rendreStills(d, elements, dossier));
  const image = (e: ElementStill) => stills[elements.findIndex((x) => JSON.stringify(x) === JSON.stringify(e))];
  const stillsMs = Date.now() - t0;

  const fenetres: FenetreSurimpression[] = [];
  // Conseiller : quel texte porte chaque image (mesures de lisibilité).
  const textes: Array<{ cible: string; texte: string | null; image: string; debut: number; fin: number }> = [];
  const noter = (cible: string, texte: string | null, f: FenetreSurimpression) => { fenetres.push(f); textes.push({ cible, texte, image: f.texte, debut: f.debut, fin: f.fin }); };
  const carteTexte = (i: number) => { const c = d.cards?.[i]; return c ? [c.title ?? c.label, c.value].filter(Boolean).join(' · ') || null : null; };
  if (s.titre) noter('accroche', [d.title, d.subtitle].filter(Boolean).join(' — ') || null, { texte: image('titre'), debut: s.titre[0], fin: s.titre[1] });
  for (const c of s.cartes) noter(`carte:${c.index}`, carteTexte(c.index), { texte: image({ carte: c.index }), debut: c.debut, fin: c.fin });
  if (s.cta) noter('cta', d.ctaText ?? null, { texte: image('cta'), debut: s.cta[0], fin: s.cta[1] });

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
    locales.set(u, await etape(`copie de la source ${k + 1}`, async () => copieLocale(await urlDeLecture(u), dossier, k)));
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
    analyseBase: path.join(dossier, 'base.gray'),
  };

  // ── 3. UN passage ffmpeg ──
  const t1 = Date.now();
  input.onProgress?.({ progress: 25, stage: 'Montage...' });
  await etape('ffmpeg', () => lancerFfmpeg(argumentsHybride(entree), duree, (f) => input.onProgress?.({ progress: 25 + f * 70, stage: 'Montage...' })));
  const ffmpegMs = Date.now() - t1;
  // Conseiller : mesures des textes (best-effort, n'arrête jamais le rendu).
  const { mesurerTextes } = await import('@/lib/render/hybride/mesures-textes');
  const mesuresTextes = await mesurerTextes({ ffmpeg: ffmpegPath(), baseBrute: entree.analyseBase!, textes });
  fs.rmSync(dossier, { recursive: true, force: true });
  input.onProgress?.({ progress: 98, stage: 'Finalisation...' });
  return { outputPath: entree.sortie, durationFrames: Math.round(duree * FPS), mesures: { stillsMs, ffmpegMs, copieMs }, textes: mesuresTextes };
}
