/**
 * Affiche Unsplash : le téléchargement est signalé UNE fois par choix réel,
 * que la photo soit CLIQUÉE dans la grille ou GLISSÉE-DÉPOSÉE sur l'aperçu.
 *
 * Avant : seul le clic signalait (`signalerChoixAfficheUnsplash`) ; le dépôt
 * posait la photo sans rien dire à Unsplash — contraire à ses règles.
 *
 * Règle testée sur le VRAI assistant (fetch doublé, aucun fournisseur réel) :
 *  - clic → 1 POST `/api/stock/importer` ; dépôt → 1 POST ;
 *  - affichage des résultats, survol, glisser sans déposer, dé-choix → 0 ;
 *  - même photo déposée deux fois au même endroit → 1 seul POST (déjà posée) ;
 *    clic puis dépôt de la même photo → 1 seul POST ;
 *  - une AUTRE photo déposée ensuite → un nouveau choix réel, 1 POST de plus.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return { ...actual, composeVideo: async () => ({ video: new Blob(), thumbnail: null }) };
});

import AssistantWizard, { PHOTO_DND_TYPE } from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin', subtitle: 'Reveiller le corps',
  cards: [{ icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' }],
};
const PHOTOS = ['aaa', 'bbb'].map((k) => ({
  id: `unsplash-${k}`, source: 'unsplash',
  url: `https://images.unsplash.com/photo-${k}?w=1080`,
  medium: `https://images.unsplash.com/photo-${k}?w=400`,
  small: `https://images.unsplash.com/photo-${k}?w=200`,
  photographer: 'Ada', alt: k,
}));

/** Corps des signalements envoyés à `/api/stock/importer`. */
let signalements: Array<Record<string, unknown>>;

function installerFetch() {
  signalements = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const rep = (corps: unknown, status = 200) => ({ ok: status < 300, status, json: async () => corps } as Response);
    if (u.startsWith('/api/stock/importer')) {
      signalements.push(JSON.parse(String(init?.body ?? '{}')));
      return rep({ success: true, url: 'https://images.unsplash.com/x', importe: false, media: {} });
    }
    if (u.startsWith('/api/pexels')) return rep({ success: true, photos: PHOTOS, source: 'unsplash' });
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {} });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 20) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/** Monte l'assistant, ouvre « Photo d'affiche » et lance la recherche. */
async function ouvrirGrille() {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1, customTopic: 'danse', generated: CONTENU,
  }));
  render(<AssistantWizard />);
  await attendre(6);
  for (let i = 0; i < 5; i += 1) {
    if (document.querySelector('[data-poster-search]')) break;
    const suivant = screen.queryAllByRole('button', { name: /^Continuer/ })[0];
    if (!suivant) break;
    await act(async () => { fireEvent.click(suivant); });
    await attendre(4);
  }
  const recherche = document.querySelector('[data-poster-search]') as HTMLButtonElement;
  expect(recherche, 'la recherche de photos doit être montée').not.toBeNull();
  await act(async () => { fireEvent.click(recherche); });
  await attendre(12);
  expect(vignettes()).toHaveLength(2);
}

const vignettes = () => Array.from(document.querySelectorAll('[data-poster-photo]')) as HTMLElement[];

/** `DataTransfer` minimal (jsdom n'en fournit pas d'utilisable). */
function transfert() {
  const donnees: Record<string, string> = {};
  return {
    setData: (t: string, v: string) => { donnees[t] = v; },
    getData: (t: string) => donnees[t] ?? '',
    effectAllowed: '', dropEffect: '',
  };
}

/** Glisse la vignette `i` et la dépose sur l'aperçu. */
async function deposer(i: number) {
  const dt = transfert();
  await act(async () => { fireEvent.dragStart(vignettes()[i], { dataTransfer: dt }); });
  await attendre(2);
  const surface = document.querySelector('[data-photo-drop]') as HTMLElement;
  expect(surface, 'la surface de dépôt apparaît pendant le glissement').not.toBeNull();
  expect(dt.getData(PHOTO_DND_TYPE)).toBe(PHOTOS[i].url);
  await act(async () => { fireEvent.dragOver(surface, { dataTransfer: dt }); fireEvent.drop(surface, { dataTransfer: dt }); });
  await attendre(6);
}

beforeEach(() => { window.localStorage.clear(); installerFetch(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Affiche Unsplash — signalement par clic ET par dépôt, une fois par choix réel', () => {
  it('résultats affichés, survol, glisser sans déposer : aucun signalement', async () => {
    await ouvrirGrille();
    await act(async () => {
      fireEvent.mouseEnter(vignettes()[0]);
      fireEvent.mouseOver(vignettes()[1]);
      fireEvent.focus(vignettes()[0]);
    });
    const dt = transfert();
    await act(async () => { fireEvent.dragStart(vignettes()[1], { dataTransfer: dt }); });
    await act(async () => { fireEvent.dragEnd(vignettes()[1], { dataTransfer: dt }); });
    await attendre(6);
    expect(signalements).toEqual([]);
  });

  it('clic : 1 POST ; dé-choix (second clic) : 0 de plus', async () => {
    await ouvrirGrille();
    await act(async () => { fireEvent.click(vignettes()[0]); });
    await attendre(6);
    expect(signalements).toEqual([{ provider: 'unsplash', type: 'photo', providerAssetId: 'aaa' }]);
    await act(async () => { fireEvent.click(vignettes()[0]); }); // dé-choix
    await attendre(6);
    expect(signalements).toHaveLength(1);
  });

  it('dépôt : 1 POST ; même photo redéposée : 0 de plus ; autre photo : 1 de plus', async () => {
    await ouvrirGrille();
    await deposer(1);
    expect(signalements).toEqual([{ provider: 'unsplash', type: 'photo', providerAssetId: 'bbb' }]);
    await deposer(1);
    expect(signalements).toHaveLength(1);
    await deposer(0);
    expect(signalements.map((s) => s.providerAssetId)).toEqual(['bbb', 'aaa']);
  });

  it('clic puis dépôt de la MÊME photo : un seul POST', async () => {
    await ouvrirGrille();
    await act(async () => { fireEvent.click(vignettes()[0]); });
    await attendre(6);
    await deposer(0);
    expect(signalements).toEqual([{ provider: 'unsplash', type: 'photo', providerAssetId: 'aaa' }]);
  });
});
