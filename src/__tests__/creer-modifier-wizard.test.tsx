import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

/**
 * Modification d'un contenu existant — vérifiée sur le VRAI wizard.
 *
 * Le dépôt a déjà appris qu'une couche testée par expressions régulières
 * « fonctionne sur le papier » et échoue en vrai (`creer-simple-draft-behaviour`).
 * Ces tests montent donc le composant, pilotent la session comme le fait
 * next-auth, et regardent ce que l'utilisateur voit.
 *
 * Ce qu'ils verrouillent :
 *
 * 1. **La création normale ne bouge pas.** Sans `postId` dans l'URL, AUCUN
 *    appel à `/api/posts/…` n'est émis. C'est la garantie qui protège le
 *    parcours existant : tout ce lot doit être inerte quand on crée.
 * 2. **Un contenu existant ne s'affiche jamais comme un montage vierge.**
 *    Pendant le chargement puis en cas d'échec, le parcours n'est pas rendu.
 * 3. **Le refus est visible.** Le contenu d'un autre utilisateur (404 côté
 *    serveur, qui filtre sur `user_id`) donne un message, pas un écran vide.
 * 4. **Rien n'est déclenché au chargement** : aucun rendu, aucun débit, aucune
 *    publication, aucune programmation.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };
/** L'URL vue par le wizard. Vide = aucun paramètre, donc une création. */
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

// Le wizard lit l'identifiant a modifier dans l'URL, comme l'editeur avance.
vi.mock('next/navigation', () => ({
  useSearchParams: () => urlQuery,
}));

/** Ouvre le wizard sur ce lien. Sans argument : une nouvelle création. */
function ouvrir(postId?: string) {
  urlQuery = new URLSearchParams(postId === undefined ? '' : `postId=${postId}`);
  return render(<AssistantWizard />);
}

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>(
    '@/lib/fonts/catalog',
  );
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';

const POST = {
  id: 'post-42',
  title: 'MON TITRE',
  caption: 'ma legende',
  status: 'draft',
  scheduled_date: '2026-09-01',
  platforms: ['instagram'],
  metadata: { subtitle: 'sous-titre', theme: 'sport' },
};

let appels: Array<{ url: string; method: string }>;

function installerFetch(reponse: (url: string) => { status: number; corps: unknown }) {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: String(init?.method ?? 'GET').toUpperCase() });
    const r = reponse(u);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.corps,
    } as Response;
  }) as unknown as typeof fetch;
}

/** Laisse les effets et les promesses du chargement se dérouler. */
async function laisserTourner() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.localStorage.clear();
  installerFetch(() => ({ status: 200, corps: { success: true, data: POST } }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('création normale — strictement inchangée', () => {
  it('sans identifiant, aucun contenu n\'est chargé', async () => {
    ouvrir();
    await laisserTourner();
    expect(appels.filter((a) => a.url.startsWith('/api/posts'))).toEqual([]);
  });

  it('sans identifiant, le parcours est rendu tout de suite', async () => {
    ouvrir();
    await laisserTourner();
    expect(screen.queryByText('Chargement de votre contenu…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('propriétaire autorisé', () => {
  it('le contenu est demandé au serveur, une seule fois, en GET', async () => {
    ouvrir('post-42');
    await laisserTourner();
    const lectures = appels.filter((a) => a.url.startsWith('/api/posts'));
    expect(lectures).toEqual([{ url: '/api/posts/post-42', method: 'GET' }]);
  });

  it('pendant le chargement, le parcours vierge n\'est jamais affiché', async () => {
    // Une promesse qui ne se resout pas : on observe l'ecran PENDANT l'attente.
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    ouvrir('post-42');
    await laisserTourner();
    expect(screen.getByText('Chargement de votre contenu…')).toBeTruthy();
  });

  it('une fois chargé, l\'écran d\'attente disparaît', async () => {
    ouvrir('post-42');
    await laisserTourner();
    expect(screen.queryByText('Chargement de votre contenu…')).toBeNull();
  });
});

describe('contenu d\'un autre utilisateur', () => {
  it('un 404 affiche un refus, pas un montage vierge', async () => {
    installerFetch(() => ({ status: 404, corps: { success: false, error: 'Post not found' } }));
    ouvrir('post-dautrui');
    await laisserTourner();
    expect(screen.getByRole('alert').textContent)
      .toContain('Ce contenu est introuvable, ou ne vous appartient pas.');
  });

  it('un 403 affiche le même refus', async () => {
    installerFetch(() => ({ status: 403, corps: { success: false, error: 'Forbidden' } }));
    ouvrir('post-dautrui');
    await laisserTourner();
    expect(screen.getByRole('alert').textContent)
      .toContain('Ce contenu est introuvable, ou ne vous appartient pas.');
  });

  it('aucune donnée du contenu refusé n\'apparaît à l\'écran', async () => {
    installerFetch(() => ({
      status: 403,
      corps: { success: false, error: 'Forbidden', data: POST },
    }));
    ouvrir('post-dautrui');
    await laisserTourner();
    expect(document.body.textContent).not.toContain('MON TITRE');
  });

  it('une session expirée demande de se reconnecter', async () => {
    installerFetch(() => ({ status: 401, corps: { success: false } }));
    ouvrir('post-42');
    await laisserTourner();
    expect(screen.getByRole('alert').textContent).toContain('Votre session a expiré');
  });
});

describe('aucun effet de bord au chargement', () => {
  /**
   * LE test de cette exigence, et il est volontairement écrit comme une
   * interdiction GÉNÉRALE plutôt que comme une liste d'URL.
   *
   * Une liste (« pas de `/api/credits/deduct`, pas de `/api/render`… ») ne
   * protège que de ce qu'on a pensé à y mettre : la route qui débiterait
   * demain sous un autre nom passerait au travers. « Aucune écriture, sur
   * aucune route » couvre d'un coup le rendu, le débit, la publication, la
   * programmation, l'activation de l'Autopilote et la création d'un post.
   *
   * Les LECTURES, elles, sont permises et il en existe déjà au montage
   * (`GET /api/autopilot/config`, `GET /api/voice/clone`, `GET /api/pexels`).
   * Lire la configuration de l'Autopilote n'est pas l'activer, et ces appels
   * sont antérieurs à ce lot : les interdire ici casserait le parcours de
   * création sans rien protéger.
   */
  it('aucune écriture, sur aucune route', async () => {
    ouvrir('post-42');
    await laisserTourner();
    const ecritures = appels.filter((a) => a.method !== 'GET');
    expect(ecritures).toEqual([]);
  });

  it('ni rendu, ni débit, ni publication', async () => {
    ouvrir('post-42');
    await laisserTourner();
    for (const interdit of ['/api/credits/deduct', '/api/render', '/api/posts/publish']) {
      expect(appels.some((a) => a.url.includes(interdit))).toBe(false);
    }
  });

  it('l\'Autopilote n\'est que LU, jamais écrit', async () => {
    ouvrir('post-42');
    await laisserTourner();
    const ecrituresAutopilote = appels.filter(
      (a) => a.url.includes('/api/autopilot') && a.method !== 'GET',
    );
    expect(ecrituresAutopilote).toEqual([]);
  });

  it('la création normale n\'écrit pas davantage', async () => {
    ouvrir();
    await laisserTourner();
    expect(appels.filter((a) => a.method !== 'GET')).toEqual([]);
  });
});
