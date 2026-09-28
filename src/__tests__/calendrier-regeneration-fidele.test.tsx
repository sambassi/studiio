/**
 * « Régénérer » (Calendrier) refait LE MÊME montage que le parcours Créer.
 *
 * Avant ce lot, les quatre chemins de rendu du Calendrier (Régénérer,
 * Planifier, Publier, Exporter) recopiaient chacun ~90 lignes de traduction
 * metadata -> compositeur, et aucun ne transmettait : le mixage
 * (`musicVolume`, `voiceVolume`, `audioKeyframes`), la `transition`,
 * `design.textAnimation`, les éléments libres, les fonds par séquence, le
 * recadrage de l'affiche, la photo des cartes. Les deux derniers n'étaient
 * même pas écrits dans le post.
 *
 * Ce fichier prouve :
 *   1. PARITÉ — options du parcours Créer == options de « Régénérer » relues
 *      depuis le post créé, champ par champ (rendu doublé, aucun fournisseur) ;
 *   2. DEFAULT SAFE — pour un ancien post, chacun des quatre chemins donne
 *      EXACTEMENT les options d'avant (les quatre anciens blocs sont recopiés
 *      ci-dessous comme référence) ;
 *   3. aucune URL `blob:` ni `data:` n'entre dans un post ;
 *   4. l'aller-retour « Modifier » garde fonds par séquence et recadrage, et un
 *      « Enregistrer » sans changement n'écrit rien.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const optionsComposees: Array<Record<string, unknown>> = [];
const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async (o: Record<string, unknown>) => {
      optionsComposees.push(o);
      return { video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) };
    },
    composeAndUpload: async () => { throw new Error('composeAndUpload ne doit plus être appelé'); },
    downloadBlob: async () => {},
  };
});

import { readFileSync } from 'fs';
import { resolve } from 'path';
import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { televerserPhotoCartes, DELAI_PHOTO_CARTES_MS } from '../lib/creer/photoCartes';
import { draftKey, DRAFT_VERSION, sanitizeDraft } from '../lib/creer/draft';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';
import { metadataPourEnregistrement, CLE_MONTAGE_PERIME } from '../lib/creer/postMetadata/from-wizard';
import {
  urlDurable, fondsPourMetadata, photoCartesPourMetadata, photoCartesValide, empreinteCartes,
  recadrageValide,
} from '../lib/creer/postMetadata/rendu-fidele';
import {
  optionsRenduDepuisMetadata, preparerOptionsRendu, montageSize,
  type CheminCalendrier, type DepsPreparation,
} from '../lib/rendus/options-depuis-metadata';

// ── Doublures ─────────────────────────────────────────────────────────────

/** Image décodée instantanément : jsdom ne charge rien. */
class ImageInstantanee {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  crossOrigin: string | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(v: string) {
    this._src = v;
    setTimeout(() => {
      this.complete = true;
      this.naturalWidth = this.naturalHeight = this.width = this.height = 64;
      this.onload?.();
    }, 0);
  }
}

/** Marqueur stable pour comparer deux images qui ne sont pas le même objet. */
const IMG = '<image>';

/**
 * Forme comparable : clés `undefined`/`null` retirées (le compositeur ne les
 * distingue pas d'une absence), images remplacées par un marqueur, fonctions
 * retirées.
 */
function normaliser(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normaliser);
  if (v && typeof v === 'object') {
    if (v instanceof ImageInstantanee || (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement)) return IMG;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined || val === null || typeof val === 'function') continue;
      out[k] = normaliser(val);
    }
    return out;
  }
  return v;
}

const depsDoublees = (espions: { lut?: string[]; elements?: number; images?: string[] } = {}): DepsPreparation => ({
  preRenderCardIcons: async (c) => c,
  chargerLutPourRendu: async () => { (espions.lut ??= []).push('lut'); return null; },
  rasteriserElements: async (els) => {
    espions.elements = (espions.elements ?? 0) + 1;
    return els.map((e) => ({ x: e.x, y: e.y, sizePct: e.sizePct, img: new ImageInstantanee() as unknown as HTMLImageElement }));
  },
  chargerImage: async (url) => { (espions.images ??= []).push(url); return new ImageInstantanee() as unknown as HTMLImageElement; },
});

// ── Parcours Créer, doublé au niveau de `fetch` et du compositeur ─────────

const CLE = draftKey('a@b.c');
const S = 'https://studiio.pro/storage/v1/object/public/media/u1';
const RUSH = `${S}/rush.mp4`;
const AFFICHE = `${S}/affiche.jpg`;
const FOND_TITRE = `${S}/fond-titre.jpg`;
const FOND_CTA = `${S}/fond-cta.jpg`;
const MUSIQUE = `${S}/musique.mp3`;
const KEYFRAMES = [
  { id: 'k1', time: 0, musicVolume: 0.8, rushVolume: 0.3, voiceVolume: 1 },
  { id: 'k2', time: 7, musicVolume: 0.2, rushVolume: 1, voiceVolume: 0.9 },
];
const RECADRAGE = { scale: 1.6, offsetX: 0.2, offsetY: -0.1 };
const FONDS = {
  titre: { url: FOND_TITRE, transform: { scale: 1.2, offsetX: 0.05, offsetY: 0 } },
  cta: { url: FOND_CTA, transform: { scale: 1, offsetX: 0, offsetY: 0 } },
};
const ELEMENTS = [{ id: 'e1', iconName: 'Flame', x: 30, y: 20, sizePct: 12, color: '#FFAA00' }];

let postsCrees: Array<Record<string, unknown>>;

function installerFetch() {
  postsCrees = [];
  let rang = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
    } as unknown as Response);
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      rang += 1;
      const job = `job-${rang}`;
      return rep({
        ok: true, jobId: job, uploadUrl: `/api/render/jobs/${job}/upload`, uploadMode: 'relais',
        publicUrl: `${S}/rendus/${job}.webm`, cout: 10,
      });
    }
    if (/\/api\/render\/jobs\/job-\d+\/upload$/.test(u) && m === 'PUT') return rep({ ok: true });
    if (/\/api\/render\/jobs\/job-\d+\/confirm$/.test(u)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (/\/api\/render\/jobs\/job-\d+\/cancel$/.test(u)) return rep({ ok: true });
    if (u.includes('/api/upload/signed-url')) return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (u.includes('/api/posts') && m === 'POST') {
      postsCrees.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, post: { id: `p${postsCrees.length}` } });
    }
    return rep({ success: true, data: [], posts: [], content: {}, images: [] });
  }) as unknown as typeof fetch;
}

const brouillonComplet = () => ({
  version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
  customTopic: 'yoga du matin', scheduledDate: '2026-09-01',
  generated: {
    title: 'Yoga du matin', subtitle: 'Reveiller le corps', cta: 'ESSAIE', ctaSub: 'LIEN EN BIO',
    cards: [
      { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
      { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
    ],
  },
  rushUrl: RUSH, rushName: 'rush.mp4',
  sequences: [
    { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
    { key: 'video', enabled: true }, { key: 'cta', enabled: true },
  ],
  videoDuration: 9,
  posterUrl: AFFICHE,
  posterTransform: RECADRAGE,
  seqBackgrounds: FONDS,
  transition: 'whip-pan',
  textAnimation: 'typewriter',
  elements: ELEMENTS,
  musicUrl: MUSIQUE, musicName: 'musique.mp3',
  musicVolume: 0.35, voiceVolume: 0.7,
  audioKeyframes: KEYFRAMES,
});

const attendre = async (tours = 60) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const envoyerAuCalendrier = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await attendre(4);
  for (let i = 0; i < 4; i += 1) {
    if (document.querySelector('[data-batch-mode="unique"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); await Promise.resolve(); });
  }
  await attendre(4);
  const bouton = document.querySelector('[data-envoi-action]') as HTMLButtonElement;
  expect(bouton.disabled).toBe(false);
  await act(async () => { fireEvent.click(bouton); });
  await attendre(120);
  expect(postsCrees).toHaveLength(1);
  expect(optionsComposees).toHaveLength(1);
  return { post: postsCrees[0], options: optionsComposees[0] };
};

const DEPS_SANITIZE = {
  themeIds: ['fitness'], toneIds: ['pro'], formats: ['9:16', '16:9', '1:1'], maxStep: 3,
  defaults: {
    themeId: 'fitness', toneId: 'pro', format: '9:16',
    titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
    sequences: [
      { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
      { key: 'video', enabled: false }, { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 8, cta: 4 },
  },
};

const imageOriginale = globalThis.Image;
beforeEach(() => {
  window.localStorage.clear();
  optionsComposees.length = 0;
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  installerFetch();
  window.alert = () => {};
  (globalThis as unknown as { Image: unknown }).Image = ImageInstantanee;
  window.localStorage.setItem(CLE, JSON.stringify(brouillonComplet()));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (globalThis as unknown as { Image: unknown }).Image = imageOriginale;
});

// ══════════════════════════════════════════════════════════════════════════
describe('PARITÉ — « Régénérer » relit le post et recompose avec les options du parcours', () => {
  it('le post créé porte les champs de fidélité, URL durables seulement', async () => {
    const { post } = await envoyerAuCalendrier();
    const meta = post.metadata as Record<string, any>;
    expect(meta.posterTransform).toEqual(RECADRAGE);
    expect(meta.seqBackgrounds).toEqual(FONDS);
    expect(meta.design.transition).toBe('whip-pan');
    expect(meta.design.textAnimation).toBe('typewriter');
    expect(meta.design.positions.elements).toEqual(ELEMENTS);
    expect(meta.musicVolume).toBe(0.35);
    expect(meta.audioKeyframes).toEqual(KEYFRAMES);
  });

  it('⚠️ options de régénération == options du parcours, champ par champ', async () => {
    const { post, options } = await envoyerAuCalendrier();
    // Les éléments du parcours ont bien été rasterisés (sinon la comparaison
    // ne prouverait rien pour eux).
    expect((options.design as Record<string, unknown>).elements).toHaveLength(1);

    const regen = await preparerOptionsRendu(
      { title: post.title as string, format: post.format as string, metadata: post.metadata },
      'regenerer', undefined, depsDoublees(),
    );

    const attendu = normaliser(options) as Record<string, any>;
    const obtenu = normaliser(regen) as Record<string, any>;

    // Deux écarts INERTES, documentés dans `options-depuis-metadata.ts` :
    //  - `ctaText` : le compositeur ne le lit qu'en l'absence de
    //    `design.ctaSubTextDesign`, toujours présent pour un post Créer ;
    //  - `design.typography` : forme imbriquée destinée à l'aperçu HTML du
    //    Calendrier, que le compositeur ne lit pas (il lit `titleTypography`
    //    et `ctaTypography`, comparés ci-dessous).
    expect(attendu.design.ctaSubTextDesign).toBe(obtenu.design.ctaSubTextDesign);
    delete attendu.ctaText; delete obtenu.ctaText;
    delete attendu.design.typography;

    // Champ par champ : un message qui nomme le champ fautif.
    const cles = new Set([...Object.keys(attendu), ...Object.keys(obtenu)]);
    for (const k of cles) {
      if (k === 'design') continue;
      expect(obtenu[k], `options.${k}`).toEqual(attendu[k]);
    }
    const clesDesign = new Set([...Object.keys(attendu.design), ...Object.keys(obtenu.design)]);
    for (const k of clesDesign) {
      expect(obtenu.design[k], `design.${k}`).toEqual(attendu.design[k]);
    }
  });

  it('les champs demandés sont TOUS transmis au compositeur', async () => {
    const { post } = await envoyerAuCalendrier();
    const regen = await preparerOptionsRendu(
      { title: post.title as string, format: post.format as string, metadata: post.metadata },
      'regenerer', undefined, depsDoublees(),
    );
    expect(regen.musicVolume).toBe(0.35);
    expect(regen.voiceVolume).toBe(0.7);
    expect(regen.audioKeyframes).toEqual(KEYFRAMES);
    expect(regen.transition).toBe('whip-pan');
    expect(regen.design?.textAnimation).toBe('typewriter');
    expect(regen.design?.elements).toHaveLength(1);
    expect(regen.posterTransform).toEqual(RECADRAGE);
    expect(regen.sequenceBackgrounds).toEqual({
      titre: { url: FOND_TITRE, opacity: 1, transform: FONDS.titre.transform },
      cartes: null, video: null,
      cta: { url: FOND_CTA, opacity: 1, transform: FONDS.cta.transform },
    });
  });

  it('les trois autres chemins reçoivent les mêmes champs de fidélité', async () => {
    const { post } = await envoyerAuCalendrier();
    for (const chemin of ['planifier', 'publier', 'exporter'] as CheminCalendrier[]) {
      const o = await preparerOptionsRendu(
        { title: post.title as string, format: post.format as string, metadata: post.metadata },
        chemin, undefined, depsDoublees(),
      );
      expect(o.transition, chemin).toBe('whip-pan');
      expect(o.musicVolume, chemin).toBe(0.35);
      expect(o.audioKeyframes, chemin).toEqual(KEYFRAMES);
      expect(o.posterTransform, chemin).toEqual(RECADRAGE);
      expect(o.sequenceBackgrounds?.titre?.url, chemin).toBe(FOND_TITRE);
      expect(o.design?.textAnimation, chemin).toBe('typewriter');
      expect(o.design?.elements, chemin).toHaveLength(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('PHOTO DES CARTES — relue seulement si elle représente encore les cartes', () => {
  const meta = {
    cards: [{ emoji: 'Heart', label: 'a', value: '1', color: '#fff' }],
    videoSize: { w: 1080, h: 1920 }, branding: { accentColor: '#D91CD2' }, design: { cardStyle: 'Compact' },
  };
  const RECT = { x: 5, y: 30, width: 90, height: 40 };

  it('écrite avec une URL durable, elle est blittée à la régénération', async () => {
    const photo = photoCartesPourMetadata(`${S}/cartes.png`, RECT, meta)!;
    const post = { title: 'T', format: 'reel', metadata: { ...meta, cardsSnapshot: photo } };
    const espions: { images?: string[] } = {};
    const o = await preparerOptionsRendu(post, 'regenerer', undefined, depsDoublees(espions));
    expect(espions.images).toEqual([`${S}/cartes.png`]);
    expect(o.design?.cardsSnapshot).toBeTruthy();
    expect(o.design?.cardsSnapshotRect).toEqual(RECT);
  });

  it('⚠️ après un « Modifier » des cartes, elle est IGNORÉE (empreinte) et rien n’est chargé', async () => {
    const photo = photoCartesPourMetadata(`${S}/cartes.png`, RECT, meta)!;
    const modifie = { ...meta, cards: [{ ...meta.cards[0], label: 'b' }], cardsSnapshot: photo };
    expect(photoCartesValide(modifie)).toBeUndefined();
    const espions: { images?: string[] } = {};
    const o = await preparerOptionsRendu({ title: 'T', format: 'reel', metadata: modifie }, 'regenerer', undefined, depsDoublees(espions));
    expect(espions.images).toBeUndefined();
    expect(o.design && 'cardsSnapshot' in o.design).toBe(false);
  });

  it('l’empreinte ne dépend pas de l’ordre des clés', () => {
    expect(empreinteCartes({ design: { cardStyle: 'X' }, cards: [1] }))
      .toBe(empreinteCartes({ cards: [1], design: { cardStyle: 'X' } }));
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('URL — jamais `blob:` ni `data:` dans un post', () => {
  it('urlDurable (règle `persistableUrl`)', () => {
    expect(urlDurable('blob:https://studiio.pro/1234')).toBeUndefined();
    expect(urlDurable('data:image/png;base64,AAAA')).toBeUndefined();
    expect(urlDurable('javascript:alert(1)')).toBeUndefined();
    expect(urlDurable(`${S}/x.jpg`)).toBe(`${S}/x.jpg`);
    expect(urlDurable('/storage/v1/object/public/media/x.jpg')).toBe('/storage/v1/object/public/media/x.jpg');
  });

  it('fonds par séquence : chaque entrée non durable est écartée, les autres restent', () => {
    expect(fondsPourMetadata({
      titre: { url: 'data:image/jpeg;base64,AAAA', transform: RECADRAGE },
      cartes: { url: 'blob:https://studiio.pro/9', transform: RECADRAGE },
      cta: { url: FOND_CTA, transform: { scale: 9, offsetX: 0, offsetY: 0 } },
    })).toEqual({ cta: { url: FOND_CTA, transform: { scale: 1, offsetX: 0, offsetY: 0 } } });
  });

  it('photo des cartes : refusée en `data:` / `blob:`', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(photoCartesPourMetadata('data:image/png;base64,AAAA', r, {})).toBeUndefined();
    expect(photoCartesPourMetadata('blob:https://studiio.pro/1', r, {})).toBeUndefined();
  });

  it('relecture : un post abîmé portant des `data:` ne les renvoie pas au compositeur', async () => {
    const o = await preparerOptionsRendu({
      title: 'T', format: 'reel', metadata: {
        seqBackgrounds: { titre: { url: 'data:image/jpeg;base64,AAAA', transform: RECADRAGE } },
        cardsSnapshot: { url: 'blob:https://studiio.pro/1', rect: { x: 0, y: 0, width: 1, height: 1 }, empreinte: empreinteCartes({}) },
      },
    }, 'regenerer', undefined, depsDoublees());
    expect('sequenceBackgrounds' in o).toBe(false);
    expect(o.design && 'cardsSnapshot' in o.design).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('MODIFIER — aller-retour des fonds par séquence et du recadrage', () => {
  it('⚠️ post créé -> toWizardDraft -> sanitizeDraft : fonds, recadrage et transition conservés', async () => {
    const { post } = await envoyerAuCalendrier();
    const relu = sanitizeDraft(toWizardDraft({ ...post, id: 'p1' } as never), DEPS_SANITIZE as never)!;
    expect(relu.posterTransform).toEqual(RECADRAGE);
    expect(relu.seqBackgrounds).toEqual(FONDS);
    expect(relu.transition).toBe('whip-pan');
  });

  it('un « Enregistrer » sans changement n’écrit rien — ni champ, ni `montagePerime`', () => {
    const valeurs = {
      transition: 'whip-pan', posterTransform: RECADRAGE, seqBackgrounds: fondsPourMetadata(FONDS),
    };
    expect(metadataPourEnregistrement({ design: {} }, valeurs, { ...valeurs })).toEqual({});
  });

  it('un changement de recadrage, de fond ou de transition périme le montage', () => {
    const avant = { transition: 'crossfade', posterTransform: RECADRAGE, seqBackgrounds: {} };
    const casse = [
      { ...avant, transition: 'zoom' },
      { ...avant, posterTransform: { scale: 1, offsetX: 0, offsetY: 0 } },
      { ...avant, seqBackgrounds: fondsPourMetadata(FONDS) },
    ];
    for (const apres of casse) {
      const envoi = metadataPourEnregistrement({ design: {} }, apres, avant);
      expect(envoi[CLE_MONTAGE_PERIME]).toBe(true);
    }
    // La transition s'écrit sous `design`, sans perdre le reste du bloc.
    const envoi = metadataPourEnregistrement({ design: { font: 'Anton' } }, { ...avant, transition: 'zoom' }, avant);
    expect(envoi.design).toEqual({ font: 'Anton', transition: 'zoom' });
  });

  it('retirer le dernier fond propre est envoyé (`{}`), et non ignoré', () => {
    const envoi = metadataPourEnregistrement({}, { seqBackgrounds: {} }, { seqBackgrounds: fondsPourMetadata(FONDS) });
    expect(envoi.seqBackgrounds).toEqual({});
  });

  it('un ancien post relu sans ces champs n’en invente aucun', () => {
    const d = toWizardDraft({ id: 'p', title: 'T', metadata: { design: {} } });
    expect(d.posterTransform).toBeUndefined();
    expect(d.seqBackgrounds).toBeUndefined();
    expect(d.transition).toBeUndefined();
    expect(recadrageValide(undefined)).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DEFAULT SAFE — les quatre anciens blocs du Calendrier, recopiés tels quels
// (avant ce lot), servent de référence sur des posts anciens.
// ══════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
function ancienRegenerer(post: any, cards: any, onProgress: any) {
  const meta: any = post.metadata || {};
  const brand = meta.branding;
  const designMeta: any = meta.design || {};
  const hasRush = !!meta.rushUrls?.[0];
  const safeDuration = (val: unknown, fallback: number, min = 2) =>
    val === 0 ? 0 : ((typeof val === 'number' && val >= min) ? val : fallback);
  return {
    ...montageSize(meta?.videoSize, post?.format ?? 'tv'),
    fps: 30,
    title: post.title || 'Vidéo',
    subtitle: meta.subtitle || undefined,
    salesPhrase: meta.salesPhrase || undefined,
    cards,
    posterUrl: meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null,
    videoUrl: meta.rushUrls?.[0] || null,
    logoUrl: meta.logoUrl || designMeta.logoUrl || null,
    musicUrl: meta.musicUrl || null,
    voiceUrl: meta.voiceUrl || null,
    sequenceVoiceUrls: (meta as any).sequenceVoiceUrls || undefined,
    sequenceOrder: (meta?.sequences?.order as string[] | undefined) || undefined,
    introDuration: safeDuration(meta.sequences?.intro, 5),
    cardsDuration: (meta.cards?.length > 0 || meta.textCards?.length > 0)
      ? safeDuration(meta.sequences?.cards, 6)
      : 0,
    videoDuration: hasRush ? safeDuration(meta.sequences?.video, 12) : 0,
    ctaDuration: safeDuration(meta.sequences?.cta, 5),
    accentColor: brand?.accentColor || '#D91CD2',
    ctaText: brand?.ctaText || "CHAT POUR PLUS D'INFOS",
    ctaSubText: brand?.ctaSubText || 'LIEN EN BIO',
    watermarkText: brand?.watermarkText || undefined,
    siteText: designMeta.siteText || undefined,
    design: {
      font: designMeta.font || undefined,
      titleColor: designMeta.titleColor || undefined,
      gradientColor1: designMeta.gradientColor1 || undefined,
      gradientColor2: designMeta.gradientColor2 || undefined,
      gradientOpacity: designMeta.gradientOpacity ?? undefined,
      ctaSubColor: designMeta.ctaSubColor || brand?.ctaSubColor || undefined,
      ctaColor: designMeta.ctaColor || undefined,
      logoSequences: designMeta.logoSequences || undefined,
      logoPosition: designMeta.positions?.logo || undefined,
      logoPositions: designMeta.logoPositions || undefined,
      logoScale: designMeta.logoScale || undefined,
      overlayText: meta.videoOverlayText || undefined,
      overlayColor: designMeta.overlayColor || undefined,
      overlayTextScale: meta.overlayTextScale,
      overlayStartTime: meta.overlayStartTime,
      overlayEndTime: meta.overlayEndTime,
      overlays: Array.isArray(meta.overlays) ? meta.overlays : undefined,
      textScale: designMeta.textScale || undefined,
      titleFont: designMeta.titleFont || undefined,
      subtitleFont: designMeta.subtitleFont || undefined,
      subtitleColor: designMeta.subtitleColor || undefined,
      subtitleScale: designMeta.subtitleScale ?? undefined,
      ctaFont: designMeta.ctaFont || undefined,
      watermarkFont: designMeta.watermarkFont || undefined,
      cardsTextScale: designMeta.cardsTextScale ?? undefined,
      ctaTextScale: designMeta.ctaTextScale || undefined,
      cardStyle: designMeta.cardStyle || undefined,
      titlePosition: designMeta.positions?.title || undefined,
      titleAlign: (designMeta as any).titleAlign || undefined,
      cardsPosition: designMeta.positions?.cards || undefined,
      cardsSize: designMeta.sizes?.cards || undefined,
      ctaMainText: designMeta.ctaMainText || undefined,
      ctaSubTextDesign: designMeta.ctaSubText || undefined,
      titleTypography: designMeta.typography?.title || undefined,
      watermarkPosition: designMeta.positions?.watermark || undefined,
      watermarkSize: designMeta.sizes?.watermark || undefined,
      overlayPosition: meta.overlayPosition || designMeta.positions?.overlay || undefined,
      titleSize: designMeta.sizes?.title || undefined,
      ctaTypography: designMeta.typography?.cta || undefined,
      overlayTypography: designMeta.typography?.overlay || undefined,
      seqGradients: designMeta.seqGradients || undefined,
      noColorBg: designMeta.noColorBg || undefined,
      noColorSequences: designMeta.noColorSequences || undefined,
      filter: designMeta.filter || undefined,
      cardsTypography: ((designMeta as any).typography?.cards) || ((designMeta as any).cardsTypography) || undefined,
      extraTitle: (designMeta as any).extraTitle || undefined,
      extraSubtitle: (designMeta as any).extraSubtitle || undefined,
      extraTitlePosition: (designMeta as any).extraTitlePosition || undefined,
      extraSubtitlePosition: (designMeta as any).extraSubtitlePosition || undefined,
      extraTitleTypography: (designMeta as any).extraTitleTypography || undefined,
      extraSubtitleTypography: (designMeta as any).extraSubtitleTypography || undefined,
    },
    onProgress,
  };
}

/** Planifier et Publier : blocs identiques avant ce lot. */
function ancienPlanifierPublier(post: any, cards: any, onProgress: any) {
  const meta: any = post.metadata || {};
  const posterUrl = meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null;
  const videoUrl = meta.rushUrls?.[0] || null;
  const musicUrl = meta.musicUrl || null;
  const voiceUrl = meta.voiceUrl || null;
  const logoUrl = meta.logoUrl || meta.design?.logoUrl || null;
  const seq = meta.sequences;
  const brand = meta.branding;
  const designMeta = meta.design || {};
  const r = ancienRegenerer(post, cards, onProgress);
  return {
    ...r,
    posterUrl, videoUrl, logoUrl, musicUrl, voiceUrl,
    introDuration: seq?.intro ?? 5,
    cardsDuration: seq?.cards ?? ((meta.cards?.length > 0 || meta.textCards?.length > 0) ? 6 : 0),
    videoDuration: seq?.video ?? 12,
    ctaDuration: seq?.cta ?? 5,
    accentColor: brand?.accentColor || '#D91CD2',
    siteText: designMeta.siteText || undefined,
  };
}

function ancienExporter(post: any, cards: any, onProgress: any) {
  const r: any = ancienPlanifierPublier(post, cards, onProgress);
  const d = { ...r.design };
  for (const k of ['watermarkPosition', 'watermarkSize', 'titleSize', 'ctaTypography', 'overlayTypography',
    'seqGradients', 'noColorBg', 'noColorSequences', 'filter']) delete d[k];
  return { ...r, design: d };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ANCIENS_POSTS: Array<[string, Record<string, unknown>]> = [
  ['post minimal', { title: 'A', format: 'tv', metadata: {} }],
  ['post sans metadata', { title: null, format: null }],
  ['assistant simple ancien (sans champs de fidélité)', {
    title: 'YOGA', format: 'reel', metadata: {
      type: 'infographic', source: 'assistant-simple', subtitle: 's',
      cards: [{ emoji: 'Heart', label: 'a', value: '1', description: 'd', color: '#fff' }],
      posterUrl: `${S}/p.jpg`, rushUrls: [RUSH], musicUrl: MUSIQUE,
      sequences: { intro: 5, cards: 0, video: 1, cta: 5, order: ['intro', 'video', 'cta'] },
      branding: { accentColor: '#123456', ctaText: 'GO', ctaSubText: 'bio', watermarkText: 'W' },
      videoSize: { w: 1080, h: 1080 },
      design: {
        font: 'Anton', titleAlign: 'left', titleFont: 'Anton', ctaSubText: 'bio', ctaMainText: 'GO',
        positions: { title: { x: 8, y: 10 }, watermark: { x: 50, y: 80 } },
        sizes: { title: 80, watermark: 60 },
        typography: { title: { bold: true }, cta: { italic: true } },
        noColorSequences: [], siteText: { enabled: false },
      },
    },
  }],
  ['éditeur avancé ancien', {
    title: 'AV', format: 'tv', metadata: {
      textCards: [{ text: 'x', color: '#f00' }], characterUrl: `${S}/c.png`, logoUrl: `${S}/l.png`,
      videoOverlayText: 'ov', overlays: [{ id: 1 }], overlayTextScale: 1.2, overlayPosition: { x: 1, y: 2 },
      sequences: { intro: 3 },
      design: {
        seqGradients: { a: 1 }, noColorBg: true, filter: 'warm', logoSequences: ['intro'],
        typography: { overlay: { bold: false }, cards: { bold: true } }, extraTitle: 'e',
      },
    },
  }],
];

describe('DEFAULT SAFE — un ancien post donne les MÊMES options qu’avant, sur chaque chemin', () => {
  const cartes = [{ emoji: 'Heart', label: 'a', value: '1' }] as unknown as
    Parameters<typeof optionsRenduDepuisMetadata>[2]['cards'];
  const onProgress = () => {};
  for (const [nom, post] of ANCIENS_POSTS) {
    it(`${nom} — Régénérer / Planifier / Publier / Exporter`, () => {
      expect(optionsRenduDepuisMetadata(post, 'regenerer', { cards: cartes, onProgress }))
        .toStrictEqual(ancienRegenerer(post, cartes, onProgress));
      expect(optionsRenduDepuisMetadata(post, 'planifier', { cards: cartes, onProgress }))
        .toStrictEqual(ancienPlanifierPublier(post, cartes, onProgress));
      expect(optionsRenduDepuisMetadata(post, 'publier', { cards: cartes, onProgress }))
        .toStrictEqual(ancienPlanifierPublier(post, cartes, onProgress));
      expect(optionsRenduDepuisMetadata(post, 'exporter', { cards: cartes, onProgress }))
        .toStrictEqual(ancienExporter(post, cartes, onProgress));
    });
  }

  it('aucune clé de fidélité n’apparaît, et aucun chargement de plus n’est tenté', async () => {
    for (const [, post] of ANCIENS_POSTS) {
      const espions: { lut?: string[]; elements?: number; images?: string[] } = {};
      const o = await preparerOptionsRendu(post, 'regenerer', undefined, depsDoublees(espions));
      for (const k of ['musicVolume', 'voiceVolume', 'audioKeyframes', 'transition', 'posterTransform', 'sequenceBackgrounds', 'rushLut']) {
        expect(k in o, k).toBe(false);
      }
      for (const k of ['textAnimation', 'elements', 'cardsSnapshot', 'cardsSnapshotRect', 'cardsFont', 'cardsTextStyle']) {
        expect(k in (o.design ?? {}), `design.${k}`).toBe(false);
      }
      expect(espions.elements).toBeUndefined();
      expect(espions.images).toBeUndefined();
      // LUT : lue seulement avec un rush — la règle d'avant.
      const meta = (post.metadata ?? {}) as { rushUrls?: string[] };
      expect(espions.lut?.length ?? 0).toBe(meta.rushUrls?.[0] ? 1 : 0);
    }
  });

  it('cartes : l’export garde sa forme sans description, les trois autres la portent', async () => {
    const vues: Record<string, unknown[]> = {};
    for (const chemin of ['regenerer', 'planifier', 'publier', 'exporter'] as CheminCalendrier[]) {
      await preparerOptionsRendu(
        { title: 'T', metadata: { cards: [{ emoji: 'Heart', label: 'l', value: 'v', description: 'd', color: '#fff', id: 'x' }] } },
        chemin, undefined,
        { ...depsDoublees(), preRenderCardIcons: async (c) => { vues[chemin] = c; return c; } },
      );
    }
    expect(vues.regenerer).toEqual([{ emoji: 'Heart', label: 'l', value: 'v', description: 'd', color: '#fff' }]);
    expect(vues.planifier).toEqual(vues.regenerer);
    expect(vues.publier).toEqual(vues.regenerer);
    expect(vues.exporter).toEqual([{ emoji: 'Heart', label: 'l', value: 'v', color: '#fff' }]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POSTS RÉELS ACTUELS — changement de rendu ASSUMÉ
//
// `main` écrit DÉJÀ `design.textAnimation`, `design.cardsFont`,
// `design.cardsTextStyle`, `design.positions.elements` (parcours Créer) et
// `design.transition` / `design.textAnimation` (Autopilote,
// `autopilot/design.ts`). Jusqu'ici, les quatre chemins du Calendrier les
// ignoraient ; désormais ils les appliquent. C'est plus fidèle au montage
// d'origine, mais c'est un CHANGEMENT DE RENDU pour ces posts existants —
// documenté ici, pas caché derrière le « default safe ».
// ══════════════════════════════════════════════════════════════════════════
describe('POSTS RÉELS ACTUELS — les champs déjà écrits par main sont désormais appliqués', () => {
  const postCreerActuel = {
    title: 'YOGA', format: 'reel', metadata: {
      source: 'assistant-simple',
      cards: [{ emoji: 'Heart', label: 'a', value: '1', description: 'd', color: '#fff' }],
      sequences: { intro: 5, cards: 6, video: 0, cta: 5, order: ['intro', 'cards', 'cta'] },
      design: {
        textAnimation: 'pop', cardsFont: 'Poppins', cardsTextStyle: { font: 'Poppins', scale: 1 },
        positions: { title: { x: 8, y: 10 }, elements: ELEMENTS },
      },
    },
  };
  const postAutopiloteActuel = {
    title: 'AUTO', format: 'reel', metadata: {
      serverRendered: true, renderedVideoUrl: `${S}/autopilote-j1.mp4`,
      design: { textAnimation: 'fade', transition: 'zoom', titleAlign: 'left' },
    },
  };

  it('post Créer actuel : animation, police et style des cartes, éléments — appliqués sur les 4 chemins', async () => {
    for (const chemin of ['regenerer', 'planifier', 'publier', 'exporter'] as CheminCalendrier[]) {
      const o = await preparerOptionsRendu(postCreerActuel, chemin, undefined, depsDoublees());
      expect(o.design?.textAnimation, chemin).toBe('pop');
      expect(o.design?.cardsFont, chemin).toBe('Poppins');
      expect(o.design?.cardsTextStyle, chemin).toEqual({ font: 'Poppins', scale: 1 });
      expect(o.design?.elements, chemin).toHaveLength(1);
    }
  });

  it('post Autopilote actuel : transition et animation appliquées SI un chemin le recompose (export Bureau)', async () => {
    const o = await preparerOptionsRendu(postAutopiloteActuel, 'exporter', undefined, depsDoublees());
    expect(o.transition).toBe('zoom');
    expect(o.design?.textAnimation).toBe('fade');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('PHOTO DES CARTES — téléversement BORNÉ (le montage est déjà débité)', () => {
  const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })) } as unknown as HTMLCanvasElement;
  const RECT = { x: 1, y: 2, width: 50, height: 40 };

  it('stockage bloqué : rend `undefined` au délai, sans attendre indéfiniment', async () => {
    const debut = Date.now();
    const photo = await televerserPhotoCartes(canvas, RECT, {}, {
      upload: () => new Promise(() => {}), // ne répond jamais
      delaiMs: 30,
    });
    expect(photo).toBeUndefined();
    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it('le délai par défaut est de 10 s', () => {
    expect(DELAI_PHOTO_CARTES_MS).toBe(10_000);
  });

  it('encodage bloqué (toBlob muet) : même délai', async () => {
    const muet = { toBlob: () => {} } as unknown as HTMLCanvasElement;
    expect(await televerserPhotoCartes(muet, RECT, {}, { upload: async () => ({ url: `${S}/c.png`, dataUrl: false }), delaiMs: 30 }))
      .toBeUndefined();
  });

  it('repli `data:` ou erreur d’envoi : pas de photo', async () => {
    expect(await televerserPhotoCartes(canvas, RECT, {}, { upload: async () => ({ url: 'data:image/png;base64,AA', dataUrl: true }) }))
      .toBeUndefined();
    expect(await televerserPhotoCartes(canvas, RECT, {}, { upload: async () => { throw new Error('x'); } }))
      .toBeUndefined();
  });

  it('succès : URL durable, rectangle et empreinte de la metadata envoyée', async () => {
    const meta = { cards: [{ label: 'a' }] };
    const photo = await televerserPhotoCartes(canvas, RECT, meta, { upload: async () => ({ url: `${S}/c.png`, dataUrl: false }) });
    expect(photo).toEqual({ url: `${S}/c.png`, rect: RECT, empreinte: empreinteCartes(meta) });
  });

  it('le parcours Créer passe par la version bornée, jamais par `uploadPosterFile` en direct', () => {
    const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    const debut = wizard.indexOf('const photoCartes: PhotoCartes | undefined');
    expect(debut).toBeGreaterThan(0);
    const bloc = wizard.slice(debut, wizard.indexOf("fetch('/api/posts'", debut));
    expect(bloc).toContain('await televerserPhotoCartes(');
    expect(bloc).not.toContain('uploadPosterFile(');
  });
});
