import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

/**
 * Restauration du placement — vérifiée sur le COMPOSANT, pas sur son source.
 *
 * Un audit a montré qu'on pouvait remplacer le format de mesure des
 * emplacements par le format courant à la restauration — c'est-à-dire rejouer
 * des boîtes 9:16 à l'échelle 16:9, exactement ce que le champ `format` existe
 * pour empêcher — sans faire échouer un seul test : toute la moitié « lecture »
 * n'était couverte que par des `toContain` sur le fichier source.
 *
 * Ces tests montent le vrai wizard avec un brouillon préparé et lisent le DOM
 * produit.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

let sessionState: { data: unknown; status: string };

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer-simple/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const KEY = draftKey('a@b.c');

const cartes = (...ids: string[]) => ({
  title: 'Routine matin',
  subtitle: 'Sous-titre',
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
  cards: ids.map((id) => ({ id, icon: 'Flame', title: id.toUpperCase(), description: '', value: '' })),
});

const poser = (draft: Record<string, unknown>) => {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({
      version: DRAFT_VERSION,
      savedAt: 1,
      started: true,
      step: 3,
      customTopic: 'yoga du matin',
      generated: cartes('a', 'b'),
      ...draft,
    }),
  );
};

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const monter = async () => {
  const view = render(<AssistantWizard />);
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  return view;
};

const titre = () => document.querySelector<HTMLElement>('[data-title-block]');
const cta = () => document.querySelector<HTMLElement>('[data-cta-block]');
const cartesDom = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cards-grid] [data-card-id]'));

describe('Ce qui a été relu arrive intact à l aperçu', () => {
  it('le titre et le CTA reprennent leur position enregistrée', async () => {
    poser({ titlePos: { x: 12, y: 47 }, ctaPos: { x: 41, y: 83 } });
    await monter();
    expect(titre()!.style.left).toBe('12%');
    expect(titre()!.style.top).toBe('47%');
    expect(cta()!.style.left).toBe('41%');
    expect(cta()!.style.top).toBe('83%');
  });

  it('les cartes reprennent leurs emplacements libres', async () => {
    poser({
      cardBoxes: {
        format: '9:16',
        boxes: { a: { x: 5, y: 10, w: 50, h: 9 }, b: { x: 30, y: 40, w: 50, h: 9 } },
      },
    });
    await monter();
    const [a, b] = cartesDom();
    expect(a.style.position).toBe('absolute');
    expect(a.style.left).toBe('5%');
    expect(a.style.top).toBe('10%');
    expect(a.style.width).toBe('50%');
    expect(b.style.left).toBe('30%');
    expect(b.style.top).toBe('40%');
  });

  it('les emplacements sont rejoués À L ÉCHELLE DE LEUR FORMAT', async () => {
    // Le piège : substituer le format courant au format de mesure. Ici le
    // brouillon est en 16:9 et ses boîtes aussi — si la restauration prenait
    // un autre format, l'ensemble serait écarté et les cartes retomberaient
    // en flux.
    poser({
      format: '16:9',
      cardBoxes: {
        format: '16:9',
        boxes: { a: { x: 5, y: 10, w: 50, h: 9 }, b: { x: 30, y: 40, w: 50, h: 9 } },
      },
    });
    await monter();
    expect(cartesDom()[0].style.left).toBe('5%');
  });

  it('les groupes retrouvés marquent les bonnes cartes', async () => {
    poser({ cardGroups: [{ id: 'g1', cardIds: ['a', 'b'] }] });
    await monter();
    for (const el of cartesDom()) expect(el.style.boxShadow).toContain('inset');
  });
});

describe('Default-safe : sans placement enregistré, rien ne change', () => {
  it('le titre et le CTA sont à leur place d origine', async () => {
    poser({});
    await monter();
    // Les constantes `DESIGN` historiques.
    expect(titre()!.style.left).toBe('8%');
    expect(titre()!.style.top).toBe('8%');
    expect(cta()!.style.left).toBe('50%');
    expect(cta()!.style.top).toBe('92%');
  });

  it('les cartes sont en flux, sans style de position', async () => {
    poser({});
    await monter();
    for (const el of cartesDom()) {
      // ⚠️ L'INVARIANT EST « PAS PLACEE PAR DES COORDONNEES », pas « aucune
      // propriete `position` ». Les cartes portent desormais un
      // `position: relative` — sans decalage, donc neutre pour la mise en
      // page — qui sert de contexte aux poignees de coin. Ce qui trahirait
      // un placement libre, c'est `absolute` et un `left`.
      expect(el.style.position).not.toBe('absolute');
      expect(el.style.left).toBe('');
      expect(el.style.boxShadow).toBe('');
    }
  });
});

describe('Un brouillon incohérent retombe sur le placement d origine', () => {
  it('des emplacements qui ne couvrent pas les cartes sont écartés en amont', async () => {
    // Et surtout : la disposition n'est PAS détruite dans le stockage par un
    // effet de bord au chargement — c'est ce qui arrivait quand la relecture
    // laissait passer des emplacements orphelins.
    poser({ cardBoxes: { format: '9:16', boxes: { a: { x: 5, y: 10, w: 50, h: 9 } } } });
    await monter();
    for (const el of cartesDom()) expect(el.style.position).not.toBe('absolute');
  });

  it('une carte hors du conteneur fait écarter tout l ensemble', async () => {
    poser({
      cardBoxes: {
        format: '9:16',
        boxes: { a: { x: 95, y: 10, w: 100, h: 9 }, b: { x: 30, y: 40, w: 50, h: 9 } },
      },
    });
    await monter();
    for (const el of cartesDom()) expect(el.style.position).not.toBe('absolute');
  });

  it('un groupe désignant une carte absente ne marque personne', async () => {
    poser({ cardGroups: [{ id: 'g1', cardIds: ['a', 'inconnue'] }] });
    await monter();
    for (const el of cartesDom()) expect(el.style.boxShadow).toBe('');
  });
});
