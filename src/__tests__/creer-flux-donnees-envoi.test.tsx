/**
 * Parcours Créer — on suit les DONNÉES, pas les boutons.
 *
 *   état restauré (rush, affiche, mixage) → options de `composeVideo`
 *   → corps du `POST /api/posts` → relecture par « Modifier » (`toWizardDraft`
 *   + `sanitizeDraft`) → ce que « Régénérer » du Calendrier relit.
 *
 * Deux pertes étaient silencieuses :
 *
 *   1. La metadata du post créé ne portait NI `posterUrl`, NI le mixage
 *      (`musicVolume`, `voiceVolume`, `audioKeyframes`). Le Calendrier
 *      régénère avec `meta.posterUrl` : un montage régénéré (après
 *      « Modifier », drapeau `montagePerime`) perdait sa photo de fond ; et
 *      « Modifier » rouvrait le post sans affiche ni mixage.
 *
 *   2. `sanitizeDraft` réécrivait les keyframes du mixeur sous une forme
 *      inventée (`{ t, music, voice, rush }`) que ni l'écran ni le
 *      compositeur ne connaissent (`{ id, time, musicVolume, rushVolume,
 *      voiceVolume }`). Après un rechargement, le compositeur appelait
 *      `setValueAtTime(undefined, NaN)`.
 *
 * Le rendu est doublé au niveau de `fetch` et du compositeur : aucun
 * fournisseur n'est appelé.
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

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION, sanitizeDraft } from '../lib/creer/draft';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';

const CLE = draftKey('a@b.c');
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-plage.mp4';
const AFFICHE = 'https://studiio.pro/storage/v1/object/public/media/u1/affiche.jpg';
const MUSIQUE = 'https://studiio.pro/storage/v1/object/public/media/u1/musique.mp3';
const KEYFRAMES = [
  { id: 'k1', time: 0, musicVolume: 0.8, rushVolume: 0.3, voiceVolume: 1 },
  { id: 'k2', time: 7, musicVolume: 0.2, rushVolume: 1, voiceVolume: 0.9 },
];
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

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
        publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${job}.webm`, cout: 10,
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

const poser = () => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 4,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    rushUrl: RUSH, rushName: 'plage.mp4',
    sequences: [
      { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
      { key: 'video', enabled: true }, { key: 'cta', enabled: true },
    ],
    videoDuration: 9,
    posterUrl: AFFICHE,
    musicUrl: MUSIQUE, musicName: 'musique.mp3',
    musicVolume: 0.35, voiceVolume: 0.7,
    audioKeyframes: KEYFRAMES,
  }));
};

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
  return postsCrees[0];
};

beforeEach(() => {
  window.localStorage.clear();
  optionsComposees.length = 0;
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  installerFetch();
  window.alert = () => {};
  poser();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RUSH — le rush sélectionné arrive dans le montage ET dans le post', () => {
  it('état → options du compositeur → metadata.rushUrls', async () => {
    const post = await envoyerAuCalendrier();
    expect(optionsComposees).toHaveLength(1);
    const o = optionsComposees[0];
    expect(o.videoUrl).toBe(RUSH);
    expect(o.videoDuration).toBe(9);
    expect(o.sequenceOrder).toEqual(['intro', 'cards', 'video', 'cta']);
    const meta = post.metadata as Record<string, unknown>;
    expect(meta.rushUrls).toEqual([RUSH]);
    expect((meta.sequences as Record<string, unknown>).video).toBe(9);
    expect(meta.renderedVideoUrl).toMatch(/rendus\/job-1\.webm$/);
    expect(post.media_url).toBe(meta.renderedVideoUrl);
  });
});

describe('AFFICHE et MIXAGE — ce qui a été composé est écrit dans le post', () => {
  it('⚠️ metadata.posterUrl = l affiche passée au compositeur (le Calendrier régénère avec)', async () => {
    const post = await envoyerAuCalendrier();
    expect(optionsComposees[0].posterUrl).toBe(AFFICHE);
    const meta = post.metadata as Record<string, unknown>;
    expect(meta.posterUrl).toBe(AFFICHE);
  });

  it('⚠️ le mixage part au compositeur ET dans le post', async () => {
    const post = await envoyerAuCalendrier();
    const o = optionsComposees[0];
    expect(o.musicVolume).toBe(0.35);
    expect(o.voiceVolume).toBe(0.7);
    expect(o.audioKeyframes).toEqual(KEYFRAMES);
    const meta = post.metadata as Record<string, unknown>;
    expect(meta.musicVolume).toBe(0.35);
    expect(meta.voiceVolume).toBe(0.7);
    expect(meta.audioKeyframes).toEqual(KEYFRAMES);
  });

  it('⚠️ « Modifier » rouvre le post créé avec son rush, son affiche et son mixage', async () => {
    const post = await envoyerAuCalendrier();
    const relu = sanitizeDraft(toWizardDraft({ ...post, id: 'p1' } as never), {
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
    })!;
    expect(relu.rushUrl).toBe(RUSH);
    expect(relu.posterUrl).toBe(AFFICHE);
    expect(relu.musicVolume).toBe(0.35);
    expect(relu.voiceVolume).toBe(0.7);
    expect(relu.audioKeyframes).toEqual(KEYFRAMES);
  });
});

describe('sanitizeDraft — keyframes du mixeur', () => {
  const deps = {
    themeIds: ['fitness'], toneIds: ['pro'], formats: ['9:16'], maxStep: 3,
    defaults: {
      themeId: 'fitness', toneId: 'pro', format: '9:16',
      titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
      sequences: [{ key: 'intro', enabled: true }],
      durations: { intro: 4, cards: 6, video: 8, cta: 4 },
    },
  };
  it('garde la forme du compositeur, bornes comprises', () => {
    const d = sanitizeDraft({ version: DRAFT_VERSION, audioKeyframes: [
      { id: 'a', time: 3, musicVolume: 2, rushVolume: 0.4, voiceVolume: -1 },
    ] }, deps as never)!;
    expect(d.audioKeyframes).toEqual([{ id: 'a', time: 3, musicVolume: 0.5, rushVolume: 0.4, voiceVolume: 1 }]);
  });
  it('relit un ancien brouillon écrit sous { t, music, voice, rush }', () => {
    const d = sanitizeDraft({ version: DRAFT_VERSION, audioKeyframes: [
      { t: 4, music: 0.1, voice: 0.6, rush: 0.2 },
    ] }, deps as never)!;
    expect(d.audioKeyframes).toEqual([{ id: 'kf-0', time: 4, musicVolume: 0.1, rushVolume: 0.2, voiceVolume: 0.6 }]);
  });
});
