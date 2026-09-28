/**
 * Le filtre couleur (LUT) d'un post survit a la regeneration du Calendrier.
 *
 * Le wizard ecrit desormais `metadata.lut` (reference : empreinte, nom,
 * intensite). Avec #454, « Enregistrer » dans Modifier fait apparaitre
 * « Regenerer » — qui recomposait SANS filtre, sans le moindre message. Le
 * Calendrier lit maintenant la LUT par `chargerLutPourRendu` et la passe au
 * compositeur (`rushLut`).
 *
 * Default safe : un post sans `lut` est rendu exactement comme avant — aucune
 * cle `rushLut`, aucune lecture de LUT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: () => {} });

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c', id: 'u1' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const optionsRendu: Array<Record<string, unknown>> = [];
const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async (o: unknown) => {
      optionsRendu.push(o as Record<string, unknown>);
      return { video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) };
    },
    downloadBlob: async () => {},
  };
});

import Calendar from '../app/dashboard/calendar/page';
import { CURRENT_COMPOSER_VERSION } from '../lib/video-composer';

const JOB = 'job-88';
const AUJOURDHUI = new Date();
const JOUR = String(AUJOURDHUI.getDate());
const DATE_ISO = `${AUJOURDHUI.getFullYear()}-${String(AUJOURDHUI.getMonth() + 1).padStart(2, '0')}-${String(AUJOURDHUI.getDate()).padStart(2, '0')}`;

/** Un post dont le montage est À JOUR au sens d'avant ce lot. */
function postAJour(extra: Record<string, unknown> = {}) {
  return {
    id: 'p1', user_id: 'u1', title: 'YOGA', caption: 'legende', status: 'draft',
    format: 'reel', media_type: 'video', media_url: 'https://cdn/ancien.webm',
    scheduled_date: DATE_ISO, scheduled_time: '12:00', platforms: ['instagram'],
    metadata: {
      type: 'infographic',
      posterUrl: 'https://cdn/p.jpg',
      cards: [{ emoji: 'Heart', label: 'a', value: '1', color: '#ffffff' }],
      sequences: { intro: 5, cards: 8, video: 0, cta: 5, order: ['intro', 'cards', 'cta'] },
      branding: { watermarkText: 'AB', ctaText: 'GO' },
      design: {},
      renderedVideoUrl: 'https://cdn/ancien.webm',
      thumbnailUrl: 'https://cdn/ancien.jpg',
      composerVersion: CURRENT_COMPOSER_VERSION,
      ...extra,
    },
  };
}

let post: ReturnType<typeof postAJour>;
let patchs: Array<Record<string, unknown>>;
let lecturesLut: string[];
let lutReponse: 'ok' | '404' = 'ok';
const E = 'e'.repeat(64);
const CUBE = 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n';

function installerFetch() {
  patchs = [];
  lecturesLut = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)), blob: async () => MONTAGE(),
    } as unknown as Response);
    if (u.startsWith('/api/creatif/luts/')) {
      lecturesLut.push(u);
      return lutReponse === 'ok' ? rep(CUBE) : rep({ ok: false }, 404);
    }
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      return rep({
        ok: true, jobId: JOB, uploadUrl: `/api/render/jobs/${JOB}/upload`, uploadMode: 'relais',
        publicUrl: `https://studiio.pro/storage/v1/object/public/media/u1/rendus/${JOB}.webm`, cout: 10,
      });
    }
    if (u.includes(`/jobs/${JOB}/upload`)) return rep({ ok: true });
    if (u.includes(`/jobs/${JOB}/confirm`)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    }
    if (u.includes('minio.studiio.pro')) return rep({ ok: true });
    if (u.includes('/api/social')) return rep({ success: true, accounts: [], data: [] });
    if (u.startsWith('/api/posts/') && m === 'PATCH') {
      patchs.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, post });
    }
    if (u.includes('/api/posts')) return rep({ success: true, posts: [post], data: [post], post });
    return rep({ success: true, data: [], posts: [] });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 40) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

function bouton(motif: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (b) => ((b.getAttribute('title') || '') + (b.textContent || '')).includes(motif),
  ) as HTMLButtonElement | undefined;
}

const ouvrirApercu = async () => {
  render(<Calendar />);
  await attendre(5);
  const jour = document.querySelector(`[data-day="${JOUR}"]`);
  expect(jour, 'la case du jour doit exister').toBeTruthy();
  await act(async () => { fireEvent.click(jour!); await Promise.resolve(); });
  await attendre(5);
  const fp = bouton('fullPreview');
  expect(fp, "l'aperçu complet doit être atteignable").toBeTruthy();
  await act(async () => { fireEvent.click(fp!); await Promise.resolve(); });
  await attendre(5);
};

const regenerer = () => document.querySelector('[data-regenerer]');

beforeEach(() => {
  window.localStorage.clear();
  window.alert = () => {};
  window.confirm = () => true;
  (HTMLAnchorElement.prototype as unknown as { click: () => void }).click = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });


/** Un post AVEC rush, montage perime (bouton « Regenerer » visible). */
const avecRush = (extra: Record<string, unknown> = {}) => postAJour({
  montagePerime: true,
  rushUrls: ['https://studiio.pro/storage/v1/object/public/media/u1/rush.mp4'],
  sequences: { intro: 5, cards: 8, video: 6, cta: 5, order: ['intro', 'cards', 'video', 'cta'] },
  ...extra,
});

const lancerRegeneration = async () => {
  await ouvrirApercu();
  expect(regenerer()).not.toBeNull();
  await act(async () => { fireEvent.click(regenerer()!); });
  await attendre(80);
  expect(optionsRendu).toHaveLength(1);
  return optionsRendu[0];
};

describe('Calendrier — « Regenerer » garde le filtre couleur', () => {
  beforeEach(() => {
    optionsRendu.length = 0;
    lutReponse = 'ok';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('la LUT de la metadata est lue et passee au compositeur', async () => {
    post = avecRush({ lut: { empreinte: E, nom: 'inverse', intensite: 0.7 } });
    installerFetch();
    const o = await lancerRegeneration();
    expect(lecturesLut).toEqual([`/api/creatif/luts/${E}`]);
    const rushLut = o.rushLut as { lut: { kind: string; size: number; table: Float32Array }; intensity: number };
    expect(rushLut.intensity).toBe(0.7);
    expect(rushLut.lut.size).toBe(2);
    expect(Array.from(rushLut.lut.table.slice(0, 3))).toEqual([1, 1, 1]);
  });

  it('default safe : sans `lut`, aucune cle rushLut ni lecture — rendu d avant', async () => {
    post = avecRush();
    installerFetch();
    const o = await lancerRegeneration();
    expect('rushLut' in o).toBe(false);
    expect(lecturesLut).toEqual([]);
  });

  it('LUT disparue (404) : regeneration QUAND MEME, sans etalonnage', async () => {
    post = avecRush({ lut: { empreinte: E, nom: 'inverse', intensite: 1 } });
    lutReponse = '404';
    installerFetch();
    const o = await lancerRegeneration();
    expect(lecturesLut).toHaveLength(1);
    expect('rushLut' in o).toBe(false);
    expect(patchs).toHaveLength(1);
  });

  it('reference abimee (empreinte invalide) : aucune requete, rendu sans etalonnage', async () => {
    post = avecRush({ lut: { empreinte: '../../x', nom: 'x', intensite: 1 } });
    installerFetch();
    const o = await lancerRegeneration();
    expect(lecturesLut).toEqual([]);
    expect('rushLut' in o).toBe(false);
  });
});
