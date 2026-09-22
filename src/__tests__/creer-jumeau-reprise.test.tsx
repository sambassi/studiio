/**
 * BUG B — REPRISE d'une génération de jumeau orpheline, au montage.
 *
 * La vidéo du jumeau était produite DANS le clic d'envoi, par une boucle de
 * polling de 5-20 min. Fermer la page pendant ce temps laissait la génération
 * orpheline : jamais montée, aucune reprise, aucune erreur — « mon jumeau ne
 * fonctionne pas dans la vidéo ».
 *
 * Désormais l'identifiant est persisté dès le lancement (`jumeauGenerationId`).
 * Au remontage de l'assistant, si le brouillon le porte et que le rush n'est
 * pas déjà celui du jumeau, on REPREND le suivi via `/api/avatar/status` :
 *   - `completed` → la vidéo est posée comme rush, le drapeau est effacé ;
 *   - `failed`    → message `data-jumeau-erreur` + bouton « Réessayer » ;
 *   - déjà posé   → rien à reprendre, aucun poll.
 *
 * Tout est mocké ; AUCUNE génération réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (cards: unknown) => cards }));

// La sonde de durée du rush attend `loadedmetadata` (jamais émis par jsdom) :
// on publie une durée réelle dès `load()`.
const DUREE = 7;
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value(this: HTMLMediaElement) {
    if (!this.getAttribute('src')) return;
    Object.defineProperty(this, 'duration', { configurable: true, value: DUREE });
    setTimeout(() => this.onloadedmetadata?.(new Event('loadedmetadata')), 0);
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const GEN = 'gen-abc-000000000001';
const URL_JUMEAU = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GEN}.mp4`;
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Réveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }],
};
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 0 }, moteurDisponible: true, messageMoteur: null };

let statut: 'completed' | 'failed' | 'processing';
let statusAppels: number;
let generAppels: number;

function installerFetch() {
  statusAppels = 0;
  generAppels = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    const rep = (corps: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corps } as Response);
    if (u.startsWith('/api/avatar/status?generationId=')) {
      statusAppels += 1;
      expect(u).toBe(`/api/avatar/status?generationId=${GEN}`);
      if (statut === 'completed') return rep({ success: true, data: { status: 'completed', videoUrl: URL_JUMEAU, error: null } });
      if (statut === 'failed') return rep({ success: true, data: { status: 'failed', videoUrl: null, error: 'Le fournisseur a échoué.' } });
      return rep({ success: true, data: { status: 'processing', videoUrl: null } });
    }
    if (u === '/api/creer/jumeau/generer' && m === 'POST') {
      generAppels += 1;
      return rep({ success: true, data: { generationId: GEN, status: 'pending', avatarVersion: 3 } });
    }
    if (u === '/api/creer/jumeau') return rep({ success: true, data: PRET });
    if (u === '/api/voice/clone') return rep({ success: true, voices: [{ id: 'elevenlabs-abc', accountVoiceId: 'v', name: 'Bassi' }] });
    if (u.includes('/api/autopilot/config')) return rep({ success: true, ready: true, brandingReady: true, config: {} });
    return rep({ success: true, ok: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

/** Pose un brouillon avec une génération de jumeau EN ATTENTE. */
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 0,
    jumeauMode: 'avatar', jumeauGenerationId: GEN,
    customTopic: 'yoga du matin', generated: CONTENU, ...extra,
  }));
};

const monter = async () => {
  render(<AssistantWizard />);
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

beforeEach(() => { window.localStorage.clear(); statut = 'processing'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Reprise au montage d’une génération de jumeau orpheline', () => {
  it('⚠️ `completed` → la vidéo est reprise et posée comme rush ; le brouillon ne porte plus la génération', async () => {
    installerFetch(); statut = 'completed'; poser();
    await monter();
    // Le suivi a été REPRIS (poll), sans relancer une génération.
    expect(statusAppels).toBeGreaterThan(0);
    expect(generAppels).toBe(0);
    // La vidéo du jumeau est montée : le message le dit.
    await waitFor(() => expect(document.querySelector('[data-jumeau-notice]')).not.toBeNull());
    // Le brouillon relit : rush posé, génération effacée, mode revenu à 'aucun'.
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const b = JSON.parse(window.localStorage.getItem(CLE)!);
    expect(b.rushUrl).toBe(URL_JUMEAU);
    expect(b.jumeauGenerationId).toBeUndefined();
    expect(b.jumeauMode).toBe('aucun');
  });

  it('⚠️ `failed` → message data-jumeau-erreur + bouton « Réessayer » qui relance une génération EN FOND', async () => {
    installerFetch(); statut = 'failed'; poser();
    await monter();
    expect(statusAppels).toBeGreaterThan(0);
    const banniere = document.querySelector('[data-jumeau-erreur]');
    expect(banniere).not.toBeNull();
    const reessayer = screen.getByRole('button', { name: /Réessayer/i });
    // Sur « Réessayer », une NOUVELLE génération part (generer), puis se pose.
    statut = 'completed';
    await act(async () => { fireEvent.click(reessayer); });
    for (let i = 0; i < 20; i += 1) { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
    expect(generAppels).toBe(1);
    await waitFor(() => expect(document.querySelector('[data-jumeau-notice]')).not.toBeNull());
  });

  it('⚠️ rush déjà celui du jumeau → aucune reprise, aucun poll (pas de double travail)', async () => {
    installerFetch(); statut = 'completed';
    poser({ rushUrl: URL_JUMEAU, rushName: 'Mon jumeau' });
    await monter();
    expect(statusAppels).toBe(0);
    expect(generAppels).toBe(0);
    // Le drapeau est effacé du brouillon puisqu'il n'y a plus rien à reprendre.
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(JSON.parse(window.localStorage.getItem(CLE)!).jumeauGenerationId).toBeUndefined();
  });

  it('un brouillon SANS génération en attente ne déclenche aucun poll — comportement d’avant', async () => {
    installerFetch(); statut = 'completed';
    poser({ jumeauMode: 'aucun', jumeauGenerationId: undefined });
    await monter();
    expect(statusAppels).toBe(0);
  });
});
