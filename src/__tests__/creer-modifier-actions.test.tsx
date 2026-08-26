import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * Ce que l'ecran PROPOSE en modification, et ce qu'il refuse.
 *
 * Deux decisions sont verrouillees ici, et elles ont la meme racine : en
 * modification, un bouton qui compose est un bouton qui trahit.
 *
 * 1. **« Composer et envoyer » n'existe pas en modification.** Il fait un
 *    `POST /api/posts` : cliquer dessus en modifiant creerait un SECOND post,
 *    debiterait des credits, et laisserait l'original intact — l'utilisateur
 *    croirait avoir enregistre. Le masquer ne suffit pas : `runRender` refuse
 *    aussi de partir, pour qu'aucun chemin (raccourci, aperçu, telechargement)
 *    ne puisse composer.
 *
 * 2. **Un conflit (409) ne perd rien.** La version serveur ne peut reprendre
 *    la main que si on la demande, et seulement apres une confirmation
 *    explicite : ecraser des modifications a l'ecran sans le demander est
 *    exactement la perte silencieuse que toute cette phase combat.
 *
 * En creation, RIEN de tout cela ne s'applique : le parcours doit se comporter
 * comme avant, ce que le premier bloc verifie en propre.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlQuery,
}));

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>(
    '@/lib/fonts/catalog',
  );
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CONTENU = {
  title: 'TITRE SERVEUR',
  subtitle: 'sous-titre serveur',
  cards: [] as unknown[],
  cta: 'CTA',
  ctaSub: '',
};

function post(titre = 'TITRE SERVEUR') {
  return {
    id: 'post-42',
    title: titre,
    caption: 'ma legende',
    status: 'draft',
    scheduled_date: '2026-09-01',
    platforms: ['instagram'],
    metadata: { subtitle: 'sous-titre serveur', theme: 'sport' },
  };
}

let appels: Array<{ url: string; method: string }>;
/** Reponses jouees dans l'ordre pour `/api/posts/…`. La derniere se repete. */
let reponses: Array<{ status: number; corps?: unknown; reseau?: boolean }>;

function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = String(init?.method ?? 'GET').toUpperCase();
    appels.push({ url: u, method });
    const r = reponses.length > 1 ? reponses.shift()! : reponses[0];
    if (r.reseau) throw new Error('offline');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.corps ?? { success: true, data: post() },
    } as Response;
  }) as unknown as typeof fetch;
}

async function laisserTourner() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function ouvrir(postId?: string) {
  urlQuery = new URLSearchParams(postId === undefined ? '' : `postId=${postId}`);
  return render(<AssistantWizard />);
}

/** Brouillon de CREATION, pose a l'etape « contenu » — juste avant l'envoi. */
function poserBrouillonPretAEnvoyer() {
  window.localStorage.setItem(
    draftKey('a@b.c'),
    JSON.stringify({
      version: DRAFT_VERSION,
      savedAt: 1,
      started: true,
      step: 3,
      generated: CONTENU,
    }),
  );
}

/** Clique un bouton par son libelle, s'il existe. Rend `false` sinon. */
async function cliquer(motif: RegExp): Promise<boolean> {
  const b = screen.queryAllByRole('button', { name: motif })[0];
  if (!b) return false;
  await act(async () => { fireEvent.click(b); await Promise.resolve(); });
  return true;
}

/**
 * Amene le parcours jusqu'a l'etape « Envoi ».
 *
 * Les libelles different d'une etape a l'autre ; on les suit dans l'ordre, et
 * on ignore ceux qui ne s'appliquent pas (en creation, le brouillon depose
 * l'ecran directement a « contenu »).
 */
async function allerAEnvoi() {
  for (const motif of [/^Continuer/, /Suivant : audio/, /Générer le contenu/, /^Continuer/]) {
    // eslint-disable-next-line no-await-in-loop
    await cliquer(motif);
  }
  await laisserTourner();
}

beforeEach(() => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.localStorage.clear();
  reponses = [{ status: 200, corps: { success: true, data: post() } }];
  installerFetch();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('création normale — l\'envoi reste exactement ce qu\'il était', () => {
  it('« Composer et envoyer » est présent', async () => {
    poserBrouillonPretAEnvoyer();
    ouvrir();
    await laisserTourner();
    await allerAEnvoi();
    expect(screen.queryAllByRole('button', { name: /Composer et envoyer/i }).length)
      .toBeGreaterThan(0);
  });

  it('le téléchargement sur l\'ordinateur reste proposé', async () => {
    poserBrouillonPretAEnvoyer();
    ouvrir();
    await laisserTourner();
    await allerAEnvoi();
    expect(document.querySelector('[data-export-bureau]')).not.toBeNull();
  });

  it('aucune action de modification ne s\'invite dans la création', async () => {
    poserBrouillonPretAEnvoyer();
    ouvrir();
    await laisserTourner();
    await allerAEnvoi();
    expect(screen.queryByRole('button', { name: /Enregistrer les modifications/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('modification — une seule action, et rien qui compose', () => {
  it('« Composer et envoyer » est absent', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await allerAEnvoi();
    expect(screen.queryByRole('button', { name: /Composer et envoyer/i })).toBeNull();
  });

  it('« Enregistrer les modifications » est la seule action principale', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await allerAEnvoi();
    expect(screen.queryAllByRole('button', { name: /Enregistrer les modifications/i }).length)
      .toBe(1);
  });

  it('ni téléchargement, ni bouton de rendu : aucune porte vers la composition', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await allerAEnvoi();
    expect(document.querySelector('[data-export-bureau]')).toBeNull();
    expect(document.querySelector('[data-play-rendu]')).toBeNull();
  });

  it('aucune création, aucun débit, aucune publication n\'est jamais appelée', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await allerAEnvoi();
    // On clique TOUT ce que l'écran propose : rien ne doit composer.
    const boutons = screen.queryAllByRole('button');
    for (const b of boutons) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.click(b); await Promise.resolve(); });
    }
    const interdits = appels.filter((a) =>
      (a.url === '/api/posts' && a.method === 'POST')
      || a.url.startsWith('/api/credits/deduct')
      || a.url.startsWith('/api/render')
      || a.url.startsWith('/api/social/publish'));
    expect(interdits).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('enregistrement — le PATCH fonctionne toujours', () => {
  it('le clic envoie un PATCH, et un seul', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner();
    const patchs = appels.filter((a) => a.method === 'PATCH');
    expect(patchs).toHaveLength(1);
    expect(patchs[0].url).toBe('/api/posts/post-42');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('conflit 409 — rien n\'est perdu sans un accord explicite', () => {
  /** Charge le post, puis provoque un 409 sur l'enregistrement. */
  async function provoquerConflit() {
    reponses = [
      { status: 200, corps: { success: true, data: post('TITRE SERVEUR') } },
      { status: 409, corps: { success: false, error: 'conflit' } },
    ];
    installerFetch();
    ouvrir('post-42');
    await laisserTourner();
    await cliquer(/Enregistrer les modifications/i);
    await laisserTourner();
  }

  it('le formulaire est conservé tel quel', async () => {
    await provoquerConflit();
    expect(document.body.textContent).toContain('TITRE SERVEUR');
  });

  it('le message dit que rien n\'a été enregistré', async () => {
    await provoquerConflit();
    expect(document.body.textContent).toMatch(/modifié ailleurs/i);
  });

  it('un vrai bouton « Recharger la version récente » est proposé', async () => {
    await provoquerConflit();
    expect(screen.queryByRole('button', { name: /Recharger la version récente/i })).not.toBeNull();
  });

  it('aucun PATCH n\'est rejoué tout seul', async () => {
    await provoquerConflit();
    await laisserTourner();
    expect(appels.filter((a) => a.method === 'PATCH')).toHaveLength(1);
  });

  it('sans confirmation, rien n\'est rechargé et rien n\'est perdu', async () => {
    await provoquerConflit();
    const avant = appels.filter((a) => a.method === 'GET').length;
    await cliquer(/Recharger la version récente/i);
    await laisserTourner();
    // Le clic demande confirmation ; il ne va PAS chercher le serveur.
    expect(appels.filter((a) => a.method === 'GET').length).toBe(avant);
    expect(document.body.textContent).toContain('TITRE SERVEUR');
    expect(screen.queryByRole('button', { name: /Confirmer le rechargement/i })).not.toBeNull();
  });

  it('après confirmation, la version serveur reprend la main', async () => {
    await provoquerConflit();
    reponses = [{ status: 200, corps: { success: true, data: post('TITRE PLUS RECENT') } }];
    await cliquer(/Recharger la version récente/i);
    await cliquer(/Confirmer le rechargement/i);
    await laisserTourner();
    await laisserTourner();
    expect(document.body.textContent).toContain('TITRE PLUS RECENT');
  });

  it('un rechargement qui échoue ne coûte pas le travail à l\'écran', async () => {
    await provoquerConflit();
    reponses = [{ status: 0, reseau: true }];
    await cliquer(/Recharger la version récente/i);
    await cliquer(/Confirmer le rechargement/i);
    await laisserTourner();
    await laisserTourner();
    expect(document.body.textContent).toContain('TITRE SERVEUR');
    expect(document.body.textContent).toMatch(/rechargement/i);
  });
});
