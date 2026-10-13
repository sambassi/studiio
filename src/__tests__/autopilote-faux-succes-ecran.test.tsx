import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * « Produire un brouillon maintenant » AVEC l'avatar : l'écran ne dit
 * « déposé dans le Calendrier » qu'avec un post prouvé par le serveur
 * (prod 2026-10-13 : faux succès, Calendrier vide). Le VRAI panneau est monté,
 * l'API est doublée.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AutopilotPanel from '../components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, type AutopilotConfig } from '../lib/autopilot/rules';

let enBase: AutopilotConfig;
/** Réponse du POST de production, et état relu par `/progression`. */
let reponsePost: Record<string, unknown>;
let suivi: Record<string, unknown> | null;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const ok = (corps: unknown) => ({ ok: true, status: 200, json: async () => corps }) as unknown as Response;
    if (u.includes('/api/autopilot/config')) {
      return ok({ success: true, ready: true, brandingReady: true, publishTimeReady: true, startDateReady: true, config: enBase });
    }
    if (u.includes('/produire-maintenant/progression')) return ok({ success: true, progression: null, resultat: null, jumeau: suivi });
    if (u.includes('/api/autopilot/produire-maintenant')) {
      if (init?.method === 'POST') {
        // La production démarre : la file existe à partir de maintenant.
        if (reponsePost.jumeau === 'en_preparation') suivi = { etat: 'en_preparation', jobId: 'autopilote-manuel-u-2026-10-13-1135' };
        return ok(reponsePost);
      }
      return ok({ success: true, politique: 'credits', cout: 50, solde: 120, enCours: false });
    }
    return ok({ ok: true, success: true, sessions: [], luts: [], items: [], voices: [] });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  enBase = { ...DEFAULT_CONFIG, rushUrls: ['https://x/a.mp4'], runTimezone: 'Europe/Paris' };
  reponsePost = {
    success: true, jumeau: 'en_preparation', message: 'Votre avatar se prépare.', jobId: 'autopilote-manuel-u-2026-10-13-1135',
    scheduledDate: '2026-10-13', scheduledTime: '11:35', timezone: 'Europe/Paris', status: 'draft', platforms: [], cout: 50,
  };
  suivi = null;
  stubApi();
});
afterEach(() => { cleanup(); });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

async function produire() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="3"]')!);
  await waitFor(() => expect(q('[data-autopilot-produire-maintenant]')).not.toBeNull());
  fireEvent.click(q('[data-autopilot-produire-maintenant]')!);
  await waitFor(() => expect(q('[data-autopilot-produire-confirmer]')).not.toBeNull());
  await act(async () => { fireEvent.click(q('[data-autopilot-produire-confirmer]')!); });
}

describe('avatar en préparation : jamais « déposé » sans post', () => {
  it('rechargement de page pendant la préparation : l’écran la RETROUVE, sans proposer une seconde production', async () => {
    suivi = { etat: 'en_preparation', jobId: 'j' };
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="3"]')!);
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    expect(q('[data-autopilot-produire-maintenant]')).toBeNull();
  });

  it('réponse 200 sans postId → « se prépare », AUCUN message de dépôt', async () => {
    await produire();
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    expect(q('[data-autopilot-produire-resultat]')).toBeNull();
    expect(document.body.textContent).not.toContain('Brouillon déposé dans le Calendrier');
    expect(q('[data-autopilot-produire-jumeau]')!.textContent).toContain('pas encore dans le Calendrier');
  });

  it('le serveur PROUVE le dépôt → « déposé », avec le post et sa date', async () => {
    await produire();
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    suivi = { etat: 'depose', jobId: 'j', sansAvatar: false, post: { postId: 'post-42', scheduledDate: '2026-10-13', scheduledTime: '11:35', status: 'draft', videoUrl: 'https://x/v.mp4' } };
    await waitFor(() => expect(q('[data-autopilot-produire-resultat]')).not.toBeNull(), { timeout: 5000 });
    expect(q('[data-autopilot-produire-resultat]')!.getAttribute('data-post-id')).toBe('post-42');
    expect(q('[data-autopilot-produire-resultat]')!.textContent).toContain('11:35');
  });

  it('échec du jumeau → erreur claire, pas de faux succès', async () => {
    await produire();
    await waitFor(() => expect(q('[data-autopilot-produire-jumeau]')).not.toBeNull());
    suivi = { etat: 'echec', jobId: 'j', message: 'La vidéo avec votre avatar n’a pas pu être préparée : aucun brouillon n’a été déposé.' };
    await waitFor(() => expect(q('[data-autopilot-produire-erreur]')).not.toBeNull(), { timeout: 5000 });
    expect(q('[data-autopilot-produire-resultat]')).toBeNull();
    expect(q('[data-autopilot-produire-erreur]')!.textContent).toContain('aucun brouillon');
  });

  it('succès sans postId ni jumeau → erreur, jamais « déposé »', async () => {
    reponsePost = { success: true, scheduledDate: '2026-10-13', scheduledTime: '11:35' };
    await produire();
    await waitFor(() => expect(q('[data-autopilot-produire-erreur]')).not.toBeNull());
    expect(q('[data-autopilot-produire-resultat]')).toBeNull();
  });
});
