/**
 * « Régénérer » (Calendrier) refait le montage depuis le PLAN MULTI-SOURCES
 * enregistré (`metadata.rushSegments`), pas depuis `rushUrls[0]`.
 *
 * Avant : `optionsRenduDepuisMetadata` prenait `videoUrl: rushUrls[0]` et une
 * durée Vidéo nulle sans rush. Or l'Autopilote n'écrit sous `rushUrls` que
 * les vidéos stock/perso — `[]` pour photos seules ou avatar + photos — et
 * une metadata peut ne pas porter `rushUrls` du tout. Le compositeur
 * (`estMontageMixte(videoUrl, …)` → `null` sans `videoUrl`) jetait alors le
 * plan : les photos disparaissaient du montage régénéré.
 *
 * Prouvé ici, sur les VRAIES `preparerOptionsRendu` + `composeVideo` (faux
 * navigateur, aucun fournisseur) :
 *   A photos seules (Photo A 4 s → Photo B 5 s → CTA) : plan, ordre, durées,
 *     recadrage, CTA, aucun rush exigé, aucune image sans photo ;
 *   B photo + vidéo suggérée ; C avatar + photos ;
 *   D ancien post sans plan : options IDENTIQUES à 83d9203 (instantané) ;
 *   E plan complet : PLAN_ENREGISTRÉ === PLAN_RÉGÉNÉRÉ ;
 *   F metadata sans `rushUrls` : aucun plantage, plan honoré.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { planDepuisListe, type MediaVideo } from '@/lib/creer/medias-video';
import { rushSegmentsDepuisMetadata, segmentA, type RushSegment } from '@/lib/creer/multi-rush';
import { composeVideo, ajusterPlanMixte } from '@/lib/video-composer';
import {
  preparerOptionsRendu, optionsRenduDepuisMetadata, sourceVideoDuPost,
  type DepsPreparation, type PostARendre,
} from '@/lib/rendus/options-depuis-metadata';

const W = 64;
const H = 64;

// ── Faux navigateur (même principe que video-composer-ken-burns-fondu) ────
type Evenement =
  | { k: 'image' }
  | { k: 'peint'; source: unknown; args: number[] }
  | { k: 'alpha'; v: number }
  | { k: 'barre'; w: number };
const evenements: Evenement[] = [];
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
  createMediaElementSource() { return { connect() {} }; }
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
    clearRect: (_x: number, _y: number, w: number, h: number) => { if (w === W && h === H) evenements.push({ k: 'image' }); },
    fillRect: (x: number, y: number, w: number, h: number) => { if (x === 0 && y === H - 3 && h === 3) evenements.push({ k: 'barre', w }); },
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
function retirerFaux() {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MediaRecorder', 'MediaStream', 'Image', 'AudioContext']) g[k] = originaux[k];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const k of ['getContext', 'captureStream', 'toBlob', 'toDataURL']) proto[k] = originaux[k];
  document.createElement = originaux.createElement as typeof document.createElement;
}
interface ImageMontage { t: number; ev: Evenement[] }
function images(total: number): ImageMontage[] {
  const out: ImageMontage[] = [];
  for (const e of evenements) {
    if (e.k === 'image') out.push({ t: NaN, ev: [] });
    else if (out.length) {
      const im = out[out.length - 1];
      im.ev.push(e);
      if (e.k === 'barre') im.t = (e.w / W) * total;
    }
  }
  return out.filter((im) => Number.isFinite(im.t));
}
const srcDe = (s: unknown) => (s as FauxImage | FauxVideo)?.srcDemande;
const peintures = (im: ImageMontage) => im.ev.filter((e): e is Extract<Evenement, { k: 'peint' }> => e.k === 'peint');

// ── Posts tels que Créer / l'Autopilote les enregistrent ──────────────────

/** `rushUrls` écrit par Créer : les vidéos (avatar compris), sinon la 1re photo. */
const rushUrlsCreer = (plan: RushSegment[]) => {
  const v = plan.filter((x) => x.kind !== 'image');
  return Array.from(new Set((v.length ? v : plan.slice(0, 1)).map((x) => x.url)));
};
/** `rushUrls` écrit par l'Autopilote : les fichiers VIDÉO seuls (ni avatar, ni photo). */
const rushUrlsAutopilote = (plan: RushSegment[]) =>
  Array.from(new Set(plan.filter((x) => x.kind !== 'image' && x.kind !== 'avatar').map((x) => x.url)));

const AFFICHE = '/media/affiche.jpg';
const CROP_A = { scale: 1.4, offsetX: 0.12, offsetY: -0.05 };
const CREDITS = [{ url: '/media/photo-b.jpg', provider: 'unsplash', auteur: 'Jane', sourceUrl: 'https://unsplash.com/photos/x', licence: 'Licence Unsplash' }];

function postDepuisPlan(
  plan: RushSegment[], duree: number,
  opts: { rushUrls?: string[] | null; crops?: Record<string, typeof CROP_A>; videoSize?: { w: number; h: number }; intro?: number; cta?: number } = {},
): PostARendre {
  const intro = opts.intro ?? 2; // « Régénérer » borne : < 2 s = défaut
  const cta = opts.cta ?? 2;
  const meta: Record<string, unknown> = {
    type: 'infographic',
    posterUrl: AFFICHE,
    cards: [],
    sequences: { intro, cards: 0, video: duree, cta, total: intro + duree + cta, order: ['intro', 'video', 'cta'] },
    branding: { ctaText: 'ESSAIE MAINTENANT', ctaSubText: 'LIEN EN BIO', accentColor: '#7C3AED' },
    design: {},
    rushSegments: JSON.parse(JSON.stringify(plan)),
    stockCredits: CREDITS,
    videoSize: opts.videoSize ?? { w: 1080, h: 1920 },
  };
  if (opts.rushUrls !== null) meta.rushUrls = opts.rushUrls ?? rushUrlsCreer(plan);
  if (opts.crops) meta.rushTransforms = opts.crops;
  return { title: 'Plan multi-sources', format: 'reel', metadata: meta };
}

const deps: DepsPreparation = {
  preRenderCardIcons: async (c) => c,
  chargerLutPourRendu: async () => null,
  rasteriserElements: async () => undefined,
  chargerImage: async () => null,
};

/** Forme comparable d'un plan (absences = défauts du compositeur). */
const formePlan = (p: ReadonlyArray<RushSegment>) => p.map((s) => ({
  url: s.url, kind: s.kind ?? 'video', debut: s.debut, fin: s.fin,
  depuis: s.depuis ?? 0, jusqua: s.jusqua ?? null, mouvement: s.mouvement ?? null,
}));

const PA = '/media/photo-a.jpg';
const PB = '/media/photo-b.jpg';
const listeA: MediaVideo[] = [
  { id: 'a', source: 'stock-photo', type: 'image', url: PA, duree: 3, dureeChoisie: 4 },
  { id: 'b', source: 'stock-photo', type: 'image', url: PB, duree: 3, dureeChoisie: 5 },
];

describe('Régénérer depuis le plan multi-sources enregistré — options', () => {
  it('A photos seules : plan, ordre, durées, recadrage, CTA, sans rush (Créer ET Autopilote)', async () => {
    const { plan, duree } = planDepuisListe(listeA);
    expect(plan.map((s) => [s.url, s.kind, s.debut, s.fin])).toEqual([[PA, 'image', 0, 4], [PB, 'image', 4, 9]]);
    for (const rushUrls of [rushUrlsCreer(plan), rushUrlsAutopilote(plan)]) {
      const post = postDepuisPlan(plan, duree, { rushUrls, crops: { [PA]: CROP_A } });
      const o = await preparerOptionsRendu(post, 'regenerer', undefined, deps);
      expect(o.montage, `rushUrls=${JSON.stringify(rushUrls)}`).toBeTruthy();
      expect(formePlan(o.montage!)).toEqual(formePlan(plan));
      // Une source « Vidéo » existe sans aucun rush : la 1re entrée du plan.
      expect(o.videoUrl).toBe(PA);
      expect(o.videoDuration).toBe(9);
      expect([o.introDuration, o.cardsDuration, o.ctaDuration]).toEqual([2, 0, 2]);
      expect(o.rushTransforms).toEqual({ [PA]: CROP_A });
      expect(o.sequenceOrder).toEqual(['intro', 'video', 'cta']);
      expect([o.ctaText, o.ctaSubText]).toEqual(['ESSAIE MAINTENANT', 'LIEN EN BIO']);
      expect(o.rushAudioRequis).toBeUndefined();
    }
  });

  it('B photo + vidéo suggérée (raccourcie) : ordre, extrait depuis/jusqua, source vidéo = la vidéo', async () => {
    const V = '/media/library/stock-video-3.mp4';
    const { plan, duree } = planDepuisListe([
      { id: 'p', source: 'stock-photo', type: 'image', url: PA, duree: 3, dureeChoisie: 4 },
      { id: 'v', source: 'stock-video', type: 'video', url: V, duree: 10, dureeChoisie: 3 },
    ]);
    expect(plan[1]).toMatchObject({ url: V, kind: 'video', depuis: 0, jusqua: 3, debut: 4, fin: 7 });
    const o = await preparerOptionsRendu(postDepuisPlan(plan, duree, { rushUrls: rushUrlsAutopilote(plan) }), 'regenerer', undefined, deps);
    expect(formePlan(o.montage!)).toEqual(formePlan(plan));
    expect(o.videoUrl).toBe(V);
    expect(o.videoDuration).toBe(7);
  });

  it('C avatar + photos : vidéo de l’avatar, lip-sync (depuis = debut), voix exigée', async () => {
    const A = '/media/avatar/gen-4.mp4';
    const { plan, duree } = planDepuisListe([
      { id: 'av', source: 'avatar', type: 'video', url: A, duree: 3 },
      { id: 'p', source: 'stock-photo', type: 'image', url: PA, duree: 3, dureeChoisie: 2 },
      { id: 'q', source: 'stock-photo', type: 'image', url: PB, duree: 3, dureeChoisie: 2 },
    ], { dureeParole: 7 });
    expect(plan.some((s) => s.kind === 'avatar')).toBe(true);
    // Autopilote : `rushUrls` = [] (ni avatar ni photo) — l'ancien chemin perdait tout.
    const o = await preparerOptionsRendu(postDepuisPlan(plan, duree, { rushUrls: [] }), 'regenerer', undefined, deps);
    expect(formePlan(o.montage!)).toEqual(formePlan(plan));
    expect(o.videoUrl).toBe(plan[0].url);
    expect(o.videoDuration).toBe(duree);
    expect(o.rushAudioRequis).toBe(true);
    for (const s of ajusterPlanMixte(o.montage!, o.videoDuration!)) {
      if (s.kind === 'avatar') expect(s.depuis).toBe(s.debut);
    }
  });

  it('D ancien post sans plan multi-sources : options IDENTIQUES à 83d9203, chemin par chemin', async () => {
    const ancien: PostARendre = {
      title: 'Ancien', format: 'reel',
      metadata: {
        posterUrl: 'https://cdn/p.jpg', rushUrls: ['https://cdn/r1.mp4', 'https://cdn/banque-2.mp4'],
        cards: [{ emoji: 'Heart', label: 'a', value: '1', color: '#fff' }],
        sequences: { intro: 5, cards: 6, video: 1, cta: 5 },
        branding: { ctaText: 'GO' }, design: {}, rushTransform: { scale: 1.2, offsetX: 0, offsetY: 0 },
      },
    };
    const sansRush: PostARendre = { title: 'Sans rush', format: 'tv', metadata: { posterUrl: 'https://cdn/p.jpg', sequences: { intro: 3, cta: 4 } } };
    // Multi-rush simple (sans photo ni avatar) : pas un plan mixte.
    const multi: PostARendre = {
      title: 'Multi', format: 'reel',
      metadata: { rushUrls: ['/r1.mp4', '/r2.mp4'], rushSegments: [{ url: '/r1.mp4', debut: 0, fin: 3 }, { url: '/r2.mp4', debut: 3, fin: 8 }], sequences: { video: 8 } },
    };
    const vus: Record<string, unknown> = {};
    for (const [nom, post] of Object.entries({ ancien, sansRush, multi })) {
      for (const chemin of ['regenerer', 'planifier', 'publier', 'exporter'] as const) {
        const o = optionsRenduDepuisMetadata(post, chemin, { cards: [] });
        vus[`${nom}/${chemin}`] = { videoUrl: o.videoUrl, videoDuration: o.videoDuration, montage: o.montage ?? null, rushs: o.rushs ?? null, rushTransforms: o.rushTransforms ?? null, rushAudioRequis: o.rushAudioRequis ?? null };
      }
      expect(sourceVideoDuPost(post.metadata).planMixte).toBeNull();
    }
    // Instantané produit par le module de 83d9203 (origin/main), inchangé ici.
    expect(vus).toMatchInlineSnapshot(`
      {
        "ancien/exporter": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": {
            "https://cdn/r1.mp4": {
              "offsetX": 0,
              "offsetY": 0,
              "scale": 1.2,
            },
          },
          "rushs": null,
          "videoDuration": 1,
          "videoUrl": "https://cdn/r1.mp4",
        },
        "ancien/planifier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": {
            "https://cdn/r1.mp4": {
              "offsetX": 0,
              "offsetY": 0,
              "scale": 1.2,
            },
          },
          "rushs": null,
          "videoDuration": 1,
          "videoUrl": "https://cdn/r1.mp4",
        },
        "ancien/publier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": {
            "https://cdn/r1.mp4": {
              "offsetX": 0,
              "offsetY": 0,
              "scale": 1.2,
            },
          },
          "rushs": null,
          "videoDuration": 1,
          "videoUrl": "https://cdn/r1.mp4",
        },
        "ancien/regenerer": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": {
            "https://cdn/r1.mp4": {
              "offsetX": 0,
              "offsetY": 0,
              "scale": 1.2,
            },
          },
          "rushs": null,
          "videoDuration": 12,
          "videoUrl": "https://cdn/r1.mp4",
        },
        "multi/exporter": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": [
            {
              "secondes": 3,
              "url": "/r1.mp4",
            },
            {
              "secondes": 5,
              "url": "/r2.mp4",
            },
          ],
          "videoDuration": 8,
          "videoUrl": "/r1.mp4",
        },
        "multi/planifier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": [
            {
              "secondes": 3,
              "url": "/r1.mp4",
            },
            {
              "secondes": 5,
              "url": "/r2.mp4",
            },
          ],
          "videoDuration": 8,
          "videoUrl": "/r1.mp4",
        },
        "multi/publier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": [
            {
              "secondes": 3,
              "url": "/r1.mp4",
            },
            {
              "secondes": 5,
              "url": "/r2.mp4",
            },
          ],
          "videoDuration": 8,
          "videoUrl": "/r1.mp4",
        },
        "multi/regenerer": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": [
            {
              "secondes": 3,
              "url": "/r1.mp4",
            },
            {
              "secondes": 5,
              "url": "/r2.mp4",
            },
          ],
          "videoDuration": 8,
          "videoUrl": "/r1.mp4",
        },
        "sansRush/exporter": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": null,
          "videoDuration": 12,
          "videoUrl": null,
        },
        "sansRush/planifier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": null,
          "videoDuration": 12,
          "videoUrl": null,
        },
        "sansRush/publier": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": null,
          "videoDuration": 12,
          "videoUrl": null,
        },
        "sansRush/regenerer": {
          "montage": null,
          "rushAudioRequis": null,
          "rushTransforms": null,
          "rushs": null,
          "videoDuration": 0,
          "videoUrl": null,
        },
      }
    `);
  });

  it('F metadata sans `rushUrls` : aucun plantage, le plan est honoré', async () => {
    const { plan, duree } = planDepuisListe(listeA);
    const post = postDepuisPlan(plan, duree, { rushUrls: null });
    expect('rushUrls' in post.metadata).toBe(false);
    for (const chemin of ['regenerer', 'planifier', 'publier', 'exporter'] as const) {
      const o = await preparerOptionsRendu(post, chemin, undefined, deps);
      expect(o.videoUrl).toBe(PA);
      expect(formePlan(o.montage!)).toEqual(formePlan(plan));
      expect(o.videoDuration).toBe(9);
    }
    // Metadata vide ou absente : rien ne casse non plus.
    expect(() => optionsRenduDepuisMetadata({ title: 'x', metadata: { rushSegments: 'n/a' } }, 'regenerer', { cards: [] })).not.toThrow();
    expect(() => optionsRenduDepuisMetadata({ title: 'x' }, 'regenerer', { cards: [] })).not.toThrow();
  });

  it('formats 9:16, 16:9 et 1:1 : dimensions du post enregistré', async () => {
    const { plan, duree } = planDepuisListe(listeA);
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
      const o = await preparerOptionsRendu(postDepuisPlan(plan, duree, { videoSize: { w, h } }), 'regenerer', undefined, deps);
      expect([o.width, o.height]).toEqual([w, h]);
    }
  });
});

describe('Régénérer depuis le plan enregistré — vrai compositeur (faux navigateur)', () => {
  beforeEach(() => {
    evenements.length = 0; fauxVideos = [];
    installer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { retirerFaux(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  /** Rend le post RÉGÉNÉRÉ ; rend les images datées et les options. */
  async function regenerer(post: PostARendre) {
    const o = await preparerOptionsRendu(post, 'regenerer', undefined, deps);
    await composeVideo({ ...o, width: W, height: H });
    const total = (o.introDuration ?? 0) + (o.cardsDuration ?? 0) + (o.videoDuration ?? 0) + (o.ctaDuration ?? 0);
    return { o, ims: images(total) };
  }

  it('A photos seules, rushUrls = [] (Autopilote) : A puis B à leurs durées, aucune image vide', async () => {
    const { plan, duree } = planDepuisListe(listeA);
    const { o, ims } = await regenerer(postDepuisPlan(plan, duree, { rushUrls: [], crops: { [PA]: CROP_A } }));
    const debutVideo = o.introDuration!;
    const MARGE = 0.1; // horloge temps réel : ±1–3 images
    const dansVideo = ims.filter((im) => im.t > debutVideo + MARGE && im.t < debutVideo + duree - 0.8 - MARGE);
    expect(dansVideo.length).toBeGreaterThan(30);
    for (const im of dansVideo) {
      const attendu = segmentA(plan, im.t - debutVideo)!.url;
      const urls = peintures(im).map((p) => srcDe(p.source));
      // Jamais une image sans la photo du plan (pas de plan noir).
      expect(urls).toContain(attendu);
      expect(urls).not.toContain(attendu === PA ? PB : PA);
    }
    // Ordre d'apparition et durées (±0,1 s).
    const premiere = (u: string) => ims.find((im) => peintures(im).some((p) => srcDe(p.source) === u))!.t;
    expect(premiere(PA)).toBeLessThan(premiere(PB));
    expect(Math.abs(premiere(PB) - (debutVideo + 4))).toBeLessThan(0.9); // le fondu A→B commence 0,8 s avant
    // Recadrage : A plus grand que B au même avancement (zoom × 1,4).
    const largeur = (u: string, t: number) => peintures(ims.find((im) => Math.abs(im.t - t) < 0.06 && peintures(im).some((p) => srcDe(p.source) === u))!)
      .find((p) => srcDe(p.source) === u)!.args[2];
    expect(largeur(PA, debutVideo + 0.5)).toBeGreaterThan(largeur(PB, debutVideo + 4 + 0.5 * (5 / 4)) * 1.2);
    // Aucune vidéo chargée : aucun rush exigé.
    expect(fauxVideos.length).toBe(0);
  }, 40000);

  it('E Avatar → Rush → Photo → Vidéo suggérée → Photo → CTA : PLAN_ENREGISTRÉ === PLAN_RÉGÉNÉRÉ, rendu dans l’ordre', async () => {
    const A = '/media/avatar/gen-9.mp4';
    const R = '/media/rush.mp4';
    const P1 = '/media/photo-1.jpg';
    const V = '/media/library/stock-video-7.mp4';
    const P2 = '/media/photo-2.jpg';
    const { plan, duree } = planDepuisListe([
      { id: 'a', source: 'avatar', type: 'video', url: A, duree: 1.5 },
      { id: 'r', source: 'rush', type: 'video', url: R, duree: 4, dureeChoisie: 1 },
      { id: 'p1', source: 'stock-photo', type: 'image', url: P1, duree: 3, dureeChoisie: 1 },
      { id: 'v', source: 'stock-video', type: 'video', url: V, duree: 1 },
      { id: 'p2', source: 'stock-photo', type: 'image', url: P2, duree: 3, dureeChoisie: 2 },
    ]);
    const crops = { [R]: { scale: 1.2, offsetX: 0.1, offsetY: 0 }, [P2]: { scale: 1.5, offsetX: -0.1, offsetY: 0.05 } };
    const post = postDepuisPlan(plan, duree, { rushUrls: rushUrlsAutopilote(plan), crops, intro: 0, cta: 2 });
    // Aller-retour metadata : le plan RELU est celui enregistré.
    const PLAN_SAVED = formePlan(plan);
    const PLAN_REGENERATED = formePlan(rushSegmentsDepuisMetadata(post.metadata.rushSegments)!);
    expect(PLAN_REGENERATED).toEqual(PLAN_SAVED);
    const { o, ims } = await regenerer(post);
    expect(formePlan(o.montage!)).toEqual(PLAN_SAVED);
    expect(o.rushTransforms).toEqual(crops);
    expect(o.videoDuration).toBeCloseTo(duree, 6);
    const avatarEl = fauxVideos.find((v) => v.srcDemande === A)!;
    const urlDe = (s: unknown) => (s === avatarEl ? A : srcDe(s));
    const debutDe = new Map(plan.map((s) => [s.url, s.debut]));
    const ordre: string[] = [];
    for (const im of ims) {
      for (const p of peintures(im)) {
        const u = urlDe(p.source);
        if (!u || !debutDe.has(u)) continue;
        expect(im.t + 0.1).toBeGreaterThanOrEqual(debutDe.get(u)!);
        if (ordre[ordre.length - 1] !== u) ordre.push(u);
      }
    }
    expect(ordre).toEqual([A, R, P1, V, P2]);
  }, 40000);
});
