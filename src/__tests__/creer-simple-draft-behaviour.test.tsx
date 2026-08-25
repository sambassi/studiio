import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/**
 * Sauvegarde du brouillon — vérifiée sur le COMPOSANT, pas sur son source.
 *
 * L'audit a montré que toute la couche testée par expressions régulières
 * fonctionnait « sur le papier » et échouait en vrai : au rafraîchissement,
 * `useSession()` rend `undefined` au premier rendu, la restauration lisait
 * donc la clé anonyme, ne trouvait rien — puis la sauvegarde écrasait la clé
 * du compte avec l'état par défaut. La fonctionnalité échouait exactement
 * dans le cas pour lequel elle avait été écrite.
 *
 * Ces tests montent le vrai wizard et pilotent la session comme le fait
 * next-auth : `loading` d'abord, puis résolue.
 */

// jsdom ne connait pas `ResizeObserver`, dont l'apercu se sert pour mesurer
// son plateau. Un double inerte suffit : la mise a l'echelle ne concerne pas
// ces tests.
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

// `useBranding` lit le localStorage ; on le laisse tel quel. En revanche le
// catalogue de polices déclenche des requêtes réseau : inutile ici.
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>(
    '@/lib/fonts/catalog',
  );
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const KEY = draftKey('a@b.c');
const ANON = draftKey();

const readKey = (k: string) => {
  const raw = window.localStorage.getItem(k);
  return raw ? JSON.parse(raw) : null;
};

/** Session résolue, comme après une navigation interne. */
const resolved = () => {
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
};
/** Session en cours de résolution, comme au premier rendu après un F5. */
const loading = () => {
  sessionState = { data: undefined, status: 'loading' };
};

beforeEach(() => {
  window.localStorage.clear();
  resolved();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Laisse passer la minuterie de sauvegarde. */
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
};

/** Démarre le parcours et pose un sujet — le minimum pour avoir du travail. */
const startAndType = async (topic: string) => {
  fireEvent.click(screen.getByText('Commencer'));
  const input = screen.getByPlaceholderText(/Ex\. :/);
  fireEvent.change(input, { target: { value: topic } });
  await settle();
};

describe('Le rafraîchissement restaure — c’est tout l’objet', () => {
  it('attend la session avant de restaurer, et n’écrase rien entre-temps', async () => {
    // LE bug : `useSession()` rend `undefined` au premier rendu. Restaurer à
    // ce moment lisait la clé anonyme et la sauvegarde écrasait ensuite la
    // clé du compte avec l'état par défaut.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: DRAFT_VERSION, savedAt: 1, started: true, customTopic: 'yoga du matin' }),
    );

    loading();
    const view = render(<AssistantWizard />);
    await settle();
    // Rien n'a été écrit tant que la session n'était pas connue.
    expect(readKey(ANON)).toBeNull();
    expect(readKey(KEY).customTopic).toBe('yoga du matin');

    // La session arrive : la restauration a lieu maintenant.
    resolved();
    view.rerender(<AssistantWizard />);
    await settle();
    expect((screen.getByPlaceholderText(/Ex\. :/) as HTMLInputElement).value).toBe('yoga du matin');
    expect(readKey(KEY).customTopic).toBe('yoga du matin');
  });

  it('rend le sujet après un cycle complet démontage / remontage', async () => {
    render(<AssistantWizard />);
    await startAndType('récupération après le sport');
    cleanup();

    render(<AssistantWizard />);
    await settle();
    expect((screen.getByPlaceholderText(/Ex\. :/) as HTMLInputElement).value).toBe(
      'récupération après le sport',
    );
  });

  it('annonce ce qui a été retrouvé', async () => {
    render(<AssistantWizard />);
    await startAndType('sujet');
    cleanup();
    render(<AssistantWizard />);
    await settle();
    expect(screen.getByText(/Brouillon restauré/)).toBeDefined();
  });
});

describe('Sans travail, pas de brouillon', () => {
  it('n’écrit rien quand on ne fait que passer', async () => {
    // Une visite sans action laissait un brouillon par défaut, et la visite
    // suivante annonçait « Brouillon restauré » sur un écran vierge.
    render(<AssistantWizard />);
    await settle();
    expect(readKey(KEY)).toBeNull();
    expect(readKey(ANON)).toBeNull();
  });

  it('n’annonce rien à la visite suivante', async () => {
    render(<AssistantWizard />);
    await settle();
    cleanup();
    render(<AssistantWizard />);
    await settle();
    expect(screen.queryByText(/Brouillon restauré/)).toBeNull();
  });
});

describe('Quand l’écriture a lieu', () => {
  it('attend la pause de frappe — pas une écriture par caractère', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByText('Commencer'));
    const input = screen.getByPlaceholderText(/Ex\. :/);

    const spy = vi.spyOn(Storage.prototype, 'setItem');
    for (const v of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      fireEvent.change(input, { target: { value: v } });
      await act(async () => { vi.advanceTimersByTime(50); });
    }
    const during = spy.mock.calls.filter((c) => String(c[0]).startsWith('studiio_creer')).length;
    await settle();
    const after = spy.mock.calls.filter((c) => String(c[0]).startsWith('studiio_creer')).length;
    spy.mockRestore();

    // Cinq frappes rapprochées : aucune écriture avant la pause.
    expect(during).toBe(0);
    expect(after).toBeGreaterThan(0);
  });

  it('écrit au démontage — la navigation interne ne lève pas `beforeunload`', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByText('Commencer'));
    fireEvent.change(screen.getByPlaceholderText(/Ex\. :/), { target: { value: 'juste avant' } });
    // On démonte AVANT la fin de la minuterie.
    cleanup();
    expect(readKey(KEY).customTopic).toBe('juste avant');
  });

  it('écrit sur `pagehide`', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByText('Commencer'));
    fireEvent.change(screen.getByPlaceholderText(/Ex\. :/), { target: { value: 'onglet fermé' } });
    window.dispatchEvent(new Event('pagehide'));
    expect(readKey(KEY).customTopic).toBe('onglet fermé');
  });
});

describe('Repartir de zéro', () => {
  it('efface pour de bon — `pagehide` ne le ressuscite pas', async () => {
    // Le rechargement lève `pagehide` : sans garde dans l'écriture, le
    // brouillon effacé revenait à l'identique.
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<AssistantWizard />);
    await startAndType('à effacer');
    cleanup();
    render(<AssistantWizard />);
    await settle();
    expect(readKey(KEY)).not.toBeNull();

    fireEvent.click(screen.getByText('Repartir de zéro'));
    expect(reload).toHaveBeenCalled();
    expect(readKey(KEY)).toBeNull();

    // Ce que le rechargement va lever, et le démontage qui suit.
    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    expect(readKey(KEY)).toBeNull();
  });
});
