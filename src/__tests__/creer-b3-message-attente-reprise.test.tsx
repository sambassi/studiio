/**
 * B3 — le message d'attente fournisseur s'affiche AUSSI à la reprise au retour
 * sur la page et sur « Réessayer » (chemins qui ne passaient pas `onEtape`).
 * Avant : seul le clic d'envoi l'affichait.
 *
 * Tout est mocké : AUCUN fournisseur, AUCUN crédit, AUCUN appel payant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR } from '@/lib/creer/jumeau';

const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
const traitement = () => rep(200, { success: true, data: { status: 'processing', videoUrl: null } });
/** Le message que les lignes `failed` déjà en base portent (avant ce correctif). */
const ANCIEN_MESSAGE = 'La génération de votre avatar a échoué.';

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

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }, { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' }],
};
const GENERATION = '55555555-5555-4555-8555-000000000009';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GENERATION}.mp4`;
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

type Statut = 'processing' | 'attente' | 'completed' | 'failed' | '404' | '401';
let statut: Statut;
let trace: string[];

function installerFetch() {
  trace = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (u.startsWith('/api/avatar/status?generationId=')) {
      trace.push('status');
      if (statut === '404') return rep(404, { success: false, error: 'Generation introuvable.' });
      if (statut === '401') return rep(401, { success: false, error: 'Unauthorized' });
      if (statut === 'completed') return rep(200, { success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, error: null } });
      if (statut === 'attente') return rep(200, { success: true, data: { status: 'processing', videoUrl: null, enAttente: 'fournisseur' } });
      if (statut === 'failed') return rep(200, { success: true, data: { status: 'failed', videoUrl: null, error: ANCIEN_MESSAGE } });
      return traitement();
    }
    if (u === '/api/creer/jumeau/generer' && m === 'POST') { trace.push('generer'); return rep(200, { success: true, data: { generationId: GENERATION, status: 'pending', avatarVersion: 3 } }); }
    if (u === '/api/creer/jumeau') return rep(200, { success: true, data: PRET });
    if (u.includes('/api/credits/balance')) { trace.push('solde'); return rep(200, { ok: true, politique: 'credits', balance: 5000 }); }
    if (u.endsWith('/api/render/jobs') && m === 'POST') { trace.push('reservation'); return rep(200, { ok: true, jobId: 'job-1', uploadUrl: '/api/render/jobs/job-1/upload', uploadMode: 'relais', publicUrl: 'https://studiio.pro/storage/v1/object/public/media/u1/rendus/job-1.webm', cout: 10 }); }
    if (u.includes('/jobs/job-1/upload')) { trace.push('televersement'); return rep(200, {}); }
    if (u.includes('/api/render/jobs/job-1/confirm')) { trace.push('confirmation'); return rep(200, { ok: true, politique: 'credits', balance: 4990 }); }
    if (u.includes('/api/render/jobs/job-1/cancel')) { trace.push('annulation'); return rep(200, { ok: true }); }
    if (u.includes('/api/upload/signed-url')) return rep(200, { success: true, signedUrl: 'https://minio/vignette', publicUrl: 'https://cdn/v.jpg' });
    if (u.includes('/api/posts') && m === 'POST') { trace.push('post'); return rep(200, { success: true, post: { id: 'p1' } }); }
    if (/\/api\/avatar\/(create|sources|generate|did|consentement|validation)/.test(u) && m !== 'GET') { trace.push('entrainement'); return rep(200, { success: true }); }
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

beforeEach(() => { window.localStorage.clear(); statut = 'processing'; installerFetch(); });
// Toute boucle de suivi encore vivante s'éteint à sa prochaine lecture.
afterEach(() => { statut = '404'; cleanup(); vi.clearAllMocks(); });



const etape = () => document.querySelector('[data-jumeau-reprise-etape]')?.textContent ?? null;

describe('B3 — message d’attente fournisseur à la reprise et sur « Réessayer »', () => {
  it('⚠️ retour sur la page, génération en attente fournisseur → message affiché, aucun échec', async () => {
    statut = 'attente';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(etape()).toBe(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR));
    expect(document.querySelector('[data-jumeau-reprise]')).not.toBeNull();
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(trace).not.toContain('generer');
  });

  it('⚠️ « Réessayer » puis attente fournisseur → message affiché, une seule génération, aucun échec', async () => {
    statut = 'failed';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Réessayer$/ })).not.toBeNull());
    statut = 'attente';
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Réessayer$/ })); });
    await waitFor(() => expect(etape()).toBe(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR), { timeout: 9000 });
    expect(document.querySelector('[data-jumeau-erreur]')).toBeNull();
    expect(trace.filter((t) => t === 'generer')).toHaveLength(1);
  }, 20000);

  it('suivi ordinaire (sans attente) : aucune ligne d’étape en doublon du détail de phase', async () => {
    statut = 'processing';
    poser({ step: 0, jumeauMode: 'avatar', jumeauGenerationId: GENERATION });
    render(<AssistantWizard />);
    await laisser();
    await waitFor(() => expect(trace).toContain('status'));
    await laisser(10);
    expect(document.querySelector('[data-jumeau-reprise]')).not.toBeNull();
    expect(etape()).toBeNull();
  });
});
