// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * JUMEAU 9:16 — « le jumeau ne remplit pas le cadre vertical : image
 * horizontale centrée, grandes bandes en haut et en bas » (Créer → Calendrier).
 *
 * DIAGNOSTIC MESURÉ (médias synthétiques, ffmpeg) :
 *   - le compositeur (`drawVideoSeq`) et l'aperçu (`styleRecadrageRush`) font
 *     un « cover » exact : un jumeau PROPRE horizontal (1280×720) ou vertical
 *     (720×1280) remplit 1080×1920, 1920×1080 et 1080×1080 — aucune bande ;
 *   - le lecteur du Calendrier (`montageFrame` + `object-contain`) a le ratio
 *     EXACT du montage : il n'ajoute rien ;
 *   - MAIS le fichier rendu par le fournisseur pour un avatar 16:9 en 9:16
 *     (constaté #539 : 720×1280, image utile 720×405 au centre) PORTE les
 *     bandes. Le « cover » d'un 9:16 dans un 9:16 est l'identité : le MP4
 *     exporté les recopie (bandes mesurées dans la sortie).
 *   → MP4 MAUVAIS (bandes héritées du fichier source), lecteur BON.
 *
 * CORRECTION : `retirerBandesIncrustees` au rapatriement (`statut.ts`).
 */
import { drawVideoSeq } from '../lib/video-composer';
import { bornerRecadrageRush, rectangleRush, styleRecadrageRush, RATIO_FORMAT } from '../lib/creer/recadrage-rush';
import {
  bandesIncrustees, lireCropdetect, planCadrage, rectangleCover, ratioDemande, retirerBandesIncrustees,
  argumentsRecadrage, dimensionsSortie,
} from '../lib/avatar/cadrage-jumeau';
import { montageFrame } from '../app/dashboard/calendar/page';

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ?? null;
const avecFfmpeg = FFMPEG ? describe : describe.skip;

const SORTIES = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] } as const;

/** Rectangle tracé par le compositeur (contexte factice qui capte `drawImage`). */
function traceCompositeur(src: readonly [number, number], cadre: readonly [number, number], t?: unknown) {
  const appels: number[][] = [];
  const ctx = new Proxy({}, {
    get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const video = { videoWidth: src[0], videoHeight: src[1] } as unknown as HTMLVideoElement;
  drawVideoSeq(ctx, cadre[0], cadre[1], video, null, 0.5, undefined, t as never);
  const [x, y, l, h] = appels[0];
  return { x, y, l, h };
}

/** Rectangle de l'aperçu Créer : `styleRecadrageRush` (en % du plateau) ramené en pixels. */
function traceApercu(src: readonly [number, number], cadre: readonly [number, number], t: unknown) {
  const s = styleRecadrageRush(t as never, { source: src[0] / src[1], cadre: cadre[0] / cadre[1] });
  const pc = (v: unknown) => parseFloat(String(v)) / 100;
  return { x: pc(s.left) * cadre[0], y: pc(s.top) * cadre[1], l: pc(s.width) * cadre[0], h: pc(s.height) * cadre[1] };
}

const run = (args: string[]) => execFileSync(FFMPEG!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const ffmpegStderr = (args: string[]) => String(spawnSync(FFMPEG!, args, { encoding: 'utf8' }).stderr);

/**
 * « Rendu » du compositeur avec ffmpeg : la source mise à l'échelle au
 * rectangle de `drawImage` et posée sur un cadre NOIR — puis les lignes et
 * colonnes NOIRES du résultat sont COMPTÉES (image du milieu, en gris).
 */
function rendreEtMesurer(dossier: string, source: string, cadre: readonly [number, number], r: { x: number; y: number; l: number; h: number }, nom: string) {
  const sortie = join(dossier, `${nom}.mp4`);
  const L = Math.round(r.l / 2) * 2; const H = Math.round(r.h / 2) * 2;
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=${cadre[0]}x${cadre[1]}:d=1:r=30`, '-i', source,
    '-filter_complex', `[1:v]scale=${L}:${H},setsar=1[s];[0:v][s]overlay=x=${Math.round(r.x)}:y=${Math.round(r.y)}:shortest=1`,
    '-frames:v', '15', '-pix_fmt', 'yuv420p', sortie]);
  return mesurerBandes(sortie, cadre);
}

/** Lignes/colonnes noires (luma < 20 sur toute la ligne) en haut, bas, gauche, droite. */
function mesurerBandes(fichier: string, cadre: readonly [number, number]) {
  const [w, h] = cadre;
  const raw = execFileSync(FFMPEG!, ['-v', 'error', '-i', fichier, '-vf', 'select=eq(n\\,10),format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const ligneNoire = (y: number) => { for (let x = 0; x < w; x += 4) if (raw[y * w + x] >= 20) return false; return true; };
  const colNoire = (x: number) => { for (let y = 0; y < h; y += 4) if (raw[y * w + x] >= 20) return false; return true; };
  let haut = 0; while (haut < h && ligneNoire(haut)) haut++;
  let bas = 0; while (bas < h && ligneNoire(h - 1 - bas)) bas++;
  let gauche = 0; while (gauche < w && colNoire(gauche)) gauche++;
  let droite = 0; while (droite < w && colNoire(w - 1 - droite)) droite++;
  return { haut, bas, gauche, droite };
}

let dossier = '';
const media: Record<string, string> = {};

beforeAll(() => {
  if (!FFMPEG) return;
  dossier = mkdtempSync(join(tmpdir(), 'jumeau-cadrage-test-'));
  // H : jumeau horizontal propre ; V : vertical propre ;
  // HB : ce que rend le fournisseur pour un avatar 16:9 demandé en 9:16 SANS remplissage
  //      (720×1280, image utile 720×405 au centre — mesuré en production, #539).
  const src = 'testsrc2=size=%S:rate=30';
  media.H = join(dossier, 'H.mp4');
  media.V = join(dossier, 'V.mp4');
  media.HB = join(dossier, 'HB.mp4');
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', src.replace('%S', '1280x720'), '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media.H]);
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', src.replace('%S', '720x1280'), '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media.V]);
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', src.replace('%S', '720x405'), '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1',
    '-vf', 'pad=720:1280:0:(1280-405)/2:black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media.HB]);
});
afterAll(() => { if (dossier) rmSync(dossier, { recursive: true, force: true }); });

avecFfmpeg('Mesure — compositeur « cover » sur des jumeaux synthétiques (pixels du rendu)', () => {
  it('A — jumeau HORIZONTAL propre → 9:16 : plein cadre, aucune ligne noire en haut ni en bas', () => {
    const r = traceCompositeur([1280, 720], SORTIES['9:16']);
    const b = rendreEtMesurer(dossier, media.H, SORTIES['9:16'], r, 'A');
    expect(b).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });
  it('B — jumeau VERTICAL propre → 9:16 : plein cadre', () => {
    const r = traceCompositeur([720, 1280], SORTIES['9:16']);
    expect(rendreEtMesurer(dossier, media.V, SORTIES['9:16'], r, 'B')).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });
  it('C — horizontal → 1:1 : plein cadre', () => {
    const r = traceCompositeur([1280, 720], SORTIES['1:1']);
    expect(rendreEtMesurer(dossier, media.H, SORTIES['1:1'], r, 'C')).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });
  it('D — horizontal → 16:9 : plein cadre', () => {
    const r = traceCompositeur([1280, 720], SORTIES['16:9']);
    expect(rendreEtMesurer(dossier, media.H, SORTIES['16:9'], r, 'D')).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });

  it('⚠️ CAUSE — fichier fournisseur à bandes incrustées : le « cover » les RECOPIE dans le MP4 (≈ 656 px en haut et en bas)', () => {
    const r = traceCompositeur([720, 1280], SORTIES['9:16']);
    const b = rendreEtMesurer(dossier, media.HB, SORTIES['9:16'], r, 'cause');
    // Le MP4 lui-même porte les bandes : ce n'est pas le lecteur.
    expect(b.haut).toBeGreaterThan(600);
    expect(b.bas).toBeGreaterThan(600);
  });

  it('⚠️ CORRECTION — après `retirerBandesIncrustees` (rapatriement), le même export 9:16 est PLEIN CADRE', async () => {
    const r0 = await retirerBandesIncrustees(readFileSync(media.HB), { aspectRatio: '9:16', ffmpeg: FFMPEG! });
    expect(r0.corrige).toBe(true);
    const propre = join(dossier, 'HB-propre.mp4');
    writeFileSync(propre, r0.buffer);
    // Fichier corrigé : 720×1280, aucune bande, son conservé.
    const infos = ffmpegStderr(['-hide_banner', '-i', propre]);
    expect(infos).toMatch(/Video:[^\n]*720x1280/);
    expect(infos).toMatch(/Audio:/);
    expect(mesurerBandes(propre, [720, 1280])).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
    // Export du compositeur sur le fichier corrigé.
    const r = traceCompositeur([720, 1280], SORTIES['9:16']);
    expect(rendreEtMesurer(dossier, propre, SORTIES['9:16'], r, 'apres')).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });

  it('un jumeau PROPRE n\'est jamais réencodé (horizontal, vertical)', async () => {
    for (const k of ['H', 'V'] as const) {
      const buf = readFileSync(media[k]);
      const r = await retirerBandesIncrustees(buf, { aspectRatio: '9:16', ffmpeg: FFMPEG! });
      expect(r.corrige).toBe(false);
      expect(r.buffer).toBe(buf);
    }
  });

  it('fichier illisible ou ffmpeg absent : fichier d\'origine, jamais d\'erreur', async () => {
    const buf = Buffer.from('pas une video');
    expect((await retirerBandesIncrustees(buf, { aspectRatio: '9:16', ffmpeg: FFMPEG! })).buffer).toBe(buf);
    expect((await retirerBandesIncrustees(buf, { aspectRatio: '9:16', ffmpeg: '/nulle/part/ffmpeg' })).buffer).toBe(buf);
  });
});

describe('Règles pures du cadrage', () => {
  it('cropdetect : la DERNIÈRE mesure (union du clip) est lue', () => {
    expect(lireCropdetect('x crop=720:400:0:440 y crop=720:404:0:436\n')).toEqual({ l: 720, h: 404, x: 0, y: 436 });
    expect(lireCropdetect('rien')).toBeNull();
  });
  it('bandes incrustées : symétriques sur un axe, l\'autre entier — sinon rien', () => {
    expect(bandesIncrustees({ l: 720, h: 1280 }, { l: 720, h: 404, x: 0, y: 436 })).toBe(true); // letterbox
    expect(bandesIncrustees({ l: 1920, h: 1080 }, { l: 608, h: 1080, x: 656, y: 0 })).toBe(true); // pillarbox
    expect(bandesIncrustees({ l: 720, h: 1280 }, { l: 720, h: 1280, x: 0, y: 0 })).toBe(false); // plein
    // Fond sombre d'UN seul côté (sujet en bas du cadre) : pas une bande.
    expect(bandesIncrustees({ l: 720, h: 1280 }, { l: 720, h: 900, x: 0, y: 380 })).toBe(false);
    // Bandes sur les DEUX axes (vignette) : pas une bande incrustée.
    expect(bandesIncrustees({ l: 720, h: 1280 }, { l: 600, h: 1000, x: 60, y: 140 })).toBe(false);
  });
  it('H — aucun étirement : la coupe a le ratio de la sortie (même facteur sur x et y)', () => {
    for (const [ratio, src] of [['9:16', { l: 720, h: 1280 }], ['16:9', { l: 1280, h: 720 }], ['1:1', { l: 1080, h: 1080 }]] as const) {
      const r = ratioDemande(ratio)!;
      const zone = src.l < src.h ? { l: 720, h: 404, x: 0, y: 438 } : { l: 404, h: src.h, x: (src.l - 404) / 2, y: 0 };
      const p = planCadrage(src, zone, r)!;
      expect(p).not.toBeNull();
      expect(p.sortie.l / p.coupe.l).toBeCloseTo(p.sortie.h / p.coupe.h, 1);
      expect(p.sortie.l / p.sortie.h).toBeCloseTo(r, 1);
      // La coupe reste DANS la zone utile (aucune bande ne survit).
      expect(p.coupe.x).toBeGreaterThanOrEqual(zone.x);
      expect(p.coupe.y).toBeGreaterThanOrEqual(zone.y);
      expect(p.coupe.x + p.coupe.l).toBeLessThanOrEqual(zone.x + zone.l);
      expect(p.coupe.y + p.coupe.h).toBeLessThanOrEqual(zone.y + zone.h);
    }
  });
  it('cover centré : le sujet (centre de la zone) reste au centre', () => {
    const c = rectangleCover({ l: 720, h: 404, x: 0, y: 438 }, 9 / 16);
    expect(c.x + c.l / 2).toBeCloseTo(360, 0);
    expect(c.y + c.h / 2).toBeCloseTo(438 + 202, 0);
    expect(dimensionsSortie({ l: 720, h: 1280 }, 9 / 16)).toEqual({ l: 720, h: 1280 });
    expect(dimensionsSortie({ l: 720, h: 1280 }, 1)).toEqual({ l: 1280, h: 1280 });
  });
  it('le son est COPIÉ (lip-sync intact), lecture locale uniquement', () => {
    const a = argumentsRecadrage('/e.mp4', '/s.mp4', { coupe: { l: 226, h: 404, x: 247, y: 438 }, sortie: { l: 720, h: 1280 } });
    expect(a.join(' ')).toContain('-c:a copy');
    expect(a.join(' ')).toContain('-protocol_whitelist file');
    expect(a.join(' ')).toContain('crop=226:404:247:438,scale=720:1280');
  });
});

describe('Aperçu Créer = MP4 = Calendrier (mêmes coordonnées)', () => {
  const cas: Array<[string, readonly [number, number], keyof typeof SORTIES, { scale: number; offsetX: number; offsetY: number }]> = [
    ['jumeau horizontal, sans recadrage', [1280, 720], '9:16', { scale: 1, offsetX: 0, offsetY: 0 }],
    ['jumeau horizontal, recadrage manuel #540', [1280, 720], '9:16', { scale: 1.3, offsetX: -0.4, offsetY: 0.05 }],
    ['jumeau vertical → 16:9, recadrage manuel', [720, 1280], '16:9', { scale: 1.1, offsetX: 0, offsetY: 0.3 }],
    ['jumeau horizontal → 1:1, recadrage manuel', [1280, 720], '1:1', { scale: 1.2, offsetX: 0.2, offsetY: 0 }],
  ];
  for (const [nom, src, f, demande] of cas) {
    it(`E/F — ${nom} : l'aperçu trace le rectangle du rendu, plein cadre, sans étirement`, () => {
      const cadre = SORTIES[f];
      const t = bornerRecadrageRush(demande, { srcW: src[0], srcH: src[1], w: cadre[0], h: cadre[1] });
      const rendu = traceCompositeur(src, cadre, t);
      const apercu = traceApercu(src, cadre, t);
      for (const k of ['x', 'y', 'l', 'h'] as const) expect(apercu[k]).toBeCloseTo(rendu[k], 0);
      const lib = rectangleRush(src[0], src[1], cadre[0], cadre[1], t);
      expect(lib.x).toBeCloseTo(rendu.x, 3);
      // Plein cadre.
      expect(rendu.x).toBeLessThanOrEqual(0.5);
      expect(rendu.y).toBeLessThanOrEqual(0.5);
      expect(rendu.x + rendu.l).toBeGreaterThanOrEqual(cadre[0] - 0.5);
      expect(rendu.y + rendu.h).toBeGreaterThanOrEqual(cadre[1] - 0.5);
      // H — aucun étirement.
      expect(rendu.l / rendu.h).toBeCloseTo(src[0] / src[1], 3);
      // Le recadrage manuel n'est pas perdu : il déplace bien l'image.
      if (demande.offsetX || demande.offsetY || demande.scale !== 1) {
        const neutre = traceCompositeur(src, cadre);
        expect(Math.abs(rendu.x - neutre.x) + Math.abs(rendu.y - neutre.y) + Math.abs(rendu.l - neutre.l)).toBeGreaterThan(1);
      }
      expect(RATIO_FORMAT[f]).toBeCloseTo(cadre[0] / cadre[1], 3);
    });
  }

  it('G — Calendrier : le cadre du lecteur a le ratio EXACT du MP4 (aucune bande ajoutée), pour chaque format', () => {
    for (const [, [w, h]] of Object.entries(SORTIES)) {
      const f = montageFrame({ w, h }, w > h ? 'tv' : 'reel');
      expect(f.style.aspectRatio).toBe(`${w} / ${h}`);
    }
    // Post sans `videoSize` (anciens) : ratio du format, comme avant.
    expect(montageFrame(undefined, 'reel').style.aspectRatio).toBe('9/16');
  });
});
