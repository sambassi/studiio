/**
 * ANCIEN BROUILLON CRÉER — une vidéo de jumeau d'une ANCIENNE version de
 * l'avatar est SIGNALÉE, jamais remplacée.
 *
 * Brouillon : rush = vidéo de jumeau générée en v2. Avatar actif : v3.
 *   → « Cette vidéo utilise une ancienne version de votre avatar. »
 *   → « Garder cette vidéo » : avertissement retiré, rush intact ;
 *   → « Régénérer avec l'avatar actif » : la génération n'est lancée QUE sur
 *     ce clic — jamais au chargement, jamais automatiquement.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUN crédit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));
const MONTAGE = () => new Blob([new Uint8Array(2048)], { type: 'video/webm' });
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  const compose = async () => ({ video: MONTAGE(), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) });
  const upload = async () => ({ blob: MONTAGE(), url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1' });
  return { ...actual, composeVideo: compose, composeAndUpload: upload, uploadRendu: upload, downloadBlob: async () => {} };
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value(this: HTMLMediaElement) {
    if (!this.getAttribute('src')) return;
    Object.defineProperty(this, 'duration', { configurable: true, value: 8 });
    setTimeout(() => this.onloadedmetadata?.(new Event('loadedmetadata')), 0);
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });
if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:montage';
if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }, { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' }],
};
const GENERATION = '55555555-5555-4555-8555-000000000009';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GENERATION}.mp4`;
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03', fournisseur: 'heygen' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

let versionRush: number | null;
let trace: string[];

function installerFetch() {
  trace = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (u.startsWith('/api/avatar/status?generationId=')) {
      trace.push('status');
      return rep(200, { success: true, data: { generationId: GENERATION, status: 'completed', videoUrl: URL_JUMEAU, error: null, ...(versionRush === null ? {} : { avatarVersion: versionRush }) } });
    }
    if (u === '/api/creer/jumeau/generer' && m === 'POST') { trace.push('generer'); return rep(200, { success: true, data: { generationId: 'nouvelle', status: 'pending', avatarVersion: 3 } }); }
    if (u === '/api/creer/jumeau') return rep(200, { success: true, data: PRET });
    if (m === 'POST' && (u.includes('/api/render/jobs') || u.includes('/api/posts') || u.includes('/api/credits'))) trace.push('paiement-ou-post');
    if (u.includes('/api/autopilot/config')) return rep(200, { success: true, ready: true, brandingReady: true, config: {} });
    return rep(200, { success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

const poser = (extra: Record<string, unknown>) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01', ...extra,
  }));
};
const laisser = async (n = 20) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const avertissement = () => document.querySelector('[data-jumeau-ancienne-version]');
const rushDuBrouillon = () => JSON.parse(window.localStorage.getItem(CLE) ?? '{}').rushUrl;

beforeEach(() => { window.localStorage.clear(); versionRush = 2; installerFetch(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('brouillon Créer : vidéo de jumeau v2, avatar actif v3', () => {
  it('⚠️ avertissement affiché, avec les deux versions ; AUCUNE génération, AUCUN débit au chargement', async () => {
    poser({ step: 0, rushUrl: URL_JUMEAU, rushName: 'Mon jumeau (v2)' });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(avertissement()).not.toBeNull());
    expect(avertissement()!.getAttribute('data-jumeau-ancienne-version')).toBe('2');
    expect(avertissement()!.textContent).toContain('Cette vidéo utilise une ancienne version de votre avatar.');
    expect(avertissement()!.textContent).toContain('Créé avec Avatar v2');
    expect(avertissement()!.textContent).toContain('Avatar actif · v3');
    expect(trace).not.toContain('generer');
    expect(trace).not.toContain('paiement-ou-post');
  });

  it('⚠️ « Garder cette vidéo » : avertissement retiré, le rush n’est PAS modifié, rien n’est lancé', async () => {
    poser({ step: 0, rushUrl: URL_JUMEAU, rushName: 'Mon jumeau (v2)' });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(avertissement()).not.toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Garder cette vidéo' })); });
    await laisser(5);
    expect(avertissement()).toBeNull();
    expect(rushDuBrouillon()).toBe(URL_JUMEAU);
    expect(trace).not.toContain('generer');
  });

  it('⚠️ « Régénérer avec l’avatar actif » : la génération part SEULEMENT sur ce clic, une fois', async () => {
    poser({ step: 0, rushUrl: URL_JUMEAU, rushName: 'Mon jumeau (v2)' });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(avertissement()).not.toBeNull());
    await laisser(10);
    expect(trace).not.toContain('generer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Régénérer avec l’avatar actif/ })); });
    await waitFor(() => expect(trace.filter((t) => t === 'generer')).toHaveLength(1));
    expect(avertissement()).toBeNull();
  });

  it('même version (v3 = v3) : aucun avertissement', async () => {
    versionRush = 3;
    poser({ step: 0, rushUrl: URL_JUMEAU, rushName: 'Mon jumeau (v3)' });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(trace).toContain('status'));
    await laisser(5);
    expect(avertissement()).toBeNull();
  });

  it('version inconnue (génération antérieure au versionnement) : aucun avertissement — on n’avertit que sur une preuve', async () => {
    versionRush = null;
    poser({ step: 0, rushUrl: URL_JUMEAU });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(trace).toContain('status'));
    await laisser(5);
    expect(avertissement()).toBeNull();
  });

  it('rush qui n’est pas une vidéo de jumeau : aucune lecture de statut, aucun avertissement', async () => {
    poser({ step: 0, rushUrl: 'https://studiio.pro/storage/v1/object/public/media/u1/rushes/plage.mp4' });
    render(<AssistantWizard />);
    await laisser();
    expect(trace).not.toContain('status');
    expect(avertissement()).toBeNull();
  });
});
