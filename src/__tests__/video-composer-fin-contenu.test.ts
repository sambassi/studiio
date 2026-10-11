/**
 * Fin du CONTENU = fin de l'ENREGISTREMENT (PR #543).
 *
 * Le compositeur enregistrait jusqu'à `totalDuration + 0,3 s` : 0,3 s de
 * dernière image figée en plus dans chaque fichier — le dernier média
 * semblait durer 0,3 s de trop (banc navigateur : 4 s affichées → 130 images
 * à 30 i/s au lieu de 120). Mesuré dans Chrome : `MediaRecorder.stop()` vide
 * son tampon lui-même, la dernière image et l'audio sont bien dans le fichier
 * sans cette marge.
 *
 * Ces tests exécutent le VRAI `composeVideo` sur un faux navigateur, en mode
 * fast (sans audio) ET temps réel (audio) :
 * - aucune image n'est dessinée à un instant logique ≥ la durée du contenu ;
 * - aucune image n'est dessinée après l'arrêt de l'enregistreur ;
 * - l'enregistreur s'arrête dès la fin du contenu (plus de marge de 0,3 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { composeVideo, horlogeMontage, type ComposerOptions } from '@/lib/video-composer';

// ── Journal : début/arrêt de l'enregistreur, chaque image dessinée ─────────
const journal = { debut: 0, arret: 0, dessins: [] as number[] };

class FauxMediaStream {
  private pistes: unknown[] = [];
  addTrack(t: unknown) { this.pistes.push(t); }
  getTracks() { return this.pistes; }
  getVideoTracks() { return []; }
  getAudioTracks() { return []; }
}

class FauxMediaRecorder {
  static isTypeSupported(t: string) { return t === 'video/webm'; }
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start() { this.state = 'recording'; journal.debut = performance.now(); }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    journal.arret = performance.now();
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'video/webm' }) });
      this.onstop?.();
    }, 0);
  }
}

class FauxImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 64; naturalHeight = 64; width = 64; height = 64;
  set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
}

class FauxAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamDestination() { return { stream: new FauxMediaStream() }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} }; }
  createMediaElementSource() { return { connect() {} }; }
}

function contexte2D() {
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none', font: '10px sans-serif' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    // `drawFrame` commence TOUJOURS par effacer le canvas : une image = un clearRect.
    clearRect: () => { journal.dessins.push(performance.now()); },
    measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const noop = () => {};
  return new Proxy(base, {
    get: (t, p) => (p in t ? (t as never)[p] : p in etat ? etat[p as string] : noop),
    set: (_t, p, v) => { etat[p as string] = v; return true; },
  });
}

const originaux: Record<string, unknown> = {};
function installerNavigateur() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) originaux[k] = g[k];
  g.MediaRecorder = FauxMediaRecorder;
  g.MediaStream = FauxMediaStream;
  g.Image = FauxImage;
  g.AudioContext = FauxAudioContext;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) originaux[k] = proto[k];
  proto.getContext = function getContext() { return contexte2D(); };
  proto.captureStream = function captureStream() { return new FauxMediaStream(); };
  proto.toBlob = function toBlob(cb: (b: Blob | null) => void) { cb(new Blob(['j'], { type: 'image/jpeg' })); };
  proto.toDataURL = function toDataURL() { return 'data:image/png;base64,AAAA'; };
}
function retirerNavigateur() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[k];
}

const DUREE = 0.6; // 0,2 + 0,2 + 0,2
const options = (sur: Partial<ComposerOptions> = {}): ComposerOptions => ({
  width: 64,
  height: 64,
  fps: 30,
  title: 'T',
  cards: [],
  videoImageUrl: 'data:image/png;base64,AAAA',
  introDuration: 0.2,
  cardsDuration: 0,
  videoDuration: 0.2,
  ctaDuration: 0.2,
  accentColor: '#7C3AED',
  ...sur,
} as ComposerOptions);
const tempsReel = { musicBuffer: { duration: 5, numberOfChannels: 2 } as unknown as AudioBuffer };

beforeEach(() => {
  journal.debut = 0; journal.arret = 0; journal.dessins = [];
  installerNavigateur();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  retirerNavigateur();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('horlogeMontage — fin du contenu séparée de la finalisation', () => {
  it('le contenu court jusqu’à sa durée, pas au-delà', () => {
    expect(horlogeMontage(0, 12)).toEqual({ t: 0, fini: false });
    expect(horlogeMontage(11.99, 12)).toEqual({ t: 11.99, fini: false });
    expect(horlogeMontage(12, 12).fini).toBe(true);
    expect(horlogeMontage(12.3, 12).fini).toBe(true);
  });
  it('l’instant dessiné reste STRICTEMENT dans la dernière séquence', () => {
    for (const e of [11.9995, 12, 12.2, 99]) expect(horlogeMontage(e, 12).t).toBeLessThan(12);
    expect(horlogeMontage(-1, 12).t).toBe(0);
  });
  it('⚠️ plus de marge « totalDuration + 0.3 » dans le compositeur', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/video-composer.ts'), 'utf8');
    expect(src).not.toMatch(/totalDuration\s*\+\s*0\.3/);
    expect(src.match(/horlogeMontage\(elapsed, totalDuration\)/g)?.length).toBe(2);
  });
});

describe.each([
  ['fast', {}],
  ['temps réel', tempsReel],
] as const)('composeVideo — mode %s', (_mode, extra) => {
  it('arrête l’enregistreur à la fin du contenu, sans 0,3 s de dernière image figée', async () => {
    const r = await composeVideo(options(extra));
    expect(r.video.size).toBeGreaterThan(0);
    const arret = (journal.arret - journal.debut) / 1000;
    expect(arret).toBeGreaterThanOrEqual(DUREE);
    // Une cadence de boucle (≤ 1/30 s, rAF de jsdom ~16 ms) + marge d'ordonnanceur.
    expect(arret).toBeLessThan(DUREE + 0.2);
  });

  it('aucune image n’est dessinée au-delà de la durée du contenu ni après l’arrêt', async () => {
    await composeVideo(options(extra));
    const pendant = journal.dessins.filter((x) => x >= journal.debut);
    expect(pendant.length).toBeGreaterThan(0);
    for (const x of pendant) {
      expect(x).toBeLessThanOrEqual(journal.arret);
      // Petite tolérance : l'horloge du composer est lue quelques µs avant ce relevé.
      expect((x - journal.debut) / 1000).toBeLessThan(DUREE + 0.005);
    }
  });
});
