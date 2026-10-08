import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

/**
 * Aperçu de Créer — trois défauts reproduits par l'utilisateur.
 *
 * A. FILTRES — « Tout » montrait la vue EMPILÉE (titre + cartes + CTA
 *    superposés), une image qui ne correspond à aucune séquence du montage,
 *    et la fenêtre agrandie ne recevait ni le rendu ni la lecture : sur
 *    « Tout », elle montrait autre chose que l'aperçu principal.
 * B. AGRANDIR — la fenêtre s'ouvrait à 420 × 640 et son cadre restait borné
 *    par `.apercu-cadre` à la taille de la colonne : « même taille ».
 * C. TITRE — sélectionnable mais sans poignée : impossible à redimensionner.
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

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

const proprietes: Array<[string, PropertyDescriptor | undefined]> = [];
const fixer = (nom: 'clientWidth' | 'clientHeight', valeur: (el: HTMLElement) => number) => {
  proprietes.push([nom, Object.getOwnPropertyDescriptor(HTMLElement.prototype, nom)]);
  Object.defineProperty(HTMLElement.prototype, nom, {
    configurable: true, get() { return valeur(this as HTMLElement); },
  });
};

beforeEach(() => {
  window.localStorage.clear();
  fixer('clientWidth', (el) => (el.parentElement?.hasAttribute('data-apercu-agrandi') ? 1400 : 400));
  // Le corps de la modale mesure 900 px de haut : c'est lui qui borne le cadre.
  fixer('clientHeight', (el) => (el.parentElement?.hasAttribute('data-apercu-agrandi') ? 900 : 0));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [] }) };
    }
    if (String(url).startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, postersReady: true, config: {} }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  while (proprietes.length) {
    const [nom, d] = proprietes.pop()!;
    if (d) Object.defineProperty(HTMLElement.prototype, nom, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[nom];
  }
});

async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
  fireEvent.click(screen.getByText('Continuer vers Style'));
  await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
}

const onglet = (racine: ParentNode, nom: string) =>
  Array.from(racine.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find((b) => b.textContent?.trim() === nom)!;
const modale = () => document.querySelector('[data-apercu-agrandi]') as HTMLElement | null;

// ─────────────────────────────────────────────────────────────────────────
describe('A — chaque onglet montre SA séquence, « Tout » joue l ensemble', () => {
  it('Titre / Cartes / CTA isolent chacun leur séquence', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'Titre'));
    expect(document.querySelectorAll('[data-title-block]').length).toBe(1);
    expect(document.querySelectorAll('[data-card-id]').length).toBe(0);
    expect(document.querySelectorAll('[data-cta-block]').length).toBe(0);

    fireEvent.click(onglet(document, 'Cartes'));
    expect(document.querySelectorAll('[data-title-block]').length).toBe(0);
    expect(document.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-cta-block]').length).toBe(0);

    fireEvent.click(onglet(document, 'CTA'));
    expect(document.querySelectorAll('[data-title-block]').length).toBe(0);
    expect(document.querySelectorAll('[data-card-id]').length).toBe(0);
    expect(document.querySelectorAll('[data-cta-block]').length).toBe(1);
  });

  it('à l ouverture, « Tout » ne joue rien tout seul', async () => {
    await ouvrirStyle();
    const lecteur = document.querySelector('[data-sequence-playback]') as HTMLElement;
    expect(lecteur).toBeTruthy();
    expect(lecteur.getAttribute('data-sequence-playing')).toBe('false');
  });

  it('cliquer « Tout » lance la lecture des séquences, depuis le début', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'Titre'));
    expect(document.querySelector('[data-sequence-playback]')).toBeNull();
    fireEvent.click(onglet(document, 'Tout'));
    await waitFor(() => {
      const lecteur = document.querySelector('[data-sequence-playback]') as HTMLElement;
      expect(lecteur.getAttribute('data-sequence-playing')).toBe('true');
    });
    // La première séquence jouée est le titre, pas la vue empilée.
    expect(document.querySelector('[data-playback-layer="a"]')?.getAttribute('data-playback-sequence')).toBe('intro');
  });

  it('dans l aperçu agrandi, « Tout » joue aussi — et un seul lecteur existe', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByText('Agrandir'));
    const m = await waitFor(() => modale()!);
    // Le lecteur vit dans la modale, plus dans l'aperçu caché dessous.
    expect(document.querySelectorAll('[data-sequence-playback]').length).toBe(1);
    expect(m.querySelector('[data-sequence-playback]')).toBeTruthy();

    fireEvent.click(onglet(m, 'Cartes'));
    expect(m.querySelector('[data-sequence-playback]')).toBeNull();
    expect(m.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);
    expect(m.querySelectorAll('[data-title-block]').length).toBe(0);

    fireEvent.click(onglet(m, 'Tout'));
    await waitFor(() => {
      expect(m.querySelector('[data-sequence-playback]')?.getAttribute('data-sequence-playing')).toBe('true');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — Agrandir ouvre une vraie vue plein écran', () => {
  it('une modale plein écran, posée dans le body', async () => {
    await ouvrirStyle();
    expect(modale()).toBeNull();
    fireEvent.click(screen.getByText('Agrandir'));
    const m = await waitFor(() => modale()!);
    expect(m.parentElement).toBe(document.body);
    expect(m.getAttribute('role')).toBe('dialog');
    expect(m.className).toContain('fixed');
    expect(m.className).toContain('inset-0');
  });

  it('le cadre est borné par la HAUTEUR de la fenêtre, pas par la colonne', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByText('Agrandir'));
    const m = await waitFor(() => modale()!);
    const enveloppe = m.querySelector('.card-base')!.parentElement as HTMLElement;
    // 900 px de haut × 9/16 = 506,25 px de large : le cadre 9:16 occupe toute
    // la hauteur disponible (l'ancienne fenêtre faisait 420 × 640).
    await waitFor(() => expect(parseFloat(enveloppe.style.width)).toBeCloseTo(506.25, 1));
    // Et la borne de la colonne (`.apercu-cadre`, 100vh − 20rem) est levée.
    expect(enveloppe.style.getPropertyValue('--apercu-offset')).toBe('0px');
  });

  it('Échap ramène à la vue normale', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByText('Agrandir'));
    await waitFor(() => expect(modale()).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(modale()).toBeNull());
  });

  it('le bouton « Réduire » ramène à la vue normale', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByText('Agrandir'));
    const m = await waitFor(() => modale()!);
    fireEvent.click(m.querySelector('[data-apercu-reduire]') as HTMLElement);
    await waitFor(() => expect(modale()).toBeNull());
    // L'aperçu principal est intact, avec ses blocs éditables.
    expect(document.querySelector('[data-title-block]')).toBeTruthy();
  });

  it('la modale est un miroir : aucune poignée d édition dedans', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByText('Agrandir'));
    const m = await waitFor(() => modale()!);
    fireEvent.click(onglet(m, 'Titre'));
    fireEvent.pointerEnter(m.querySelector('[data-title-block]') as Element);
    expect(m.querySelector('[data-text-handle]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le titre se redimensionne par ses poignées', () => {
  const tailleTitre = () => {
    const bloc = document.querySelector('[data-title-block]') as HTMLElement;
    return parseFloat((bloc.firstElementChild as HTMLElement).style.fontSize);
  };

  it('au survol, les quatre coins du titre — et ceux du CTA restent cachés', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'Titre'));
    expect(document.querySelector('[data-text-handle]')).toBeNull();
    fireEvent.pointerEnter(document.querySelector('[data-title-block]') as Element);
    for (const coin of ['nw', 'ne', 'sw', 'se']) {
      expect(document.querySelector(`[data-text-handle="title-${coin}"]`)).toBeTruthy();
    }
    expect(document.querySelector('[data-text-handle^="cta-"]')).toBeNull();
  });

  it('un bloc SÉLECTIONNÉ garde ses poignées sans survol', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'Titre'));
    // La sélection est MESURÉE (`collectGuideBoxes`) : jsdom n'a pas de mise
    // en page, on lui en donne une.
    const vraiRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function fake(this: HTMLElement) {
      const r = (left: number, top: number, width: number, height: number) => ({
        x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
      }) as DOMRect;
      return this.hasAttribute('data-title-block') ? r(32, 57, 336, 85) : r(0, 0, 400, 711);
    };
    try {
      fireEvent.click(document.querySelector('[data-title-block]') as Element);
      await waitFor(() =>
        expect(document.querySelector('[data-text-handle="title-se"]')).toBeTruthy());
    } finally {
      HTMLElement.prototype.getBoundingClientRect = vraiRect;
    }
  });

  it('tirer un coin agrandit le titre ; le rapprocher le réduit', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'Titre'));
    const avant = tailleTitre();
    fireEvent.pointerEnter(document.querySelector('[data-title-block]') as Element);
    const poignee = document.querySelector('[data-text-handle="title-se"]') as HTMLElement;

    const vraiRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function fake() {
      return { x: 0, y: 0, left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60, toJSON: () => ({}) } as DOMRect;
    };
    try {
      // Centre du bloc (100, 30) ; prise à 100 px, tirée à 150 px : × 1,5.
      fireEvent.pointerDown(poignee, { button: 0, isPrimary: true, pointerId: 7, clientX: 200, clientY: 30 });
      act(() => {
        poignee.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 250, clientY: 30, bubbles: true }));
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = vraiRect;
    }
    await waitFor(() => expect(tailleTitre()).toBeCloseTo(avant * 1.5, 0));
    // Pendant le geste, les poignées restent montées, même hors survol.
    fireEvent.pointerLeave(document.querySelector('[data-title-block]') as Element);
    expect(document.querySelector('[data-text-handle="title-se"]')).toBeTruthy();

    HTMLElement.prototype.getBoundingClientRect = function fake() {
      return { x: 0, y: 0, left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60, toJSON: () => ({}) } as DOMRect;
    };
    try {
      act(() => {
        poignee.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 150, clientY: 30, bubbles: true }));
        poignee.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = vraiRect;
    }
    await waitFor(() => expect(tailleTitre()).toBeLessThan(avant));
  });

  it('le CTA garde ses poignées et le même geste ; les cartes gardent les leurs', async () => {
    await ouvrirStyle();
    fireEvent.click(onglet(document, 'CTA'));
    fireEvent.pointerEnter(document.querySelector('[data-cta-block]') as Element);
    expect(document.querySelector('[data-text-handle="cta-se"]')).toBeTruthy();

    fireEvent.click(onglet(document, 'Cartes'));
    fireEvent.pointerEnter(document.querySelector('[data-card-id]') as Element);
    expect(document.querySelector('[data-card-handle$="-se"]')).toBeTruthy();
  });
});
