/**
 * Le sélecteur de photos — Unsplash comprise.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI ÉTAIT FAUX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `/api/pexels` attrapait TOUTE erreur du fournisseur, la journalisait, et
 * répondait `{ success: true, photos: [] }`. L'écran en concluait « Aucune
 * photo pour cette recherche ».
 *
 * Une clé refusée, un quota épuisé et une recherche réellement infructueuse
 * s'affichaient donc à l'identique — et le message accusait la requête de
 * l'utilisateur, qui la reformulait sans fin. La grille vide ne pouvait pas
 * lui dire la seule chose utile : que la recherche n'avait pas eu lieu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUCUN APPEL RÉEL, AUCUNE CLÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `fetch` est doublé de bout en bout : rien ne part vers Unsplash ni Pexels.
 * Les clés sont des valeurs de test évidentes, et un test vérifie qu'aucune
 * d'elles n'atteint le navigateur.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  etatDepuisReponse, messagePhotos, reessayable, motifPourStatut, nomSource,
} from '@/lib/creer/photosEtat';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

const composeVideoSpy = vi.fn(async () => ({ video: new Blob(), thumbnail: null }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return { ...actual, composeVideo: (...a: unknown[]) => composeVideoSpy(...(a as [])) };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }],
};

/** Ce que la route renverrait pour Unsplash — forme réelle, URLs publiques. */
const PHOTOS_UNSPLASH = [
  {
    id: 'unsplash-aaa', source: 'unsplash',
    url: 'https://images.unsplash.com/photo-aaa?w=1080',
    medium: 'https://images.unsplash.com/photo-aaa?w=400',
    small: 'https://images.unsplash.com/photo-aaa?w=200',
    photographer: 'Ada', alt: 'danse',
  },
  {
    id: 'unsplash-bbb', source: 'unsplash',
    url: 'https://images.unsplash.com/photo-bbb?w=1080',
    medium: 'https://images.unsplash.com/photo-bbb?w=400',
    small: 'https://images.unsplash.com/photo-bbb?w=200',
    photographer: 'Grace', alt: 'yoga',
  },
];

interface Scenario {
  reponsePhotos?: unknown;
  /** Fait échouer l'appel réseau lui-même. */
  reseauKO?: boolean;
}

let requetesPhotos: string[];
let appelsEcriture: string[];

function installerFetch(sc: Scenario = {}) {
  requetesPhotos = [];
  appelsEcriture = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    if (m !== 'GET') appelsEcriture.push(`${m} ${u}`);
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
    } as Response);

    if (u.startsWith('/api/pexels')) {
      requetesPhotos.push(u);
      if (sc.reseauKO) throw new Error('offline');
      return rep(sc.reponsePhotos ?? { success: true, photos: PHOTOS_UNSPLASH, source: 'unsplash' });
    }
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {} });
  }) as unknown as typeof fetch;
}

const poser = () => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'danse', generated: CONTENU,
  }));
};

const attendre = async (tours = 20) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/** Monte l'assistant et amène à l'étape qui porte « Photo d'affiche ». */
const ouvrirSelecteur = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await attendre(6);
  for (let i = 0; i < 5; i += 1) {
    if (document.querySelector('[data-poster-source="unsplash"]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); });
    await attendre(4);
  }
  expect(document.querySelector('[data-poster-source="unsplash"]'), 'le sélecteur de source doit être monté').not.toBeNull();
};

const choisirUnsplash = async () => {
  const b = document.querySelector('[data-poster-source="unsplash"]') as HTMLButtonElement;
  await act(async () => { fireEvent.click(b); });
  await attendre(12);
};

const vignettes = () => Array.from(document.querySelectorAll('[data-poster-photo]')) as HTMLElement[];
const messageErreur = () => document.querySelector('[data-photos-erreur]')?.textContent ?? '';

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  composeVideoSpy.mockClear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Le vocabulaire des états, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('5. Les quatre raisons d une grille vide sont distinctes', () => {
  it('chaque statut du fournisseur a son motif', () => {
    expect(motifPourStatut(401)).toBe('auth');
    expect(motifPourStatut(403)).toBe('auth');
    expect(motifPourStatut(429)).toBe('quota');
    expect(motifPourStatut(500)).toBe('indisponible');
    expect(motifPourStatut(404)).toBe('indisponible');
  });

  it('la réponse de la route se traduit en état', () => {
    expect(etatDepuisReponse({ configured: false })).toBe('non-configure');
    expect(etatDepuisReponse({ echec: 'quota' })).toBe('quota');
    expect(etatDepuisReponse({ echec: 'auth' })).toBe('auth');
    expect(etatDepuisReponse({ echec: 'indisponible' })).toBe('indisponible');
    expect(etatDepuisReponse({ success: true, photos: [] })).toBe('vide');
    expect(etatDepuisReponse(null)).toBe('vide');
    expect(etatDepuisReponse({ echec: 'inconnu' })).toBe('vide');
  });

  it('les quatre messages sont différents, et aucun n accuse la requête à tort', () => {
    const messages = (['vide', 'non-configure', 'auth', 'quota', 'indisponible'] as const)
      .map((e) => messagePhotos(e, 'unsplash'));
    expect(new Set(messages).size).toBe(5);
    expect(messagePhotos('quota', 'unsplash')).toContain('Limite');
    expect(messagePhotos('vide', 'unsplash')).toContain('Aucune photo');
    // Un quota épuisé ne doit PAS dire « aucune photo pour cette recherche ».
    expect(messagePhotos('quota', 'unsplash')).not.toContain('Aucune photo');
    expect(messagePhotos('auth', 'unsplash')).not.toContain('Aucune photo');
  });

  it('« Réessayer » n est proposé que là où il sert', () => {
    expect(reessayable('quota')).toBe(true);
    expect(reessayable('indisponible')).toBe(true);
    expect(reessayable('auth')).toBe(true);
    // Une source non configurée ne le deviendra pas d'un clic ; une
    // recherche sans résultat demande une AUTRE requête, pas la même.
    expect(reessayable('non-configure')).toBe(false);
    expect(reessayable('vide')).toBe(false);
  });

  it('aucun message ne cite un code HTTP ni une variable d environnement', () => {
    for (const e of ['vide', 'non-configure', 'auth', 'quota', 'indisponible'] as const) {
      const m = messagePhotos(e, 'unsplash');
      expect(m).not.toMatch(/\b(401|403|429|500)\b/);
      // Le NOM de la source est légitime — c'est le nom de la VARIABLE
      // d'environnement qui ne doit jamais apparaître.
      expect(m).not.toMatch(/UNSPLASH_ACCESS_KEY|PEXELS_API_KEY|process\.env/);
    }
    expect(nomSource('unsplash')).toBe('Unsplash');
    expect(nomSource('pexels')).toBe('Pexels');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 1 à 4. L'écran, monté
// ────────────────────────────────────────────────────────────────────────────

describe('1. Une réponse Unsplash valide affiche les miniatures', () => {
  it('les vignettes apparaissent réellement', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    expect(vignettes().length).toBe(2);
  });

  it('elles pointent vers des URL Unsplash publiques en https', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    for (const v of vignettes()) {
      const img = v.querySelector('img') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')?.startsWith('https://images.unsplash.com/')).toBe(true);
    }
  });

  it('la requête demande bien la source unsplash', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    expect(requetesPhotos.some((u) => u.includes('source=unsplash'))).toBe(true);
  });
});

describe('2. La recherche transmet les caractères spéciaux', () => {
  it('accents, espaces et esperluette sont encodés', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const champ = document.querySelector('[data-poster-query]') as HTMLInputElement;
    expect(champ, 'le champ de recherche doit être monté').toBeTruthy();
    await act(async () => {
      fireEvent.change(champ, { target: { value: 'danse africaine & énergie' } });
    });
    const chercher = document.querySelector('[data-poster-search]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(chercher); });
    await attendre(12);
    const derniere = requetesPhotos[requetesPhotos.length - 1];
    expect(derniere).toContain(encodeURIComponent('danse africaine & énergie'));
    // L'esperluette brute couperait la query string en deux paramètres.
    expect(derniere).not.toContain('danse africaine & énergie');
  });
});

describe('3 & 4. Le clic sélectionne la photo, et elle arrive dans l aperçu', () => {
  it('le clic retient la bonne URL', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const seconde = vignettes()[1];
    const url = seconde.getAttribute('data-poster-photo');
    expect(url).toBe(PHOTOS_UNSPLASH[1].url);
    await act(async () => { fireEvent.click(seconde); });
    await attendre(6);
    expect(document.querySelector(`[data-poster-photo="${url}"]`)).not.toBeNull();
  });

  it('la photo choisie devient l affiche affichée dans l aperçu', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const premiere = vignettes()[0];
    const url = premiere.getAttribute('data-poster-photo')!;
    await act(async () => { fireEvent.click(premiere); });
    await attendre(10);
    // L'aperçu dessine l'affiche : elle est référencée hors de la grille.
    const partout = Array.from(document.querySelectorAll('img'))
      .map((i) => i.getAttribute('src') ?? '');
    const styles = Array.from(document.querySelectorAll('[style]'))
      .map((e) => e.getAttribute('style') ?? '');
    expect(partout.concat(styles).some((v) => v.includes(url))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5 & 6. Chargement, vide, erreur — et aucun crash
// ────────────────────────────────────────────────────────────────────────────

describe('5 & 6. Les états à l écran', () => {
  it('une recherche sans résultat dit « Aucune photo », sans bouton Réessayer', async () => {
    installerFetch({ reponsePhotos: { success: true, photos: [], source: 'unsplash' } });
    poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    expect(messageErreur()).toContain('Aucune photo');
    expect(document.querySelector('[data-photos-reessayer]')).toBeNull();
  });

  it('une source non configurée le dit, sans bouton Réessayer', async () => {
    installerFetch({ reponsePhotos: { success: true, photos: [], configured: false, source: 'unsplash' } });
    poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    expect(messageErreur()).toBe('Unsplash n’est pas configuré sur ce serveur.');
    expect(document.querySelector('[data-photos-reessayer]')).toBeNull();
  });

  ([['auth', 401], ['auth', 403], ['quota', 429], ['indisponible', 500]] as const)
    .forEach(([motif, statut]) => {
      it(`un ${statut} du fournisseur ne casse rien et propose Réessayer`, async () => {
        installerFetch({ reponsePhotos: { success: true, photos: [], echec: motif, source: 'unsplash' } });
        poser();
        await ouvrirSelecteur();
        await choisirUnsplash();
        expect(messageErreur()).toBe(messagePhotos(motif, 'unsplash'));
        expect(messageErreur()).not.toContain('Aucune photo');
        expect(document.querySelector('[data-photos-reessayer]')).not.toBeNull();
        expect(vignettes()).toHaveLength(0);
      });
    });

  it('« Réessayer » relance la MÊME recherche, une seule fois', async () => {
    installerFetch({ reponsePhotos: { success: true, photos: [], echec: 'quota', source: 'unsplash' } });
    poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const avant = requetesPhotos.length;
    const b = document.querySelector('[data-photos-reessayer]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(b); });
    await attendre(12);
    expect(requetesPhotos.length).toBe(avant + 1);
    expect(requetesPhotos[requetesPhotos.length - 1]).toContain('source=unsplash');
  });

  it('un échec réseau est traité, pas propagé', async () => {
    installerFetch({ reseauKO: true }); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    expect(messageErreur()).toBe(messagePhotos('indisponible', 'unsplash'));
    expect(document.querySelector('[data-photos-reessayer]')).not.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7, 8, 11. Ce que le sélecteur ne fait pas
// ────────────────────────────────────────────────────────────────────────────

describe('7 & 8. Aucune clé, aucune URL non publique', () => {
  it('le navigateur n envoie ni ne reçoit de clé', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const a of appels) {
      const u = String(a[0]);
      expect(u).not.toMatch(/client_id|access_key|api_key|authorization/i);
      const init = a[1] as RequestInit | undefined;
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/Client-ID|Authorization/i);
    }
  });

  it('le sélecteur n appelle jamais le fournisseur directement', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const appels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const a of appels) {
      expect(String(a[0])).not.toContain('api.unsplash.com');
      expect(String(a[0])).not.toContain('api.pexels.com');
    }
  });

  it('seules des URL https publiques deviennent des vignettes', async () => {
    installerFetch({
      reponsePhotos: {
        success: true, source: 'unsplash',
        photos: [
          ...PHOTOS_UNSPLASH,
          { id: 'x1', source: 'unsplash', url: 'http://images.unsplash.com/nope' },
          { id: 'x2', source: 'unsplash', url: 'https://127.0.0.1/interne.jpg' },
          { id: 'x3', source: 'unsplash', url: 'file:///etc/passwd' },
          { id: 'x4', source: 'unsplash', url: undefined },
        ],
      },
    });
    poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    const urls = vignettes().map((v) => v.getAttribute('data-poster-photo'));
    expect(urls).toEqual([PHOTOS_UNSPLASH[0].url, PHOTOS_UNSPLASH[1].url]);
    expect(urls.join(' ')).not.toContain('127.0.0.1');
    expect(urls.join(' ')).not.toContain('file://');
  });
});

describe('11. Le sélecteur ne déclenche aucun rendu', () => {
  it('ni composition, ni écriture, ni publication', async () => {
    installerFetch(); poser();
    await ouvrirSelecteur();
    await choisirUnsplash();
    await act(async () => { fireEvent.click(vignettes()[0]); });
    await attendre(10);
    expect(composeVideoSpy).not.toHaveBeenCalled();
    expect(appelsEcriture).toEqual([]);
  });
});
