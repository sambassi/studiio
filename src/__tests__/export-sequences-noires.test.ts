/**
 * EXPORT — PLUS DE SÉQUENCE NOIRE (Cartes + vidéo du Jumeau).
 *
 * Constat production : aperçu correct, MP4 final avec la séquence Cartes et
 * la séquence Vidéo (jumeau) entièrement NOIRES.
 *
 * CAUSE : `drawCards` ouvre une enveloppe `ctx.save()` + `applyTextAnimation`
 * (fondu / glissement / pop), puis la branche « photo des cartes » —
 * TOUJOURS prise dans Créer — sortait par `return` SANS `ctx.restore()`.
 * L'alpha (×0 au début du fondu) fuyait donc dans les frames suivantes et s'y
 * MULTIPLIAIT : tout ce qui suivait, cartes puis vidéo, était peint à
 * opacité ~0 → canvas transparent → noir dans le MP4, jusqu'à ce qu'une
 * transition réécrive `globalAlpha` (le CTA réapparaissait). L'aperçu, en
 * DOM, n'a pas ce défaut.
 *
 * RÈGLE PRODUIT testée en plus : une vidéo nécessaire introuvable BLOQUE le
 * rendu (avant réservation), jamais remplacée en silence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

// Socle serveur doublé : ouvre une « tentative », compose, et — comme le vrai
// — réduit tout échec de composition au motif générique.
const ouvertures = vi.fn();
vi.mock('@/lib/rendus/client', () => ({
  rendreEtFacturer: async (p: { composer: () => Promise<Blob> }) => {
    ouvertures();
    try { return { ok: true, blob: await p.composer(), url: '/x.webm', jobId: 'j' }; }
    catch { return { ok: false, motif: 'composition', jobId: 'j' }; }
  },
  messagePour: () => 'La composition du montage a échoué. Rien n’a été débité.',
}));

import { composerEtFacturer } from '@/lib/rendus/composer';
import { composeVideo, drawCards, drawCTA, type ComposerOptions, type DesignOptions } from '@/lib/video-composer';
import {
  MediaIndisponibleError, MESSAGE_VIDEO_INDISPONIBLE, estMediaIndisponible,
  estMemeOrigine, exigerVideo, resoudreUrlMedia, sourcesVideoRequises, verifierMediasRequis,
} from '@/lib/rendus/medias-requis';
import type { TextAnimation } from '@/lib/creer/textAnimation';

// ── Contexte 2D À ÉTAT : pile save/restore, alpha et transformation ───────
interface Etat { globalAlpha: number; tx: number; ty: number; s: number }
interface Peint { source: unknown; alpha: number }

function contexteAEtat(journal?: Peint[]) {
  let etat: Etat = { globalAlpha: 1, tx: 0, ty: 0, s: 1 };
  const pile: Etat[] = [];
  const peints: Peint[] = [];
  const divers: Record<string, unknown> = { filter: 'none', font: '10px sans-serif' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    save: () => { pile.push({ ...etat }); },
    restore: () => { const e = pile.pop(); if (e) etat = e; },
    translate: (x: number, y: number) => { etat.tx += x * etat.s; etat.ty += y * etat.s; },
    scale: (k: number) => { etat.s *= k; },
    setTransform: () => { etat.tx = 0; etat.ty = 0; etat.s = 1; },
    resetTransform: () => { etat.tx = 0; etat.ty = 0; etat.s = 1; },
    getTransform: () => ({ a: etat.s, b: 0, c: 0, d: etat.s, e: etat.tx, f: etat.ty }),
    drawImage: (source: unknown) => {
      peints.push({ source, alpha: etat.globalAlpha });
      journal?.push({ source, alpha: etat.globalAlpha });
    },
    measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    isPointInPath: () => false,
  };
  const noop = () => {};
  const ctx = new Proxy(base, {
    get: (t, p) => {
      if (p === 'globalAlpha') return etat.globalAlpha;
      if (p in t) return (t as never)[p];
      return p in divers ? divers[p as string] : noop;
    },
    set: (_t, p, v) => {
      if (p === 'globalAlpha') etat.globalAlpha = v; else divers[p as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, peints, profondeur: () => pile.length, etat: () => etat };
}

/** Une « photo des cartes », comme celle que Créer capture dans l'aperçu. */
function photoCartes() {
  return { width: 900, height: 600, naturalWidth: 900, naturalHeight: 600, src: 'data:image/png;base64,AAAA' } as unknown as HTMLImageElement;
}

const ANIMATIONS: TextAnimation[] = ['none', 'fade', 'slide', 'pop', 'typewriter'];

describe('drawCards — la photo des cartes referme son enveloppe d’animation', () => {
  it.each(ANIMATIONS.flatMap((a) => [[a, true], [a, false]] as const))(
    'animation %s (rect=%s) : save/restore équilibrés, alpha et transformation intacts',
    (animation, avecRect) => {
      const { ctx, profondeur, etat } = contexteAEtat();
      const design = {
        textAnimation: animation,
        cardsSnapshot: photoCartes(),
        ...(avecRect ? { cardsSnapshotRect: { x: 10, y: 30, width: 80, height: 40 } } : {}),
      } as DesignOptions;
      // Début de séquence : le fondu vaut 0 — c'est là que la fuite noircissait tout.
      for (const p of [0, 0.02, 0.05, 0.1, 0.5, 1]) {
        drawCards(ctx, 1080, 1920, [{ emoji: '', label: 'A', value: '1' }], null, '#7C3AED', p, design);
        expect(profondeur()).toBe(0);
        expect(etat().globalAlpha).toBe(1);
        expect(etat()).toMatchObject({ tx: 0, ty: 0, s: 1 });
      }
    },
  );

  it('les frames APRÈS des cartes animées restent visibles (régression du noir)', () => {
    const { ctx, peints } = contexteAEtat();
    const design = { textAnimation: 'fade', cardsSnapshot: photoCartes(), cardsSnapshotRect: { x: 0, y: 0, width: 100, height: 50 } } as DesignOptions;
    for (let f = 0; f < 30; f++) drawCards(ctx, 1080, 1920, [], null, '#7C3AED', f / 30, design);
    const rush = { videoWidth: 720, videoHeight: 1280 };
    ctx.drawImage(rush as unknown as CanvasImageSource, 0, 0);
    // Avant le correctif : alpha = produit des alphas de fondu ≈ 0 → noir.
    expect(peints.at(-1)).toEqual({ source: rush, alpha: 1 });
  });
});

describe('drawCTA — même enveloppe, même équilibre (les N occurrences)', () => {
  it.each(ANIMATIONS)('animation %s : équilibré', (animation) => {
    const { ctx, profondeur, etat } = contexteAEtat();
    for (const p of [0, 0.05, 1]) {
      drawCTA(ctx, 1080, 1920, '#7C3AED', 'CTA', 'sous', undefined, 'FILIGRANE', null, p, { textAnimation: animation } as DesignOptions);
      expect(profondeur()).toBe(0);
      expect(etat().globalAlpha).toBe(1);
    }
  });
});

// ── Médias requis : URL, sonde, blocage AVANT réservation ─────────────────
const ORIGINE = 'https://studiio.pro';
const JUMEAU = '/storage/v1/object/public/media/user-1/avatar/gen-1.mp4';

describe('URL des médias', () => {
  it('relative → absolue same-origin ; blob/data/absolue inchangées', () => {
    expect(resoudreUrlMedia(JUMEAU, ORIGINE)).toBe(`${ORIGINE}${JUMEAU}`);
    expect(resoudreUrlMedia(`${ORIGINE}${JUMEAU}`, ORIGINE)).toBe(`${ORIGINE}${JUMEAU}`);
    expect(resoudreUrlMedia('blob:https://studiio.pro/x', ORIGINE)).toBe('blob:https://studiio.pro/x');
    expect(resoudreUrlMedia('data:video/mp4;base64,AA', ORIGINE)).toBe('data:video/mp4;base64,AA');
  });
  it('même origine : relative et absolue studiio.pro oui ; autre hôte et // non', () => {
    expect(estMemeOrigine(JUMEAU, ORIGINE)).toBe(true);
    expect(estMemeOrigine(`${ORIGINE}${JUMEAU}`, ORIGINE)).toBe(true);
    expect(estMemeOrigine(`https://cdn.example.com${JUMEAU}`, ORIGINE)).toBe(false);
    expect(estMemeOrigine(`//cdn.example.com${JUMEAU}`, ORIGINE)).toBe(false);
  });
  it('sources requises : aucune si la séquence Vidéo est masquée', () => {
    expect(sourcesVideoRequises({ videoUrl: JUMEAU, videoDuration: 0 })).toEqual([]);
    expect(sourcesVideoRequises({ videoUrl: JUMEAU, videoDuration: 8 })).toEqual([JUMEAU]);
  });
});

function reponse(status: number, longueur: string | null = '1000') {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k: string) => (k === 'content-length' ? longueur : null) } } as unknown as Response;
}

describe('verifierMediasRequis — avant toute réservation', () => {
  it('vidéo du jumeau accessible : sonde HEAD same-origin sur l’URL ABSOLUE, pas de blocage', async () => {
    const f = vi.fn(async () => reponse(200));
    await verifierMediasRequis({ videoUrl: JUMEAU, videoDuration: 8 }, { fetch: f as never, origine: ORIGINE });
    expect(f).toHaveBeenCalledWith(`${ORIGINE}${JUMEAU}`, expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }));
  });

  it.each([404, 403, 500])('vidéo du jumeau en HTTP %s : MediaIndisponibleError, message clair sans fournisseur', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => reponse(status));
    const p = verifierMediasRequis({ videoUrl: JUMEAU, videoDuration: 8 }, { fetch: f as never, origine: ORIGINE });
    await expect(p).rejects.toBeInstanceOf(MediaIndisponibleError);
    await expect(p).rejects.toThrow(MESSAGE_VIDEO_INDISPONIBLE);
    expect(MESSAGE_VIDEO_INDISPONIBLE).not.toMatch(/heygen|d-id|elevenlabs|minio|supabase/i);
    expect(MESSAGE_VIDEO_INDISPONIBLE).toMatch(/Rien n’a été débité/);
  });

  it('fichier vide : bloqué', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => reponse(200, '0'));
    await expect(verifierMediasRequis({ videoUrl: JUMEAU, videoDuration: 8 }, { fetch: f as never, origine: ORIGINE }))
      .rejects.toBeInstanceOf(MediaIndisponibleError);
  });

  it('multi-rush : un rush absent parmi d’autres n’arrête pas (le montage le saute, comme avant)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async (u: string) => reponse(u.endsWith('b.mp4') ? 404 : 200));
    await verifierMediasRequis(
      { videoUrl: '/storage/v1/object/public/media/u/a.mp4', videoDuration: 8, rushs: [{ url: '/storage/v1/object/public/media/u/a.mp4' }, { url: '/storage/v1/object/public/media/u/b.mp4' }] },
      { fetch: f as never, origine: ORIGINE },
    );
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('erreur réseau, autre origine, blob: — aucune preuve d’absence, pas de blocage', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await verifierMediasRequis({ videoUrl: JUMEAU, videoDuration: 8 }, { fetch: f as never, origine: ORIGINE });
    const g = vi.fn(async () => reponse(404));
    await verifierMediasRequis({ videoUrl: 'https://cdn.example.com/v.mp4', videoDuration: 8 }, { fetch: g as never, origine: ORIGINE });
    await verifierMediasRequis({ videoUrl: 'blob:https://studiio.pro/1', videoDuration: 8 }, { fetch: g as never, origine: ORIGINE });
    expect(g).not.toHaveBeenCalled();
  });
});

// ── Bout en bout : le VRAI composeVideo sur un faux navigateur ────────────
let videoCharge: 'ok' | 'erreur' | 'sans-image' = 'ok';
let enregistreurs = 0;
const peintsGlobaux: Peint[] = [];
let fauxVideos: FauxVideo[] = [];

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
  constructor() { enregistreurs++; }
  start() { this.state = 'recording'; }
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
class FauxAudioContext {
  state = 'running'; currentTime = 0; sampleRate = 48000;
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamDestination() { return { stream: new FauxMediaStream() }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} }; }
  createMediaElementSource() { return { connect() {} }; }
}
class FauxVideo {
  crossOrigin: string | null = null;
  muted = false; playsInline = false; preload = ''; paused = true; currentTime = 0;
  duration = 10; readyState = 0; seeking = false; currentSrc = '';
  videoWidth = 0; videoHeight = 0;
  oncanplaythrough: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  srcDemande = '';
  set src(v: string) { this.srcDemande = v; this.currentSrc = v; }
  get src() { return this.srcDemande; }
  load() {
    setTimeout(() => {
      if (videoCharge === 'erreur') { this.onerror?.(); return; }
      this.readyState = 4;
      if (videoCharge === 'ok') { this.videoWidth = 720; this.videoHeight = 1280; }
      this.oncanplaythrough?.();
    }, 0);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
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
  proto.getContext = function getContext() {
    return contexteAEtat(peintsGlobaux).ctx;
  };
  proto.captureStream = function captureStream() { return new FauxMediaStream(); };
  proto.toBlob = function toBlob(cb: (b: Blob | null) => void) { cb(new Blob(['j'], { type: 'image/jpeg' })); };
  proto.toDataURL = function toDataURL() { return 'data:image/png;base64,AAAA'; };
  const creer = document.createElement.bind(document);
  originaux.createElement = document.createElement;
  document.createElement = ((tag: string, opts?: ElementCreationOptions) => {
    if (tag === 'video') { const v = new FauxVideo(); fauxVideos.push(v); return v as unknown as HTMLElement; }
    return creer(tag, opts);
  }) as typeof document.createElement;
}
function retirerNavigateur() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[k];
  document.createElement = originaux.createElement as typeof document.createElement;
}

const options = (sur: Partial<ComposerOptions> = {}): ComposerOptions => ({
  width: 64, height: 64, fps: 30,
  title: 'T',
  cards: [{ emoji: '', label: 'Carte', value: '42' }],
  videoUrl: JUMEAU,
  introDuration: 1, cardsDuration: 1.2, videoDuration: 1.2, ctaDuration: 1,
  accentColor: '#7C3AED',
  ...sur,
} as ComposerOptions);

beforeEach(() => {
  videoCharge = 'ok';
  enregistreurs = 0;
  peintsGlobaux.length = 0;
  fauxVideos = [];
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

describe('composeVideo — aperçu OK ⇒ rendu final OK (Cartes + Jumeau)', () => {
  it('cartes en photo + fondu, puis vidéo du jumeau : ni les cartes ni la vidéo ne sont peintes à opacité nulle', async () => {
    const photo = photoCartes();
    const r = await composeVideo(options({
      design: { textAnimation: 'fade', cardsSnapshot: photo, cardsSnapshotRect: { x: 5, y: 20, width: 90, height: 50 } } as DesignOptions,
    }));
    expect(r.video.size).toBeGreaterThan(0);
    // URL relative du jumeau : chargée telle quelle, SANS crossOrigin (same-origin).
    const jumeau = fauxVideos[0];
    expect(jumeau.srcDemande).toBe(JUMEAU);
    expect(jumeau.crossOrigin).toBeNull();
    const alphaMax = (source: unknown) => Math.max(0, ...peintsGlobaux.filter((p) => p.source === source).map((p) => p.alpha));
    // Cartes pleinement visibles à la fin de leur fondu…
    expect(alphaMax(photo)).toBeGreaterThan(0.99);
    // …et la vidéo du jumeau peinte à pleine opacité hors transition.
    expect(peintsGlobaux.some((p) => p.source === jumeau)).toBe(true);
    expect(alphaMax(jumeau)).toBeGreaterThan(0.99);
  }, 20000);

  it.each(['erreur', 'sans-image'] as const)('vidéo exigée (%s) : arrêt explicite AVANT tout enregistrement', async (cas) => {
    videoCharge = cas;
    const p = composeVideo(exigerVideo(options()));
    await expect(p).rejects.toBeInstanceOf(MediaIndisponibleError);
    await p.catch((e) => expect(estMediaIndisponible(e)).toBe(true));
    expect(enregistreurs).toBe(0);
    expect(document.body.querySelectorAll('canvas').length).toBe(0);
  });

  it('options non marquées par `exigerVideo` (autres appelants) : comportement historique conservé', async () => {
    videoCharge = 'erreur';
    const r = await composeVideo(options({ cards: [], cardsDuration: 0, introDuration: 0.3, videoDuration: 0.4, ctaDuration: 0.3 }));
    expect(r.video.size).toBeGreaterThan(0);
  }, 20000);
});

describe('composerEtFacturer — le message clair remonte (pas le générique)', () => {
  it('vidéo du jumeau illisible : MediaIndisponibleError, message sans fournisseur', async () => {
    videoCharge = 'erreur';
    const p = composerEtFacturer('calendrier', 'reel', exigerVideo(options()));
    await expect(p).rejects.toBeInstanceOf(MediaIndisponibleError);
    await expect(p).rejects.toThrow(MESSAGE_VIDEO_INDISPONIBLE);
    expect(enregistreurs).toBe(0);
  });
});
