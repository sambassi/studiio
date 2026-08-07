import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * Régler CHAQUE séquence en double-cliquant dessus.
 *
 * ⚠️ « CERTAINES SÉQUENCES » N'EST PAS UNE FONCTIONNALITÉ. Le double-clic
 * ouvrait un panneau pour le titre, le CTA et les cartes — mais pas pour le
 * sous-titre, et pas du tout dans l'assistant. Un geste qui marche sur trois
 * éléments sur quatre se lit comme un bug, pas comme une limite.
 *
 * ⚠️ ET LES DEUX ÉCRANS NE PROMETTENT PAS LA MÊME CHOSE. L'assistant produit
 * UN montage : son texte s'édite. L'Autopilote en produit un différent à
 * chaque cycle : y figer une phrase détruirait la variété qui fait tout son
 * intérêt — seul le STYLE y est constant, et le panneau le dit.
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

import AssistantWizard from '@/app/dashboard/creer-simple/AssistantWizard';

let clientWidthOriginal: PropertyDescriptor | undefined;

beforeEach(() => {
  window.localStorage.clear();
  clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true, get() { return 400; },
  });
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
  if (clientWidthOriginal) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthOriginal);
  }
});

/** Ouvre l'assistant jusqu'à l'étape Style, où l'aperçu est peuplé. */
async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByText('Commencer'));
  fireEvent.click(screen.getByText('Continuer'));
  await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
}

// ─────────────────────────────────────────────────────────────────────────
describe('Créer simple — chaque séquence s ouvre au double-clic', () => {
  const ZONES = [
    ['[data-title-block]', 'title'],
    ['[data-subtitle-block]', 'subtitle'],
    ['[data-card-id]', 'cards'],
    ['[data-cta-block]', 'cta'],
  ] as const;

  for (const [selecteur, zone] of ZONES) {
    it(`double-cliquer ${zone} ouvre SON panneau`, async () => {
      await ouvrirStyle();
      const cible = document.querySelector(selecteur);
      expect(cible, selecteur).toBeTruthy();
      fireEvent.doubleClick(cible!);
      await waitFor(() =>
        expect(document.querySelector(`[data-zone-panneau="${zone}"]`)).toBeTruthy());
    });
  }

  it('le sous-titre ouvre le SIEN, pas celui du titre', async () => {
    // ⚠️ LES DEUX VIVENT DANS LE MEME CADRE : sans `stopPropagation`, un
    // double-clic sur le sous-titre remontait au bloc de titre et ouvrait le
    // panneau du TITRE. L'utilisateur reglait une zone en en voyant changer
    // une autre.
    await ouvrirStyle();
    fireEvent.doubleClick(document.querySelector('[data-subtitle-block]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-zone-panneau="subtitle"]')).toBeTruthy());
    expect(document.querySelector('[data-zone-panneau="title"]')).toBeNull();
  });

  it('éditer le texte du titre met l aperçu à jour', async () => {
    await ouvrirStyle();
    fireEvent.doubleClick(document.querySelector('[data-title-block]') as Element);
    const champ = await waitFor(() =>
      document.querySelector('[data-zone-texte="title"]') as HTMLTextAreaElement);
    fireEvent.change(champ, { target: { value: 'Mon titre à moi' } });
    await waitFor(() => {
      expect((document.querySelector('[data-title-block]') as HTMLElement).textContent)
        .toContain('Mon titre à moi');
    });
  });

  it('les CARTES n ont pas de champ de texte — leur contenu vit ailleurs', async () => {
    // ⚠️ ELLES N'ONT PAS UN TEXTE MAIS N. Leur contenu se regle a l'etape
    // « Contenu », carte par carte : un champ de plus ici donnerait deux
    // endroits pour la meme chose.
    await ouvrirStyle();
    fireEvent.doubleClick(document.querySelector('[data-card-id]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-zone-panneau="cards"]')).toBeTruthy());
    expect(document.querySelector('[data-zone-texte="cards"]')).toBeNull();
    // Mais la mise en forme, elle, est bien la.
    expect(document.querySelector('[data-format-toolbar="cards"]')).toBeTruthy();
  });

  it('chaque panneau porte la barre de format partagée', async () => {
    await ouvrirStyle();
    for (const [selecteur, zone] of ZONES) {
      fireEvent.doubleClick(document.querySelector(selecteur)!);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() =>
        expect(document.querySelector(`[data-format-toolbar="${zone}"]`)).toBeTruthy());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Autopilote — le style est réglable, le contenu varie', () => {
  const monter = async () => {
    render(<AssistantWizard />);
    return waitFor(() => document.querySelector('[data-autopilot-apercu]') as HTMLElement);
  };

  it('le sous-titre a désormais SON panneau', async () => {
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-subtitle-block]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-texte-panneau="subtitle"]')).toBeTruthy());
  });

  it('il annonce que le TEXTE change à chaque vidéo', async () => {
    // ⚠️ SANS CETTE PHRASE, l'utilisateur cherche un champ de texte qui
    // n'existe pas — et conclut que le panneau est incomplet.
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-title-block]') as Element);
    const panneau = await waitFor(() =>
      document.querySelector('[data-autopilot-texte-panneau="title"]') as HTMLElement);
    expect(panneau.textContent).toContain('change à chaque vidéo');
  });

  it('et n expose AUCUN champ de texte — la variété serait perdue', async () => {
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-title-block]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-texte-panneau="title"]')).toBeTruthy());
    expect(document.querySelector('[data-zone-texte="title"]')).toBeNull();
  });

  it('le sous-titre ne propose ni gras ni italique — il les hérite du titre', async () => {
    // `drawIntro` et `SequenceTitle` les lui imposent : les proposer
    // promettrait un reglage sans effet.
    const apercu = await monter();
    fireEvent.doubleClick(apercu.querySelector('[data-subtitle-block]') as Element);
    await waitFor(() =>
      expect(document.querySelector('[data-format-toolbar="subtitle"]')).toBeTruthy());
    expect(document.querySelector('[data-format="bold-subtitle"]')).toBeNull();
    // Souligne, barre, casse et alignement, eux, sont bien la.
    expect(document.querySelector('[data-format="underline-subtitle"]')).toBeTruthy();
  });
});
