/**
 * « Régénérer » dans l'aperçu du Calendrier, sur un post PHOTOS SEULES de
 * l'Autopilote (`rushSegments` enregistré, `rushUrls: []`) : le compositeur
 * reçoit le PLAN enregistré (ordre, durées, recadrage, CTA) et la metadata
 * réécrite garde plan et crédits stock. Avant : `videoUrl: null`, séquence
 * Vidéo à 0 s — photos perdues.
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
    downloadBlob: async () => {},
  };
});

import Calendar from '../app/dashboard/calendar/page';
import { CURRENT_COMPOSER_VERSION } from '../lib/video-composer';


const PA = 'https://cdn/photo-a.jpg';
const PB = 'https://cdn/photo-b.jpg';
const PLAN = [
  { url: PA, debut: 0, fin: 4, kind: 'image', source: 'photo', mouvement: 'zoomIn' },
  { url: PB, debut: 4, fin: 9, kind: 'image', source: 'photo', mouvement: 'panG' },
];
const CROP = { scale: 1.3, offsetX: 0.1, offsetY: 0 };
const CREDITS = [{ url: PB, provider: 'unsplash', auteur: 'Jane', sourceUrl: 'https://unsplash.com/photos/x', licence: 'Licence Unsplash' }];
const JOB = 'job-88';
const AUJOURDHUI = new Date();
const JOUR = String(AUJOURDHUI.getDate());
const DATE_ISO = `${AUJOURDHUI.getFullYear()}-${String(AUJOURDHUI.getMonth() + 1).padStart(2, '0')}-${String(AUJOURDHUI.getDate()).padStart(2, '0')}`;

/** Post Autopilote « photos seules » : plan enregistré, `rushUrls` vide. */
function postAJour(extra: Record<string, unknown> = {}) {
  return {
    id: 'p1', user_id: 'u1', title: 'YOGA', caption: 'legende', status: 'draft',
    format: 'reel', media_type: 'video', media_url: 'https://cdn/ancien.webm',
    scheduled_date: DATE_ISO, scheduled_time: '12:00', platforms: ['instagram'],
    metadata: {
      type: 'infographic',
      posterUrl: 'https://cdn/p.jpg',
      cards: [],
      sequences: { intro: 2, cards: 0, video: 9, cta: 3, order: ['intro', 'video', 'cta'] },
      branding: { watermarkText: 'AB', ctaText: 'GO', ctaSubText: 'LIEN EN BIO' },
      rushUrls: [],
      rushSegments: PLAN,
      rushTransforms: { [PA]: CROP },
      stockCredits: CREDITS,
      montagePerime: true,
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

function installerFetch() {
  patchs = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps), blob: async () => MONTAGE(),
    } as unknown as Response);
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

describe('Calendrier — « Régénérer » depuis le plan multi-sources enregistré', () => {
  it('photos seules sans rush : compose le plan enregistré, sans perdre plan ni crédits', async () => {
    optionsComposees.length = 0;
    post = postAJour();
    installerFetch();
    await ouvrirApercu();
    expect(regenerer()).not.toBeNull();
    await act(async () => { fireEvent.click(regenerer()!); });
    await attendre(80);
    expect(optionsComposees).toHaveLength(1);
    const o = optionsComposees[0];
    expect(o.montage).toEqual(PLAN);
    expect(o.videoUrl).toBe(PA);
    expect([o.introDuration, o.cardsDuration, o.videoDuration, o.ctaDuration]).toEqual([2, 0, 9, 3]);
    expect(o.rushTransforms).toEqual({ [PA]: CROP });
    expect(o.sequenceOrder).toEqual(['intro', 'video', 'cta']);
    expect([o.ctaText, o.ctaSubText]).toEqual(['GO', 'LIEN EN BIO']);
    expect(patchs).toHaveLength(1);
    const meta = patchs[0].metadata as Record<string, unknown>;
    expect(meta.rushSegments).toEqual(PLAN);
    expect(meta.stockCredits).toEqual(CREDITS);
    expect(meta.montagePerime).toBe(false);
  });
});
