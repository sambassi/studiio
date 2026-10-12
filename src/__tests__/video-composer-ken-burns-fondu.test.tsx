/**
 * KEN BURNS PENDANT LE FONDU — la séquence Vidéo SORTANTE suit son vrai temps.
 *
 * Avant : `drawTransition` peignait la séquence sortante à `p = 1` pendant les
 * 0,8 s du fondu. Une PHOTO en Ken Burns (plan multi-sources) s'arrêtait donc
 * net sur son zoom final pendant que le CTA apparaissait.
 *
 * Règle vérifiée ici, sur le VRAI `composeVideo` dans un faux navigateur :
 *  - média SORTANT : progression = son temps local réel (le zoom continue) ;
 *  - média ENTRANT : jamais un média plus tardif en avance ;
 *  - OPACITÉ : la transition seule (le CTA monte, la photo descend).
 *
 * Chaque image est datée par la barre de progression que `drawFrame` peint
 * (`fillRect(0, h - 3, w * elapsed / total, 3)`), sans toucher au compositeur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { planDepuisListe, type MediaVideo } from '@/lib/creer/medias-video';
import { segmentA } from '@/lib/creer/multi-rush';
import { composeVideo, ajusterPlanMixte, type ComposerOptions } from '@/lib/video-composer';

const W = 64;
const H = 64;

// ── Faux navigateur (même principe que creer-multisources.test.tsx) ───────
type Evenement =
  | { k: 'image' }
  | { k: 'peint'; source: unknown; args: number[] }
  | { k: 'alpha'; v: number }
  | { k: 'barre'; w: number }
  | { k: 'texte'; v: string };
const evenements: Evenement[] = [];
let sourcesAudio: unknown[] = [];
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
  srcDemande = '';
  set src(v: string) { this.srcDemande = v; setTimeout(() => this.onload?.(), 0); }
  get src() { return this.srcDemande; }
}
class FauxAudioContext {
  state = 'running'; currentTime = 0; sampleRate = 48000;
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamDestination() { return { stream: new FauxMediaStream() }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { getFloatTimeDomainData(b: Float32Array) { b.fill(0.2); }, connect() {} }; }
  createMediaElementSource(el: unknown) { sourcesAudio.push(el); return { connect() {} }; }
}
class FauxVideo {
  crossOrigin: string | null = null;
  muted = false; playsInline = false; preload = ''; paused = true; currentTime = 0;
  duration = 30; readyState = 0; seeking = false; currentSrc = '';
  videoWidth = 0; videoHeight = 0; playbackRate = 1;
  oncanplaythrough: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  srcDemande = '';
  set src(v: string) { this.srcDemande = v; this.currentSrc = v; }
  get src() { return this.srcDemande; }
  load() {
    setTimeout(() => { this.readyState = 4; this.videoWidth = 720; this.videoHeight = 1280; this.oncanplaythrough?.(); }, 0);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
}
const originaux: Record<string, unknown> = {};
function contexte() {
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    drawImage: (source: unknown, ...args: number[]) => { evenements.push({ k: 'peint', source, args }); },
    // `drawFrame` vide la toile : début d'une image du montage.
    clearRect: (_x: number, _y: number, w: number, h: number) => { if (w === W && h === H) evenements.push({ k: 'image' }); },
    // Barre de progression : `fillRect(0, h - 3, w * elapsed / total, 3)`.
    fillRect: (x: number, y: number, w: number, h: number) => { if (x === 0 && y === H - 3 && h === 3) evenements.push({ k: 'barre', w }); },
    fillText: (t: string) => { evenements.push({ k: 'texte', v: String(t) }); },
    measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  const divers: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p as string] : p in divers ? divers[p as string] : () => {}),
    set: (_t, p, v) => {
      if (p === 'globalAlpha') evenements.push({ k: 'alpha', v: Number(v) });
      divers[p as string] = v; return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
function installer() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) originaux[k] = g[k];
  g.MediaRecorder = FauxMediaRecorder; g.MediaStream = FauxMediaStream; g.Image = FauxImage; g.AudioContext = FauxAudioContext;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) originaux[k] = proto[k];
  proto.getContext = () => contexte();
  proto.captureStream = () => new FauxMediaStream();
  proto.toBlob = (cb: (b: Blob | null) => void) => cb(new Blob(['j'], { type: 'image/jpeg' }));
  proto.toDataURL = () => 'data:image/png;base64,AAAA';
  const creer = document.createElement.bind(document);
  originaux.createElement = document.createElement;
  document.createElement = ((tag: string, opts?: ElementCreationOptions) => {
    if (tag === 'video') { const v = new FauxVideo(); fauxVideos.push(v); return v as unknown as HTMLElement; }
    return creer(tag, opts);
  }) as typeof document.createElement;
}
function retirer() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[k];
  document.createElement = originaux.createElement as typeof document.createElement;
}

/** Les images du montage, chacune datée (secondes) par sa barre de progression. */
interface ImageMontage { t: number; ev: Evenement[] }
function images(total: number): ImageMontage[] {
  const out: ImageMontage[] = [];
  for (const e of evenements) {
    if (e.k === 'image') out.push({ t: NaN, ev: [] });
    else if (out.length) {
      const im = out[out.length - 1];
      im.ev.push(e);
      // La DERNIÈRE barre de l'image est la progression (la première est le fond).
      if (e.k === 'barre') im.t = (e.w / W) * total;
    }
  }
  return out.filter((im) => Number.isFinite(im.t));
}
const srcDe = (s: unknown) => (s as FauxImage | FauxVideo)?.srcDemande;
const peintures = (im: ImageMontage) => im.ev.filter((e): e is Extract<Evenement, { k: 'peint' }> => e.k === 'peint');

describe('Ken Burns pendant le fondu vers le CTA (faux navigateur)', () => {
  beforeEach(() => {
    evenements.length = 0; sourcesAudio = []; fauxVideos = [];
    installer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { retirer(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('Photo 5 s → CTA 4 s : de 4,2 à 5,0 s la photo zoome à CHAQUE image, le CTA monte', async () => {
    const P = '/media/photo-kb.jpg';
    const { plan, duree } = planDepuisListe([{ id: 'p', source: 'stock-photo', type: 'image', url: P, duree: 5 }]);
    expect(duree).toBe(5);
    expect(plan[0].mouvement).toBe('zoomIn');
    const total = 9;
    await composeVideo({
      width: W, height: H, fps: 30, title: 'T', cards: [],
      videoUrl: plan[0].url, montage: plan,
      introDuration: 0, cardsDuration: 0, videoDuration: duree, ctaDuration: 4,
      accentColor: '#7C3AED',
    } as ComposerOptions);

    const fondu = images(total).filter((im) => im.t > 4.2 + 1e-3 && im.t < 5.0 - 1e-3);
    expect(fondu.length).toBeGreaterThan(10);
    let largeurPrec = -Infinity;
    let alphaCtaPrec = -Infinity;
    for (const im of fondu) {
      const photo = peintures(im).filter((p) => srcDe(p.source) === P);
      expect(photo.length).toBe(1);
      const [, , dw] = photo[0].args;
      // Zoom avant STRICTEMENT croissant : aucune image figée.
      expect(dw).toBeGreaterThan(largeurPrec);
      largeurPrec = dw;
      // Crossfade : la 1re opacité de l'image est `1 - t` (photo), puis `t` (CTA).
      const alphas = im.ev.filter((e): e is Extract<Evenement, { k: 'alpha' }> => e.k === 'alpha').map((e) => e.v);
      const sortant = alphas[0];
      const entrant = 1 - sortant;
      expect(alphas.some((a) => Math.abs(a - entrant) < 1e-9)).toBe(true);
      expect(entrant).toBeGreaterThan(alphaCtaPrec);
      alphaCtaPrec = entrant;
    }
    // Le zoom à la fin du fondu approche le zoom final (≈ 1,12 × 64) : continuité.
    expect(largeurPrec).toBeGreaterThan(64 * 1.11);
    expect(largeurPrec).toBeLessThanOrEqual(64 * 1.12 + 1e-6);
  }, 30000);

  it('Avatar → Rush → Photo KB → Vidéo → Photo KB → CTA : ordre, aucun média en avance, photos jamais figées', async () => {
    const A = '/media/avatar/gen-9.mp4';
    const R = '/media/rush.mp4';
    const P1 = '/media/photo-1.jpg';
    const V = '/media/library/stock-video-7.mp4';
    const P2 = '/media/photo-2.jpg';
    const liste: MediaVideo[] = [
      { id: 'a', source: 'avatar', type: 'video', url: A, duree: 1.5 },
      { id: 'r', source: 'rush', type: 'video', url: R, duree: 1 },
      { id: 'p1', source: 'stock-photo', type: 'image', url: P1, duree: 1.2 },
      { id: 'v', source: 'stock-video', type: 'video', url: V, duree: 1 },
      { id: 'p2', source: 'stock-photo', type: 'image', url: P2, duree: 1.5 },
    ];
    const { plan, duree } = planDepuisListe(liste);
    // Durées : inchangées par le compositeur (plan ajusté = plan).
    expect(plan.map((s) => [s.url, s.kind, s.debut, s.fin])).toEqual([
      [A, 'avatar', 0, 1.5], [R, 'video', 1.5, 2.5], [P1, 'image', 2.5, 3.7], [V, 'video', 3.7, 4.7], [P2, 'image', 4.7, 6.2],
    ]);
    expect(duree).toBeCloseTo(6.2, 6);
    expect(ajusterPlanMixte(plan, duree).map((s) => [s.debut, s.fin])).toEqual(plan.map((s) => [s.debut, s.fin]));
    const cta = 1.5;
    const total = duree + cta;
    await composeVideo({
      width: W, height: H, fps: 30, title: 'T', cards: [],
      videoUrl: plan[0].url, montage: plan,
      introDuration: 0, cardsDuration: 0, videoDuration: duree, ctaDuration: cta,
      accentColor: '#7C3AED',
    } as ComposerOptions);

    const ims = images(total);
    const ordre: string[] = [];
    const avatarEl = fauxVideos.find((v) => v.srcDemande === A)!;
    const urlDe = (s: unknown) => (s === avatarEl ? A : srcDe(s));
    const debutDe = new Map(plan.map((s) => [s.url, s.debut]));
    const UNE_IMAGE = 0.1; // marge d'horloge temps réel (jsdom, ±1–3 images)
    for (const im of ims) {
      for (const p of peintures(im)) {
        const u = urlDe(p.source);
        if (!u || !debutDe.has(u)) continue;
        // Aucun média ne paraît AVANT son tour.
        expect(im.t + UNE_IMAGE).toBeGreaterThanOrEqual(debutDe.get(u)!);
        if (ordre[ordre.length - 1] !== u) ordre.push(u);
      }
    }
    expect(ordre).toEqual([A, R, P1, V, P2]);

    // Chaque photo bouge à chaque image de son plan — y compris P2 pendant le
    // fondu vers le CTA (les 0,8 dernières secondes de la séquence Vidéo).
    for (const [url, mouv] of [[P1, 'dw'], [P2, 'dx']] as const) {
      const seg = plan.find((s) => s.url === url)!;
      const vues = ims
        .filter((im) => im.t > seg.debut + 0.05 && im.t < seg.fin - 0.02 && segmentA(plan, im.t)?.url === url)
        .map((im) => peintures(im).find((p) => srcDe(p.source) === url)!.args);
      expect(vues.length).toBeGreaterThan(5);
      for (let i = 1; i < vues.length; i++) {
        const [dx0, , dw0] = vues[i - 1];
        const [dx1, , dw1] = vues[i];
        if (mouv === 'dw') expect(dw1).toBeGreaterThan(dw0); // zoomIn
        else expect(dx1).toBeLessThan(dx0); // panG : glisse vers la gauche
      }
    }
    const fonduCta = ims.filter((im) => im.t > duree - 0.8 + 0.01 && im.t < duree - 0.01);
    expect(fonduCta.length).toBeGreaterThan(5);
    for (const im of fonduCta) expect(peintures(im).some((p) => srcDe(p.source) === P2)).toBe(true);

    // Voix : seul l'avatar entre dans le mix ; les plans de coupe restent muets.
    const rush = fauxVideos.find((v) => v.srcDemande === R)!;
    const stock = fauxVideos.find((v) => v.srcDemande === V)!;
    expect(sourcesAudio).toContain(avatarEl);
    expect(sourcesAudio).not.toContain(rush);
    expect(sourcesAudio).not.toContain(stock);
    expect(rush.muted && stock.muted).toBe(true);
  }, 30000);
  it('fondu ENTRANT vers un multi-rush (sans photo ni avatar) : le rush SUIVANT ne paraît jamais en avance', async () => {
    // Titre 1,2 s → Vidéo [R1 0–1 s, R2 1–5 s]. L'ancienne progression
    // `t * 0,3` atteignait 1,5 s du plan pendant le fondu : R2 sous le titre.
    const F = '/media/affiche.jpg';
    const R1 = '/media/rush-1.mp4';
    const R2 = '/media/rush-2.mp4';
    const plan = [
      { url: R1, debut: 0, fin: 1, depuis: 0, kind: 'video' as const },
      { url: R2, debut: 1, fin: 5, depuis: 0, kind: 'video' as const },
    ];
    const total = 1.2 + 5 + 0.3;
    await composeVideo({
      width: W, height: H, fps: 30, title: 'T', cards: [],
      posterUrl: F, design: { posterOnAllSequences: false },
      videoUrl: R1, montage: plan,
      introDuration: 1.2, cardsDuration: 0, videoDuration: 5, ctaDuration: 0.3,
      accentColor: '#7C3AED',
    } as ComposerOptions);
    const ims = images(total);
    const r2 = fauxVideos.filter((v) => v.srcDemande === R2);
    expect(r2.length).toBeGreaterThan(0);
    const fondu = ims.filter((im) => im.t > 0.45 && im.t < 1.19);
    expect(fondu.length).toBeGreaterThan(5);
    for (const im of fondu) {
      expect(peintures(im).some((p) => srcDe(p.source) === F)).toBe(true);
      expect(peintures(im).some((p) => srcDe(p.source) === R1)).toBe(true);
      expect(peintures(im).some((p) => r2.includes(p.source as FauxVideo))).toBe(false);
    }
    // R2 paraît bien ensuite, à son tour.
    expect(ims.some((im) => im.t > 2.3 && peintures(im).some((p) => r2.includes(p.source as FauxVideo)))).toBe(true);
  }, 30000);
  it('fondu ENTRANT vers un rush UNIQUE : le temps de la séquence part de 0, sans saut au raccord', async () => {
    // Titre 1,2 s → Vidéo (un seul rush, 5 s). Une surimpression texte entre à
    // 0,5 s de la séquence Vidéo, soit à 1,7 s du montage. L'ancienne
    // progression `t * 0,3` datait la séquence entrante jusqu'à 1,5 s PENDANT
    // le fondu (0,4–1,2 s) : le texte y apparaissait, disparaissait au raccord
    // (le temps retombait à 0), puis revenait à 1,7 s — un saut visible.
    const R = '/media/rush-unique.mp4';
    const MARQUE = 'SURIMPRESSION-0,5s';
    const total = 1.2 + 5 + 0.3;
    await composeVideo({
      width: W, height: H, fps: 30, title: 'T', cards: [],
      videoUrl: R,
      design: { overlays: [{ text: MARQUE, position: { x: 50, y: 50 }, startTime: 0.5 }] },
      introDuration: 1.2, cardsDuration: 0, videoDuration: 5, ctaDuration: 0.3,
      accentColor: '#7C3AED',
    } as unknown as ComposerOptions);
    const ims = images(total);
    const rush = fauxVideos.filter((v) => v.srcDemande === R);
    expect(rush.length).toBeGreaterThan(0);
    const visible = (im: ImageMontage) => im.ev.some((e) => e.k === 'texte' && e.v === MARQUE);
    const UNE_IMAGE = 0.1; // marge d'horloge temps réel (jsdom)

    // Pendant le fondu entrant, le rush est bien là — sur sa PREMIÈRE image
    // (le lecteur n'a jamais été avancé avant son tour)…
    const fondu = ims.filter((im) => im.t > 0.45 && im.t < 1.19);
    expect(fondu.length).toBeGreaterThan(5);
    for (const im of fondu) {
      expect(peintures(im).some((p) => rush.includes(p.source as FauxVideo))).toBe(true);
    }
    // …et le temps de la séquence ne dépasse jamais le temps réel : aucun
    // texte daté de 0,5 s n'apparaît avant 1,7 s du montage.
    for (const im of ims) {
      if (visible(im)) expect(im.t + UNE_IMAGE).toBeGreaterThanOrEqual(1.2 + 0.5);
    }
    // Continuité : une fois apparu, le texte ne disparaît plus (temps monotone).
    const premiere = ims.findIndex(visible);
    expect(premiere).toBeGreaterThan(-1);
    const avantCta = ims.filter((im, i) => i >= premiere && im.t < 1.2 + 5 - 0.8 - 0.05);
    expect(avantCta.length).toBeGreaterThan(5);
    for (const im of avantCta) expect(visible(im)).toBe(true);
  }, 30000);
});
