/**
 * « Exporter » (Bureau) — un rendu final serveur est TÉLÉCHARGÉ, pas recomposé.
 *
 * Avant : la seule question était « `renderedVideoUrl` finit-il par `.mp4` ? »,
 * pensée contre les MP4 CORROMPUS du MediaRecorder de Chrome. Un montage
 * Autopilote (`autopilote-<job>.mp4`, rendu par Remotion côté serveur) tombait
 * dans la même case : il était recomposé dans le navigateur, et facturé
 * (`composerEtFacturer('bureau')`), au lieu d'être téléchargé.
 *
 * Rendu doublé au niveau du compositeur et de `fetch` : aucun fournisseur, aucun
 * débit réel.
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

const compositions: unknown[] = [];
const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async (o: unknown) => {
      compositions.push(o);
      return { video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) };
    },
    downloadBlob: async () => {},
  };
});

import Calendar from '../app/dashboard/calendar/page';
import { decisionExportBureau } from '../lib/rendus/export-bureau';
import { MESSAGE_MONTAGE_PERIME, MESSAGE_MONTAGE_PERIME_SERVEUR } from '../lib/creer/montage-perime';

const S = 'https://studiio.pro/storage/v1/object/public/media/u1';
const JOB = 'job-7';
const AUJOURDHUI = new Date();
const JOUR = String(AUJOURDHUI.getDate());
const DATE_ISO = `${AUJOURDHUI.getFullYear()}-${String(AUJOURDHUI.getMonth() + 1).padStart(2, '0')}-${String(AUJOURDHUI.getDate()).padStart(2, '0')}`;

function unPost(media: string, meta: Record<string, unknown>) {
  return {
    id: 'p1', user_id: 'u1', title: 'YOGA', caption: 'l', status: 'draft',
    format: 'reel', media_type: 'video', media_url: media,
    scheduled_date: DATE_ISO, scheduled_time: '12:00', platforms: ['instagram'],
    metadata: {
      type: 'infographic', posterUrl: `${S}/p.jpg`,
      cards: [{ emoji: 'Heart', label: 'a', value: '1', color: '#ffffff' }],
      sequences: { intro: 5, cards: 8, video: 0, cta: 5, order: ['intro', 'cards', 'cta'] },
      branding: { watermarkText: 'AB', ctaText: 'GO' }, design: {},
      renderedVideoUrl: media,
      ...meta,
    },
  };
}

let post: ReturnType<typeof unPost>;
let requetes: string[];
let telechargements: string[];
let alertes: string[];

function installerFetch() {
  requetes = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    requetes.push(`${m} ${u}`);
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps), blob: async () => MONTAGE(),
    } as unknown as Response);
    if (u.endsWith('/api/render/jobs') && m === 'POST') {
      return rep({
        ok: true, jobId: JOB, uploadUrl: `/api/render/jobs/${JOB}/upload`, uploadMode: 'relais',
        publicUrl: `${S}/rendus/${JOB}.webm`, cout: 10,
      });
    }
    if (u.includes(`/jobs/${JOB}/upload`)) return rep({ ok: true });
    if (u.includes(`/jobs/${JOB}/confirm`)) return rep({ ok: true, politique: 'credits', balance: 4990 });
    if (u.includes('/api/convert/to-mp4')) return rep({ success: true, mp4Url: `${S}/converti.mp4` });
    if (u.includes('/api/social')) return rep({ success: true, accounts: [], data: [] });
    if (u.includes('/api/posts')) return rep({ success: true, posts: [post], data: [post], post });
    // HEAD d'existence du WebM, et tout le reste.
    return rep({ success: true, data: [], posts: [] });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 40) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const exporter = async () => {
  render(<Calendar />);
  await attendre(5);
  await act(async () => { fireEvent.click(document.querySelector(`[data-day="${JOUR}"]`)!); });
  await attendre(5);
  // Le bouton Exporter de la liste du jour : il existe pour TOUS les posts,
  // y compris Autopilote (dont l'aperçu complet est un lecteur nu).
  const b = Array.from(document.querySelectorAll('button'))
    .find((x) => x.getAttribute('title') === 'calendar.actions.export') as HTMLButtonElement;
  expect(b, 'le bouton Exporter doit exister').toBeTruthy();
  await act(async () => { fireEvent.click(b); });
  await attendre(80);
};

const debits = () => requetes.filter((r) => r.includes('/api/render/jobs'));

beforeEach(() => {
  window.localStorage.clear();
  compositions.length = 0;
  telechargements = [];
  alertes = [];
  window.alert = (m?: unknown) => { alertes.push(String(m)); };
  window.confirm = () => true;
  (HTMLAnchorElement.prototype as unknown as { click: () => void }).click = function (this: HTMLAnchorElement) {
    telechargements.push(this.href);
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Export Bureau — rendu final serveur', () => {
  it('⚠️ post Autopilote mp4 : téléchargé tel quel, sans composition ni débit', async () => {
    const mp4 = `${S}/autopilote-j42.mp4`;
    post = unPost(mp4, { serverRendered: true });
    installerFetch();
    await exporter();
    expect(compositions).toHaveLength(0);
    expect(debits()).toEqual([]);
    expect(requetes.some((r) => r.includes('/api/convert/to-mp4'))).toBe(false);
    expect(telechargements).toEqual([mp4]);
  });

  it('post navigateur WebM : conversion serveur comme avant, sans recomposition', async () => {
    post = unPost(`${S}/rendus/job-1.webm`, {});
    installerFetch();
    await exporter();
    expect(compositions).toHaveLength(0);
    expect(debits()).toEqual([]);
    expect(requetes.some((r) => r.includes('/api/convert/to-mp4'))).toBe(true);
    expect(telechargements).toEqual([`${S}/converti.mp4`]);
  });

  it('post navigateur `.mp4` (MediaRecorder, corrompu) : recomposé comme avant', async () => {
    post = unPost(`${S}/rendus/vieux.mp4`, {});
    installerFetch();
    await exporter();
    expect(compositions).toHaveLength(1);
    expect(debits().length).toBeGreaterThan(0);
  });

  it('⚠️ post `montagePerime` (navigateur) : ni l’ancien fichier, ni recomposition — le message #459', async () => {
    post = unPost(`${S}/rendus/job-1.webm`, { montagePerime: true });
    installerFetch();
    await exporter();
    expect(telechargements).toEqual([]);
    expect(compositions).toHaveLength(0);
    expect(debits()).toEqual([]);
    expect(requetes.some((r) => r.includes('/api/convert/to-mp4'))).toBe(false);
    expect(alertes).toEqual([MESSAGE_MONTAGE_PERIME]);
  });

  it('⚠️ post Autopilote `montagePerime` : l’ancien mp4 n’est pas livré en silence', async () => {
    post = unPost(`${S}/autopilote-j42.mp4`, { serverRendered: true, montagePerime: true });
    installerFetch();
    await exporter();
    expect(telechargements).toEqual([]);
    expect(compositions).toHaveLength(0);
    expect(alertes).toEqual([MESSAGE_MONTAGE_PERIME_SERVEUR]);
  });
});

describe('decisionExportBureau — la règle, sur des valeurs', () => {
  it.each([
    [{ renderedVideoUrl: `${S}/autopilote-j1.mp4`, serverRendered: true }, 'telecharger'],
    [{ renderedVideoUrl: `${S}/autopilote-j1.mp4` }, 'telecharger'],
    [{ renderedVideoUrl: `${S}/x.mp4`, serverRendered: true }, 'telecharger'],
    [{ renderedVideoUrl: `${S}/x.webm` }, 'convertir'],
    [{ renderedVideoUrl: `${S}/x.mp4` }, 'recomposer'],
    [{}, 'recomposer'],
    [null, 'recomposer'],
    [{ renderedVideoUrl: 'blob:https://studiio.pro/1', serverRendered: true }, 'convertir'],
    [{ renderedVideoUrl: `${S}/autopilote-j1.mp4`, serverRendered: true, montagePerime: true }, 'bloque'],
    [{ renderedVideoUrl: `${S}/x.webm`, montagePerime: true }, 'bloque'],
  ])('%j -> %s', (meta, attendu) => {
    expect(decisionExportBureau(meta)).toBe(attendu);
  });
});
