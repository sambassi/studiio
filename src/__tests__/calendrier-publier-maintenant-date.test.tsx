/**
 * « Publier maintenant » dans le Calendrier : la date et l'heure écrites
 * doivent être celles du fuseau que le cron applique au post
 * (`metadata.timezone`, à défaut Europe/Paris).
 *
 * Avant : la date venait de `toISOString()` (UTC) et l'heure de
 * `toTimeString()` (heure du navigateur). Entre 0 h et 2 h à Paris, le post
 * était rangé la VEILLE.
 *
 * Horloge figée à 00:30 heure de Paris, le 28 septembre 2026 (CEST, UTC+2),
 * soit 22:30 UTC le 27.
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

import Calendar from '../app/dashboard/calendar/page';

/** 00:30 à Paris le 28/09/2026 = 22:30 UTC le 27/09/2026. */
const MINUIT_TRENTE_PARIS = new Date('2026-09-27T22:30:00.000Z');

let post: Record<string, unknown>;
let puts: Array<Record<string, unknown>>;

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function postPret(metadata: Record<string, unknown> = {}) {
  // Rangé au jour LOCAL du navigateur de test, pour être visible dans la grille.
  return {
    id: 'p1', user_id: 'u1', title: 'YOGA', caption: 'legende', status: 'draft',
    format: 'reel', media_type: 'video', media_url: 'https://cdn/montage.webm',
    scheduled_date: isoLocal(MINUIT_TRENTE_PARIS), scheduled_time: '12:00', platforms: ['instagram'],
    metadata: { renderedVideoUrl: 'https://cdn/montage.webm', ...metadata },
  };
}

function installerFetch() {
  puts = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
    } as unknown as Response);
    if (u.includes('/api/social')) return rep({ success: true, accounts: [], data: [] });
    if (u === '/api/posts' && m === 'PUT') {
      puts.push(JSON.parse(String(init?.body ?? '{}')));
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

const publierMaintenant = async () => {
  render(<Calendar />);
  await attendre(5);
  const jour = document.querySelector(`[data-day="${MINUIT_TRENTE_PARIS.getDate()}"]`);
  expect(jour, 'la case du jour doit exister').toBeTruthy();
  await act(async () => { fireEvent.click(jour!); await Promise.resolve(); });
  await attendre(5);
  const fp = bouton('fullPreview');
  expect(fp, "l'aperçu complet doit être atteignable").toBeTruthy();
  await act(async () => { fireEvent.click(fp!); await Promise.resolve(); });
  await attendre(5);
  const publier = document.querySelector('[data-publier]');
  expect(publier, '« Publier maintenant » doit exister').toBeTruthy();
  await act(async () => { fireEvent.click(publier!); });
  await attendre(20);
};

beforeEach(() => {
  // Seule l'horloge est figée : les setTimeout restent réels pour React.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MINUIT_TRENTE_PARIS);
  window.localStorage.clear();
  window.alert = () => {};
  window.confirm = () => true;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('Calendrier — « Publier maintenant » écrit la date du jour local', () => {
  it('à 00:30 heure de Paris, la date écrite est celle de Paris (28), pas la date UTC (27)', async () => {
    post = postPret();
    installerFetch();
    await publierMaintenant();
    expect(puts).toHaveLength(1);
    expect(puts[0].status).toBe('scheduled');
    expect(puts[0].scheduled_date).toBe('2026-09-28');
    expect(puts[0].scheduled_time).toBe('00:30');
  });

  it('respecte `metadata.timezone` du post, comme le cron', async () => {
    post = postPret({ timezone: 'America/New_York' });
    installerFetch();
    await publierMaintenant();
    expect(puts).toHaveLength(1);
    // 22:30 UTC = 18:30 à New York (EDT, UTC-4), le 27.
    expect(puts[0].scheduled_date).toBe('2026-09-27');
    expect(puts[0].scheduled_time).toBe('18:30');
  });
});
