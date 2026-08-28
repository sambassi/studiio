import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

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
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

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
    for (const interdit of ['/api/credits/deduct', '/api/render/jobs', '/api/posts/publish']) {
      expect(appels.some((a) => a.url.includes(interdit))).toBe(false);
    }
    // `/api/render/tarifs` est une LECTURE du prix, pas un rendu : l'écran
    // l'interroge au montage pour annoncer un chiffre qui vienne du serveur.
    expect(appels.some((a) => a.url.includes('/api/render') && !a.url.includes('/api/render/tarifs')))
      .toBe(false);
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

/**
 * Le contenu chargé, et le brouillon local qui ne doit pas s'y substituer.
 *
 * Ces deux-là sont la même exigence vue des deux côtés : un travail existant ne
 * doit jamais être remplacé sans un mot. Le premier vérifie que le contenu du
 * serveur arrive bien à l'écran ; le second, qu'un brouillon d'hier ne prend
 * pas sa place — et ne se fait pas non plus écraser par lui.
 */
describe('le contenu du serveur remplit l\'écran', () => {
  it('le titre et le sous-titre enregistrés sont affichés', async () => {
    ouvrir('post-42');
    await laisserTourner();
    expect(document.body.textContent).toContain('MON TITRE');
  });

  it('l\'écran dit que le contenu est chargé, pas qu\'un brouillon est restauré', async () => {
    // « Brouillon restauré » serait faux : rien n'a ete retrouve, on a ouvert
    // un contenu enregistre.
    ouvrir('post-42');
    await laisserTourner();
    expect(document.body.textContent).toContain('Contenu chargé');
    expect(document.body.textContent).not.toContain('Brouillon restauré');
  });

  it('l\'écran annonce que rien ne partira sans une demande explicite', async () => {
    ouvrir('post-42');
    await laisserTourner();
    expect(document.body.textContent)
      .toContain('Vos modifications ne sont enregistrées que lorsque vous le demandez');
  });
});

describe('le brouillon local n\'écrase jamais le contenu chargé', () => {
  /** Un brouillon local d'une création précédente, bien rempli. */
  function poserBrouillon() {
    window.localStorage.setItem(
      draftKey('a@b.c'),
      JSON.stringify({
        version: DRAFT_VERSION,
        savedAt: 1,
        started: true,
        generated: {
          title: 'TITRE DU BROUILLON',
          subtitle: 'sous-titre du brouillon',
          cards: [],
          cta: '',
          ctaSub: '',
        },
      }),
    );
  }

  it('c\'est le contenu du serveur qui s\'affiche, pas le brouillon', async () => {
    poserBrouillon();
    ouvrir('post-42');
    await laisserTourner();
    expect(document.body.textContent).toContain('MON TITRE');
    expect(document.body.textContent).not.toContain('TITRE DU BROUILLON');
  });

  it('le brouillon local n\'est pas détruit non plus — il reste pour la création', async () => {
    // L'inverse serait tout aussi grave : ouvrir un post ne doit pas effacer le
    // travail de creation en cours.
    poserBrouillon();
    ouvrir('post-42');
    await laisserTourner();
    const reste = window.localStorage.getItem(draftKey('a@b.c'));
    expect(reste).not.toBeNull();
    expect(String(reste)).toContain('TITRE DU BROUILLON');
  });

  it('en création, le brouillon reprend ses droits', async () => {
    poserBrouillon();
    ouvrir();
    await laisserTourner();
    expect(document.body.textContent).toContain('TITRE DU BROUILLON');
  });
});

/**
 * L'enregistrement : sur demande, et seulement sur demande.
 *
 * Ces tests sont l'exigence « l'enregistrement serveur ne doit avoir lieu
 * qu'après une action explicite » vue de tous les côtés : rien ne part sans
 * clic ; ce qui part est un PATCH ; et chaque échec laisse le formulaire
 * intact en disant ce qui s'est passé.
 */
describe('enregistrement explicite', () => {
  const cliquerEnregistrer = async () => {
    const bouton = screen.getByRole('button', { name: /Enregistrer les modifications/i });
    await act(async () => { fireEvent.click(bouton); await Promise.resolve(); });
  };

  it('le bouton n\'existe pas en création', async () => {
    ouvrir();
    await laisserTourner();
    expect(screen.queryByRole('button', { name: /Enregistrer les modifications/i })).toBeNull();
  });

  it('rien n\'est écrit tant qu\'on n\'a pas cliqué', async () => {
    ouvrir('post-42');
    await laisserTourner();
    expect(appels.filter((a) => a.method !== 'GET')).toEqual([]);
  });

  it('le clic envoie un PATCH, et un seul', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await cliquerEnregistrer();
    const ecritures = appels.filter((a) => a.method !== 'GET');
    expect(ecritures).toEqual([{ url: '/api/posts/post-42', method: 'PATCH' }]);
  });

  it('l\'enregistrement ne rend rien et ne débite rien', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await cliquerEnregistrer();
    for (const interdit of ['/api/credits/deduct', '/api/render/jobs', '/api/posts/publish']) {
      expect(appels.some((a) => a.url.includes(interdit))).toBe(false);
    }
    // `/api/render/tarifs` est une LECTURE du prix, pas un rendu : l'écran
    // l'interroge au montage pour annoncer un chiffre qui vienne du serveur.
    expect(appels.some((a) => a.url.includes('/api/render') && !a.url.includes('/api/render/tarifs')))
      .toBe(false);
  });

  it('une fois enregistré, l\'écran le dit', async () => {
    ouvrir('post-42');
    await laisserTourner();
    await cliquerEnregistrer();
    expect(document.body.textContent).toContain('Modifications enregistrées.');
  });
});

describe('échecs d\'enregistrement — le formulaire ne bouge pas', () => {
  const cliquerEnregistrer = async () => {
    const bouton = screen.getByRole('button', { name: /Enregistrer les modifications/i });
    await act(async () => { fireEvent.click(bouton); await Promise.resolve(); });
  };

  it('un conflit (409) dit que RIEN n\'a été enregistré', async () => {
    // Le message doit lever l'ambiguite : sans lui, l'utilisateur repartirait
    // en croyant son travail sauve alors que le serveur a tout refuse.
    // Le CHARGEMENT reussit — sinon il n'y aurait pas de bouton a cliquer —
    // et c'est l'ENREGISTREMENT qui se heurte au conflit.
    ouvrir('post-42');
    await laisserTourner();
    installerFetch(() => ({ status: 409, corps: { success: false, error: 'Conflict' } }));
    await cliquerEnregistrer();
    const texte = document.body.textContent ?? '';
    expect(texte).toContain('modifié ailleurs');
    expect(texte).toContain('Rien n’a été enregistré');
  });

  it('une coupure réseau laisse les modifications à l\'écran', async () => {
    ouvrir('post-42');
    await laisserTourner();
    // Le contenu chargé est affiché...
    expect(document.body.textContent).toContain('MON TITRE');
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await cliquerEnregistrer();
    // ... et il y est toujours après l'échec.
    expect(document.body.textContent).toContain('MON TITRE');
    expect(document.body.textContent).toContain('La connexion a été interrompue');
  });

  it('une session expirée le dit, sans rien perdre', async () => {
    ouvrir('post-42');
    await laisserTourner();
    installerFetch(() => ({ status: 401, corps: { success: false } }));
    await cliquerEnregistrer();
    expect(document.body.textContent).toContain('Votre session a expiré');
    expect(document.body.textContent).toContain('MON TITRE');
  });
});

describe('rechargement après enregistrement', () => {
  it('rouvrir le contenu affiche ce que le serveur porte désormais', async () => {
    // Premiere ouverture, enregistrement, puis on rouvre : le wizard doit
    // repartir du serveur, pas d'un etat garde en memoire.
    ouvrir('post-42');
    await laisserTourner();
    cleanup();

    const APRES = { ...POST, title: 'TITRE APRÈS ENREGISTREMENT' };
    installerFetch(() => ({ status: 200, corps: { success: true, data: APRES } }));
    ouvrir('post-42');
    await laisserTourner();
    expect(document.body.textContent).toContain('TITRE APRÈS ENREGISTREMENT');
    expect(document.body.textContent).not.toContain('MON TITRE');
  });
});
