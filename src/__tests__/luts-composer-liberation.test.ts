/**
 * L'étalonneur WebGL du compositeur est libéré sur TOUS les chemins de fin.
 *
 * Un navigateur ne tolère qu'une poignée de contextes WebGL vivants (Chrome :
 * 16). Un contexte qui fuit par export, et le N-ième export perd le plus
 * ancien — ou l'étalonnage s'éteint sans prévenir. Ces tests exécutent le
 * VRAI `composeVideo`, sur un faux navigateur (canvas, MediaRecorder,
 * AudioContext), avec un étalonneur espionné qui compte ses contextes vivants.
 *
 * Chemins couverts, en mode fast (sans audio) ET temps réel (audio) :
 * - fin normale (`onstop`) ;
 * - erreur du MediaRecorder en cours de montage (interruption) ;
 * - échec au démarrage (`recorder.start` lève) — la promesse REJETTE, elle
 *   ne reste pas pendante ;
 * - échec AVANT la boucle (`new MediaRecorder` lève) : aucun contexte n'est
 *   même créé ;
 * - exports successifs : aucun contexte ne survit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Étalonneur espionné ────────────────────────────────────────────────────
interface FauxEtalonneur { grade: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; vivant: boolean }
const etalonneurs: FauxEtalonneur[] = [];
const createLutGraderSpy = vi.fn(() => {
  const g: FauxEtalonneur = {
    vivant: true,
    grade: vi.fn(() => null),
    dispose: vi.fn(() => { g.vivant = false; }),
  };
  etalonneurs.push(g);
  return g;
});
vi.mock('@/lib/luts/grader', () => ({ createLutGrader: (...a: unknown[]) => createLutGraderSpy(...(a as [])) }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { composeVideo, type ComposerOptions } from '@/lib/video-composer';
import type { Lut } from '@/lib/luts/types';

// ── Faux navigateur ────────────────────────────────────────────────────────
type ScenarioRecorder = 'ok' | 'ctor-leve' | 'start-leve' | 'erreur-en-cours';
let scenario: ScenarioRecorder = 'ok';

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
  constructor() {
    if (scenario === 'ctor-leve') throw new DOMException('codec refusé', 'NotSupportedError');
  }
  start() {
    if (scenario === 'start-leve') throw new DOMException('flux inactif', 'InvalidStateError');
    this.state = 'recording';
    if (scenario === 'erreur-en-cours') {
      setTimeout(() => {
        // Comme le navigateur : `error`, puis l'enregistreur s'arrête.
        this.onerror?.(new Event('error'));
        this.state = 'inactive';
        this.onstop?.();
      }, 30);
    }
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
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
  createBufferSource() {
    return { buffer: null, loop: false, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} };
  }
  createMediaElementSource() { return { connect() {} }; }
}

function contexte2D() {
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none', font: '10px sans-serif' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
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
  originaux.getContext = proto.getContext;
  originaux.captureStream = proto.captureStream;
  originaux.toBlob = proto.toBlob;
  originaux.toDataURL = proto.toDataURL;
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

// ── Montage minimal : une image fixe comme rush, séquences courtes ─────────
const LUT: Lut = {
  kind: '3d', size: 2, table: new Float32Array(24),
  domainMin: [0, 0, 0], domainMax: [1, 1, 1],
};
const options = (sur: Partial<ComposerOptions> = {}): ComposerOptions => ({
  width: 64,
  height: 64,
  fps: 30,
  title: 'T',
  cards: [],
  videoImageUrl: 'data:image/png;base64,AAAA',
  introDuration: 0.1,
  cardsDuration: 0,
  videoDuration: 0.1,
  ctaDuration: 0.1,
  accentColor: '#7C3AED',
  rushLut: { lut: LUT, intensity: 1 },
  ...sur,
} as ComposerOptions);
/** Mode temps réel : un tampon de musique suffit à le déclencher. */
const tempsReel = { musicBuffer: { duration: 5, numberOfChannels: 2 } as unknown as AudioBuffer };

const vivants = () => etalonneurs.filter((g) => g.vivant).length;
const canvasOrphelins = () => document.body.querySelectorAll('canvas').length;

beforeEach(() => {
  scenario = 'ok';
  etalonneurs.length = 0;
  createLutGraderSpy.mockClear();
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

describe.each([
  ['fast', {}],
  ['temps réel', tempsReel],
] as const)('libération de l’étalonneur — mode %s', (_mode, extra) => {
  it('fin normale : le montage est livré, l’étalonneur libéré', async () => {
    const r = await composeVideo(options(extra));
    expect(r.video.size).toBeGreaterThan(0);
    expect(createLutGraderSpy).toHaveBeenCalledTimes(1);
    expect(etalonneurs[0].dispose).toHaveBeenCalled();
    expect(vivants()).toBe(0);
    expect(canvasOrphelins()).toBe(0);
  });

  it('erreur du MediaRecorder en cours de montage : rejet ET libération', async () => {
    scenario = 'erreur-en-cours';
    await expect(composeVideo(options(extra))).rejects.toThrow('Recording failed');
    expect(createLutGraderSpy).toHaveBeenCalledTimes(1);
    expect(vivants()).toBe(0);
  });

  it('⚠️ démarrage refusé (`recorder.start` lève) : la promesse REJETTE et libère', async () => {
    scenario = 'start-leve';
    // Avant : en temps réel, l'exception se perdait dans l'exécuteur async et
    // la promesse restait pendante pour toujours (bouton figé, contexte vivant).
    await expect(composeVideo(options(extra))).rejects.toThrow('flux inactif');
    expect(createLutGraderSpy).toHaveBeenCalledTimes(1);
    expect(vivants()).toBe(0);
    expect(canvasOrphelins()).toBe(0);
  });

  it('⚠️ échec AVANT la boucle (`new MediaRecorder` lève) : aucun contexte créé', async () => {
    scenario = 'ctor-leve';
    await expect(composeVideo(options(extra))).rejects.toThrow('codec refusé');
    // Avant : l'étalonneur était créé avant l'installation audio et le
    // MediaRecorder, et fuyait à chaque échec de ce genre.
    expect(createLutGraderSpy).not.toHaveBeenCalled();
  });

  it('exports successifs, réussis ou non : aucun contexte ne survit', async () => {
    await composeVideo(options(extra));
    scenario = 'start-leve';
    await composeVideo(options(extra)).catch(() => {});
    scenario = 'erreur-en-cours';
    await composeVideo(options(extra)).catch(() => {});
    scenario = 'ok';
    await composeVideo(options(extra));
    expect(createLutGraderSpy).toHaveBeenCalledTimes(4);
    expect(vivants()).toBe(0);
  });

  it('sans `rushLut` : aucun étalonneur créé (rendu d’avant)', async () => {
    await composeVideo(options({ ...extra, rushLut: undefined }));
    expect(createLutGraderSpy).not.toHaveBeenCalled();
  });
});

describe('étalonnage — ce qu’il reçoit', () => {
  it('la table et l’intensité transmises sont celles données au compositeur', async () => {
    await composeVideo(options({ rushLut: { lut: LUT, intensity: 0.4 } }));
    expect(createLutGraderSpy).toHaveBeenCalledWith(LUT, 0.4);
  });

  it('pas de rush : pas d’étalonneur, même avec une LUT', async () => {
    await composeVideo(options({ videoImageUrl: undefined, videoDuration: 0 }));
    expect(createLutGraderSpy).not.toHaveBeenCalled();
  });
});
