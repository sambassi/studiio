import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/**
 * Fil d'étapes du parcours « Créer ».
 *
 * Deux garanties, vérifiées sur le COMPOSANT monté et non sur son source :
 *
 * 1. **Le nombre d'étapes annoncé est celui du parcours.** La carte d'accueil
 *    promettait « Quatre étapes » alors que « Audio » avait été ajoutée depuis :
 *    le texte est désormais dérivé de `STEPS`, et ce test échouera si quelqu'un
 *    le réécrit à la main.
 *
 * 2. **Seule une étape DÉJÀ franchie ramène en arrière.** L'étape courante et
 *    les suivantes doivent rester inertes : y sauter afficherait un écran dont
 *    le contenu n'a pas été préparé. Le test vérifie les deux côtés de la
 *    condition — ce qui est cliquable, et ce qui ne doit pas l'être.
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
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>(
    '@/lib/fonts/catalog',
  );
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';

/** Libellés du parcours, dans l'ordre. Doit rester aligné sur `STEPS`. */
const ETAPES = ['Sujet', 'Style', 'Audio', 'Contenu', 'Envoi'];

/** Le bouton d'une étape du fil, retrouvé par son libellé accessible. */
const boutonEtape = (i: number) =>
  screen.getByRole('button', {
    name: new RegExp(`étape ${i + 1}\\s*:\\s*${ETAPES[i]}`, 'i'),
  });

/** Démarre l'assistant : l'écran d'accueil précède le fil d'étapes. */
const demarrer = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Commencer$/i }));
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('nombre d’étapes annoncé', () => {
  it('annonce autant d’étapes que le parcours en contient', () => {
    render(<AssistantWizard />);
    const carte = screen.getByText(/étapes —/i).textContent || '';
    expect(carte).toContain(`${ETAPES.length} étapes`);
    // La promesse « Quatre étapes » oubliait « audio » : elle ne doit pas revenir.
    expect(carte).not.toMatch(/quatre/i);
    for (const label of ETAPES) {
      expect(carte.toLowerCase()).toContain(label.toLowerCase());
    }
  });
});

describe('fil d’étapes cliquable', () => {
  it('au démarrage, aucune étape n’est cliquable', () => {
    render(<AssistantWizard />);
    demarrer();
    // step = 0 : `i < step` est faux partout, y compris pour l'étape courante.
    for (let i = 0; i < ETAPES.length; i++) {
      expect(boutonEtape(i)).toBeDisabled();
    }
  });

  it('après avoir avancé, seule l’étape franchie est cliquable', () => {
    render(<AssistantWizard />);
    demarrer();
    fireEvent.click(screen.getByRole('button', { name: /^Continuer$/i }));

    // step = 1 : l'étape 1 est franchie, l'étape courante et les suivantes non.
    expect(boutonEtape(0)).toBeEnabled();
    expect(boutonEtape(1)).toBeDisabled();
    expect(boutonEtape(2)).toBeDisabled();
    expect(boutonEtape(3)).toBeDisabled();
    expect(boutonEtape(4)).toBeDisabled();
  });

  it('cliquer une étape franchie y ramène en conservant les valeurs', () => {
    render(<AssistantWizard />);
    demarrer();

    // Valeur témoin saisie à l'étape 1.
    const champ = document.querySelector(
      'input[type="text"], textarea',
    ) as HTMLInputElement | null;
    expect(champ).not.toBeNull();
    fireEvent.change(champ!, { target: { value: 'yoga du matin' } });
    expect(champ!.value).toBe('yoga du matin');

    fireEvent.click(screen.getByRole('button', { name: /^Continuer$/i }));
    expect(boutonEtape(0)).toBeEnabled();

    act(() => {
      fireEvent.click(boutonEtape(0));
    });

    const champApres = document.querySelector(
      'input[type="text"], textarea',
    ) as HTMLInputElement | null;
    expect(champApres).not.toBeNull();
    expect(champApres!.value).toBe('yoga du matin');
    // Retour effectif : plus aucune étape n'est franchie.
    expect(boutonEtape(0)).toBeDisabled();
  });

  it('les boutons portent un libellé accessible et signalent l’étape courante', () => {
    render(<AssistantWizard />);
    demarrer();
    expect(boutonEtape(0)).toHaveAttribute('aria-current', 'step');
    expect(boutonEtape(1)).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: /^Continuer$/i }));
    // Une étape franchie invite explicitement au retour.
    expect(boutonEtape(0).getAttribute('aria-label')).toMatch(/revenir/i);
    expect(boutonEtape(1)).toHaveAttribute('aria-current', 'step');
  });
});
