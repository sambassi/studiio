/**
 * Calendrier — « Publier maintenant » et « Planifier » refusent un montage
 * périmé (`metadata.montagePerime === true`, posé par Modifier → Enregistrer).
 *
 * Les deux actions ne recomposent que si AUCUNE vidéo n'existe : sur un post
 * déjà rendu puis modifié, elles programmeraient l'ANCIEN `renderedVideoUrl`.
 * Elles doivent donc afficher le message, sans fetch, sans rendu, sans débit.
 *
 * Default safe : sans drapeau (ou `false`), rien ne change. Après
 * « Régénérer », le drapeau tombe et la publication repasse.
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

const MONTAGE = () => new Blob([new Uint8Array(4096)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async () => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }),
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
let appels: Array<{ url: string; methode: string; corps: string }>;

function installerFetch() {
  patchs = [];
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    appels.push({ url: u, methode: m, corps: String(init?.body ?? '') });
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
const publierMaintenant = () => document.querySelector('[data-publier]') as HTMLButtonElement | null;
const programmer = () => document.querySelector('[data-programmer]') as HTMLButtonElement | null;
let alertes: string[] = [];

/** Toute écriture qui publierait/programmerait, ou lancerait un rendu. */
const ecrituresDePublication = () => appels.filter((a) =>
  (a.url.includes('/api/posts') && a.methode === 'PUT')
  || a.url.includes('/api/render/jobs')
  || a.url.includes('/api/social/publish'));


beforeEach(() => {
  window.localStorage.clear();
  alertes = [];
  window.alert = (m?: unknown) => { alertes.push(String(m)); };
  window.confirm = () => true;
  (HTMLAnchorElement.prototype as unknown as { click: () => void }).click = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const MESSAGE = 'Cette vidéo a été modifiée. Régénère-la avant de la publier.';

describe('Calendrier — publication d’un montage périmé', () => {
  it('« Publier maintenant » sur un post périmé : message, aucun fetch de publication ni rendu', async () => {
    post = postAJour({ montagePerime: true });
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    expect(publierMaintenant()).not.toBeNull();
    await act(async () => { fireEvent.click(publierMaintenant()!); });
    await attendre(20);
    expect(alertes).toContain(MESSAGE);
    expect(ecrituresDePublication()).toEqual([]);
  });

  it('« Planifier » sur un post périmé : message, aucun fetch de programmation ni rendu', async () => {
    post = postAJour({ montagePerime: true });
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    expect(programmer()).not.toBeNull();
    await act(async () => { fireEvent.click(programmer()!); });
    await attendre(20);
    expect(alertes).toContain(MESSAGE);
    expect(ecrituresDePublication()).toEqual([]);
  });

  it('default safe : sans drapeau, « Publier maintenant » programme l’URL rendue comme avant', async () => {
    post = postAJour();
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    await act(async () => { fireEvent.click(publierMaintenant()!); });
    await attendre(20);
    expect(alertes).not.toContain(MESSAGE);
    const puts = appels.filter((a) => a.url.includes('/api/posts') && a.methode === 'PUT');
    expect(puts).toHaveLength(1);
    const corps = JSON.parse(puts[0].corps);
    expect(corps.status).toBe('scheduled');
    expect(corps.metadata.renderedVideoUrl).toBe('https://cdn/ancien.webm');
    // Aucun rendu : la vidéo existait déjà.
    expect(appels.some((a) => a.url.includes('/api/render/jobs'))).toBe(false);
  });

  it('`montagePerime: false` : « Planifier » programme comme avant', async () => {
    post = postAJour({ montagePerime: false });
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    await act(async () => { fireEvent.click(programmer()!); });
    await attendre(20);
    expect(alertes).not.toContain(MESSAGE);
    const puts = appels.filter((a) => a.url.includes('/api/posts') && a.methode === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0].corps).status).toBe('scheduled');
  });

  it('après « Régénérer » (drapeau à false), « Publier maintenant » programme le NOUVEAU montage', async () => {
    post = postAJour({ montagePerime: true });
    installerFetch();
    await ouvrirApercu();
    await act(async () => { fireEvent.click(regenerer()!); });
    await attendre(80);
    expect(patchs).toHaveLength(1);
    const nouveau = (patchs[0].metadata as Record<string, unknown>).renderedVideoUrl;
    expect(nouveau).not.toBe('https://cdn/ancien.webm');
    appels.length = 0;
    alertes = [];
    await act(async () => { fireEvent.click(publierMaintenant()!); });
    await attendre(20);
    expect(alertes).not.toContain(MESSAGE);
    const puts = appels.filter((a) => a.url.includes('/api/posts') && a.methode === 'PUT');
    expect(puts).toHaveLength(1);
    const corps = JSON.parse(puts[0].corps);
    expect(corps.status).toBe('scheduled');
    expect(corps.metadata.montagePerime).toBe(false);
    expect(corps.metadata.renderedVideoUrl).toBe(nouveau);
  });
});

const MESSAGE_SERVEUR = 'Cette vidéo a été modifiée après son rendu automatique et ne peut pas être régénérée ici. '
  + 'Ouvre-la dans le Calendrier et choisis « Garder la vidéo actuelle » pour la publier sans tes modifications.';
const garder = () => document.querySelector('[data-garder-montage]') as HTMLButtonElement | null;

describe('Calendrier — montage SERVEUR périmé (Autopilote) : jamais d’impasse', () => {
  it('« Régénérer » reste masqué (#313) mais « Garder la vidéo actuelle » est visible', async () => {
    post = postAJour({ montagePerime: true, serverRendered: true });
    installerFetch();
    await ouvrirApercu();
    expect(regenerer()).toBeNull();
    expect(garder()).not.toBeNull();
  });

  it('« Réessayer » (post en échec) est bloqué avec un message qui nomme l’issue réelle', async () => {
    post = { ...postAJour({ montagePerime: true, serverRendered: true, error: MESSAGE_SERVEUR }), status: 'failed' };
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    const reessayer = bouton('Réessayer la publication');
    expect(reessayer).toBeTruthy();
    await act(async () => { fireEvent.click(reessayer!); });
    await attendre(20);
    expect(alertes).toContain(MESSAGE_SERVEUR);
    expect(alertes).not.toContain(MESSAGE);
    expect(ecrituresDePublication()).toEqual([]);
  });

  it('« Garder la vidéo actuelle » lève le blocage (après confirmation), sans rendu, puis la publication passe', async () => {
    post = { ...postAJour({ montagePerime: true, serverRendered: true, error: MESSAGE_SERVEUR }), status: 'failed' };
    installerFetch();
    await ouvrirApercu();
    appels.length = 0;
    await act(async () => { fireEvent.click(garder()!); });
    await attendre(20);
    expect(patchs).toHaveLength(1);
    expect(patchs[0]).toEqual({ metadata: { montagePerime: false, error: null } });
    expect(appels.some((a) => a.url.includes('/api/render/jobs'))).toBe(false);
    // Le bouton disparaît : le post n'est plus périmé.
    expect(garder()).toBeNull();

    appels.length = 0;
    alertes = [];
    await act(async () => { fireEvent.click(bouton('Réessayer la publication')!); });
    await attendre(20);
    expect(alertes).not.toContain(MESSAGE_SERVEUR);
    const puts = appels.filter((a) => a.url.includes('/api/posts') && a.methode === 'PUT');
    expect(puts).toHaveLength(1);
    const corps = JSON.parse(puts[0].corps);
    expect(corps.status).toBe('scheduled');
    expect(corps.metadata.montagePerime).toBe(false);
    // Aucun rendu navigateur : le mp4 serveur est conservé.
    expect(appels.some((a) => a.url.includes('/api/render/jobs'))).toBe(false);
  });

  it('confirmation refusée : rien n’est écrit, le blocage reste', async () => {
    post = postAJour({ montagePerime: true, serverRendered: true });
    installerFetch();
    await ouvrirApercu();
    window.confirm = () => false;
    await act(async () => { fireEvent.click(garder()!); });
    await attendre(10);
    expect(patchs).toHaveLength(0);
    expect(garder()).not.toBeNull();
  });

  it('un post navigateur périmé n’a PAS le bouton « Garder » (Régénérer suffit)', async () => {
    post = postAJour({ montagePerime: true });
    installerFetch();
    await ouvrirApercu();
    expect(garder()).toBeNull();
    expect(regenerer()).not.toBeNull();
  });
});

describe('Calendrier — « Régénérer » retire l’erreur du blocage, et elle seule', () => {
  it('erreur = message de blocage → retirée', async () => {
    post = postAJour({ montagePerime: true, error: MESSAGE });
    installerFetch();
    await ouvrirApercu();
    await act(async () => { fireEvent.click(regenerer()!); });
    await attendre(80);
    const meta = patchs[0].metadata as Record<string, unknown>;
    expect(meta.montagePerime).toBe(false);
    expect(meta.error).toBeNull();
  });

  it('une autre erreur est conservée', async () => {
    post = postAJour({ montagePerime: true, error: 'Instagram: jeton expiré' });
    installerFetch();
    await ouvrirApercu();
    await act(async () => { fireEvent.click(regenerer()!); });
    await attendre(80);
    const meta = patchs[0].metadata as Record<string, unknown>;
    expect(meta.error).toBe('Instagram: jeton expiré');
  });
});
