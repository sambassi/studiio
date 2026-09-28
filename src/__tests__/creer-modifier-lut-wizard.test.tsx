/**
 * Le filtre couleur dans Modifier, sur le VRAI wizard.
 *
 * - rouvrir un post filtré réaffiche son filtre, et enregistrer sans rien
 *   toucher n'écrit rien (pas de « Régénérer » injustifié) ;
 * - retirer le filtre puis enregistrer écrit `lut: null` ET `montagePerime`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { CLE_MONTAGE_PERIME } from '../lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '../lib/creer/postMetadata';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('postId=post-42'),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';

const E = 'f'.repeat(64);
const REF = { empreinte: E, nom: 'teal', intensite: 0.8 };
const POST = {
  id: 'post-42',
  title: 'MON TITRE',
  caption: 'ma legende',
  status: 'draft',
  scheduled_date: '2026-09-01',
  platforms: ['instagram'],
  metadata: {
    subtitle: 'sous-titre',
    theme: 'sport',
    videoSize: { w: 1080, h: 1920 },
    renderedVideoUrl: 'https://exemple.test/montage.mp4',
    lut: REF,
  },
};

let patchs: Array<Record<string, unknown>>;

function installerFetch() {
  patchs = [];
  let courant: Record<string, unknown> = { ...POST };
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (u === '/api/creatif/luts' && m === 'GET') {
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, luts: [{
          empreinte: E, cle: `u/lut/${E}.cube`, nom: 'teal', titre: null, kind: '3d', origine: 'cube',
          taille: 2, octets: 100, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-09-14T00:00:00.000Z',
        }] }),
      } as Response;
    }
    if (u === '/api/posts/post-42' && m === 'PATCH') {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      patchs.push(corps);
      courant = { ...courant, metadata: mergePostMetadata(courant.metadata, corps.metadata ?? {}) };
    }
    const data = u.startsWith('/api/posts/post-42') ? courant : null;
    return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
  }) as unknown as typeof fetch;
}

const laisserTourner = async (n = 3) => {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
};
const cliquer = async (b: HTMLElement) => {
  await act(async () => { fireEvent.click(b); await Promise.resolve(); });
  await laisserTourner();
};
const ouvrirAmbiance = async () => {
  const versStyle = screen.queryByRole('button', { name: /Continuer vers Style/i });
  if (versStyle) await cliquer(versStyle);
  await cliquer(screen.getByRole('button', { name: /Ambiance/i }));
};
const enregistrer = () => screen.getByRole('button', { name: /Enregistrer les modifications/i });

beforeEach(() => { window.localStorage.clear(); installerFetch(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Modifier — le filtre couleur', () => {
  it('rouvrir un post filtré réaffiche le filtre ; enregistrer sans toucher n’écrit rien', async () => {
    render(<AssistantWizard />);
    await laisserTourner();
    await ouvrirAmbiance();
    expect(within(document.getElementById('section-ambiance')!).getByText('teal')).toBeDefined();

    await cliquer(enregistrer());
    expect(patchs).toHaveLength(1);
    const m = (patchs[0].metadata ?? {}) as Record<string, unknown>;
    expect('lut' in m).toBe(false);
    expect(m[CLE_MONTAGE_PERIME]).toBeUndefined();
  });

  it('⚠️ retirer le filtre puis enregistrer : `lut: null` et montage périmé', async () => {
    render(<AssistantWizard />);
    await laisserTourner();
    await ouvrirAmbiance();
    const section = within(document.getElementById('section-ambiance')!);
    await cliquer(section.getByRole('button', { name: /Retirer/i }));

    await cliquer(enregistrer());
    expect(patchs).toHaveLength(1);
    const m = patchs[0].metadata as Record<string, unknown>;
    expect(m).toHaveProperty('lut', null);
    expect(m[CLE_MONTAGE_PERIME]).toBe(true);
  });
});
