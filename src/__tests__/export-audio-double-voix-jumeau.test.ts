/**
 * EXPORT AUDIO — une seule voix à la fois, et la voix du jumeau dans le mix.
 *
 * Exécute le VRAI `composeVideo` (mode temps réel) sur un faux navigateur :
 * éléments <audio>/<video> qui journalisent leurs lectures, AudioContext qui
 * suit le graphe (source → porte → mix) et des analyseurs qui rendent le
 * signal d'une source EN LECTURE. Aucun fichier, aucun fournisseur réel.
 *
 * Bug 1 : la voix globale legacy (`voiceUrl`) démarrait à 0 s EN MÊME TEMPS
 * que la voix du titre. Bug 2 : un jumeau visible mais MUET dans le MP4.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { composeVideo, voixGlobaleActive, MESSAGE_JUMEAU_MUET, type ComposerOptions } from '@/lib/video-composer';

// ── Journal des lectures : (src, type, instant depuis le début de l'enregistrement) ──
interface Lecture { src: string; type: 'audio' | 'video'; a: number }
const lectures: Lecture[] = [];
const creesAudio: string[] = [];
let debutEnregistrement = 0;
/** Instant (s) depuis le début de l'ENREGISTREMENT (négatif si avant). */
const maintenant = () => (performance.now() - debutEnregistrement) / 1000;
/** Amplitude rendue par une source EN LECTURE, par `type:src`. Absent = 0 (silence). */
let signal: Record<string, number> = {};

class FauxAudio {
  crossOrigin = '';
  preload = '';
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = 5;
  readyState = 4;
  paused = true;
  oncanplaythrough: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(v: string) { this._src = v; creesAudio.push(v); }
  get currentSrc() { return this._src; }
  load() { setTimeout(() => this.oncanplaythrough?.(), 0); }
  play() { this.paused = false; lectures.push({ src: this._src, type: 'audio', a: maintenant() }); return Promise.resolve(); }
  pause() { this.paused = true; }
}

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
  start() { this.state = 'recording'; debutEnregistrement = performance.now(); }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'video/webm' }) }); this.onstop?.(); }, 0);
  }
}

class FauxImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 64; naturalHeight = 64; width = 64; height = 64;
  set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
}

type Noeud = { connect: (n: Noeud) => void; el?: { src: string; tagName?: string; paused: boolean }; gain?: { value: number }; sources?: Noeud[] };
const portes: Array<{ gain: { value: number } }> = [];
class FauxAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamDestination() { return { stream: new FauxMediaStream(), connect() {} }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
  createGain() {
    const g = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} };
    portes.push(g);
    return g;
  }
  createAnalyser() {
    const a: Noeud & { getFloatTimeDomainData: (b: Float32Array) => void } = {
      sources: [],
      connect() {},
      getFloatTimeDomainData(b: Float32Array) {
        const el = a.sources?.[0]?.el;
        const type = el && 'videoWidth' in el ? 'video' : 'audio';
        const amp = el && !el.paused ? (signal[`${type}:${el.src}`] ?? 0) : 0;
        b.fill(amp);
      },
    };
    return a;
  }
  createMediaElementSource(el: { src: string; paused: boolean }) {
    const n: Noeud = { el, connect(t: Noeud) { t.sources?.push(n); } };
    return n;
  }
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

const originaux: Record<string, PropertyDescriptor | unknown> = {};
const PROTO_MEDIA = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
const PROTO_VIDEO = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
function installerNavigateur() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext', 'Audio']) originaux[k] = g[k];
  Object.assign(g, { MediaRecorder: FauxMediaRecorder, MediaStream: FauxMediaStream, Image: FauxImage, AudioContext: FauxAudioContext, Audio: FauxAudio });
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) originaux[`c:${k}`] = proto[k];
  proto.getContext = function getContext() { return contexte2D(); };
  proto.captureStream = function captureStream() { return new FauxMediaStream(); };
  proto.toBlob = function toBlob(cb: (b: Blob | null) => void) { cb(new Blob(['j'], { type: 'image/jpeg' })); };
  proto.toDataURL = function toDataURL() { return 'data:image/png;base64,AAAA'; };
  // <video> : charge aussitôt, a une image, journalise ses lectures.
  for (const k of ['load', 'play', 'pause', 'paused', 'currentTime', 'duration']) originaux[`m:${k}`] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k);
  for (const k of ['videoWidth', 'videoHeight']) originaux[`v:${k}`] = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, k);
  type M = HTMLMediaElement & { _pause?: boolean; _t?: number; oncanplaythrough: (() => void) | null };
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value(this: M) { setTimeout(() => this.oncanplaythrough?.(), 0); } });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value(this: M) { this._pause = false; lectures.push({ src: this.src, type: 'video', a: maintenant() }); return Promise.resolve(); } });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value(this: M) { this._pause = true; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get(this: M) { return this._pause !== false; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get(this: M) { return this._t ?? 0; }, set(this: M, v: number) { this._t = v; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 30; } });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get() { return 64; } });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get() { return 64; } });
  void PROTO_MEDIA; void PROTO_VIDEO;
}
function retirerNavigateur() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext', 'Audio']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[`c:${k}`];
  for (const k of ['load', 'play', 'pause', 'paused', 'currentTime', 'duration']) {
    const d = originaux[`m:${k}`] as PropertyDescriptor | undefined;
    if (d) Object.defineProperty(HTMLMediaElement.prototype, k, d); else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[k];
  }
  for (const k of ['videoWidth', 'videoHeight']) {
    const d = originaux[`v:${k}`] as PropertyDescriptor | undefined;
    if (d) Object.defineProperty(HTMLVideoElement.prototype, k, d);
  }
}

const JUMEAU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/g.mp4';
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u/rush.mp4';
const VOIX = { titre: 'https://s/titre.mp3', cartes: 'https://s/cartes.mp3', cta: 'https://s/cta.mp3' };
const LEGACY = 'https://s/legacy-voix.mp3';
const MUSIQUE = 'https://s/musique.mp3';

/** Titre 0,3 s → cartes 0,3 s → vidéo 0,5 s → CTA 0,2 s. */
const options = (sur: Partial<ComposerOptions> = {}): ComposerOptions => ({
  width: 64, height: 64, fps: 30, title: 'T',
  cards: [{ emoji: '', label: 'A', value: '1' }],
  introDuration: 0.3, cardsDuration: 0.3, videoDuration: 0.5, ctaDuration: 0.2,
  accentColor: '#7C3AED',
  musicUrl: MUSIQUE,
  ...sur,
} as ComposerOptions);
const lecturesDe = (src: string) => lectures.filter((l) => l.src === src);

beforeEach(() => {
  debutEnregistrement = performance.now();
  lectures.length = 0;
  creesAudio.length = 0;
  portes.length = 0;
  signal = {};
  installerNavigateur();
  const trace = (...a: unknown[]) => { if (process.env.DBG) process.stdout.write(`${a.map(String).join(' ').slice(0, 200)}\n`); };
  vi.spyOn(console, 'log').mockImplementation(trace);
  vi.spyOn(console, 'warn').mockImplementation(trace);
  vi.spyOn(console, 'error').mockImplementation(trace);
});
afterEach(() => {
  retirerNavigateur();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Bug 1 — une seule voix à la fois', () => {
  it('règle : voix par séquence présentes → voix globale coupée ; aucune → voix globale jouée', () => {
    expect(voixGlobaleActive({})).toBe(true);
    expect(voixGlobaleActive({ sequenceVoiceUrls: {} })).toBe(true);
    expect(voixGlobaleActive({ sequenceVoiceUrls: { titre: null, cartes: '' } })).toBe(true);
    expect(voixGlobaleActive({ sequenceVoiceUrls: { cartes: VOIX.cartes } })).toBe(false);
  });

  it('1-3. legacy + voix par séquence : la voix globale n’est jamais chargée ni jouée ; titre et cartes démarrent UNE fois', async () => {
    await composeVideo(options({ voiceUrl: LEGACY, sequenceVoiceUrls: VOIX }));
    expect(creesAudio).not.toContain(LEGACY);
    expect(lecturesDe(LEGACY)).toHaveLength(0);
    expect(lecturesDe(VOIX.titre)).toHaveLength(1);
    expect(lecturesDe(VOIX.cartes)).toHaveLength(1);
    // La voix des cartes part APRÈS celle du titre (début de SA séquence,
    // programmé à 0,30 s — journal du compositeur), jamais en même temps.
    expect(lecturesDe(VOIX.cartes)[0].a).toBeGreaterThan(lecturesDe(VOIX.titre)[0].a);
    expect(console.log).toHaveBeenCalledWith('[Composer] ✅ Seq voice', 'cartes', 'PLAYING at offset', '0.30', 's');
    expect(console.log).toHaveBeenCalledWith('[Composer] ✅ Seq voice', 'titre', 'PLAYING at offset', '0.00', 's');
  });

  it('legacy seul (ancien contenu) : la voix globale est toujours jouée', async () => {
    await composeVideo(options({ voiceUrl: LEGACY }));
    expect(creesAudio).toContain(LEGACY);
    expect(lecturesDe(LEGACY).length).toBeGreaterThan(0);
  });

  it('voix par séquence seules : chacune jouée une fois', async () => {
    await composeVideo(options({ sequenceVoiceUrls: VOIX }));
    for (const u of Object.values(VOIX)) expect(lecturesDe(u)).toHaveLength(1);
  });
});

describe('Bug 2 — la voix du jumeau atteint le mix', () => {
  const jumeau = (sur: Partial<ComposerOptions> = {}) => options({ videoUrl: JUMEAU, rushAudioRequis: true, sequenceVoiceUrls: { titre: VOIX.titre, cartes: VOIX.cartes }, ...sur });

  it('4-5. jumeau avec audio + musique : livré, voix du jumeau mesurée, musique présente', async () => {
    signal = { [`video:${JUMEAU}`]: 0.2, [`audio:${JUMEAU}`]: 0.2 };
    const r = await composeVideo(jumeau());
    expect(r.video.size).toBeGreaterThan(0);
    expect(lecturesDe(MUSIQUE).length).toBeGreaterThan(0);
    expect(lectures.some((l) => l.src === JUMEAU && l.type === 'video')).toBe(true);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('secours audio ACTIVÉ'), expect.anything(), expect.anything());
  });

  it('6-7. la voix du jumeau ne joue qu’EN séquence Vidéo : jamais à t=0, arrêtée ensuite', async () => {
    signal = { [`video:${JUMEAU}`]: 0.2, [`audio:${JUMEAU}`]: 0.2 };
    await composeVideo(jumeau());
    const jumeauLectures = lectures.filter((l) => l.src === JUMEAU);
    expect(jumeauLectures.length).toBeGreaterThan(0);
    // Titre 0,3 + cartes 0,3 : la vidéo commence à 0,6 s.
    for (const l of jumeauLectures) expect(l.a).toBeGreaterThanOrEqual(0.55);
    for (const l of jumeauLectures) expect(l.a).toBeLessThan(1.15);
  });

  it('piste de la vidéo silencieuse dans le mix (routage en échec) → le SECOURS audio prend le relais, rendu livré', async () => {
    signal = { [`audio:${JUMEAU}`]: 0.2 }; // la vidéo n'apporte rien, le fichier parle
    const r = await composeVideo(jumeau());
    expect(r.video.size).toBeGreaterThan(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('secours audio ACTIVÉ'), expect.anything(), expect.anything());
  });

  it('jumeau sans aucune voix mesurée → rendu REFUSÉ, jamais un jumeau muet livré', async () => {
    signal = {};
    await expect(composeVideo(jumeau())).rejects.toThrow(MESSAGE_JUMEAU_MUET);
  });

  it('8. rush ORDINAIRE réellement silencieux : autorisé, livré, aucun secours chargé', async () => {
    signal = {};
    const r = await composeVideo(options({ videoUrl: RUSH }));
    expect(r.video.size).toBeGreaterThan(0);
    expect(creesAudio).not.toContain(RUSH);
  });

  it('aucune voix TTS « vidéo » lancée par-dessus le jumeau', async () => {
    signal = { [`video:${JUMEAU}`]: 0.2, [`audio:${JUMEAU}`]: 0.2 };
    await composeVideo(jumeau());
    const pendantVideo = lectures.filter((l) => l.type === 'audio' && l.a >= 0.6 && l.a < 1.1 && l.src !== JUMEAU && l.src !== MUSIQUE);
    expect(pendantVideo).toEqual([]);
  });
});
