import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * L'écran d'entrée de « Créer » et le guidage de l'Autopilote — l'UX qui
 * empêche de se perdre entre les deux parcours.
 *
 * Ce que ces tests verrouillent (et dont le retour serait une régression) :
 * - UNE seule action principale à l'écran d'entrée : « Créer une vidéo » ;
 * - les deux parcours sont dits par leur résultat : UNE vidéo maintenant /
 *   PLUSIEURS contenus automatiquement ;
 * - l'Autopilote ne se déplie qu'à la demande, et se replie ;
 * - dans l'Autopilote : une phrase « À faire maintenant » à chaque étape, la
 *   banque de rushes (requise) avant les sessions ponctuelles (repliées), le
 *   bouton par rush nommé par sa portée et non primaire, « Lancer
 *   l'Autopilote » en dernière action.
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

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import AutopilotPanel from '../components/creer/AutopilotPanel';
import PassagesSuggeres from '../components/creer/PassagesSuggeres';
import { DEFAULT_CONFIG } from '../lib/autopilot/rules';

/** L'API de l'Autopilote, doublée au minimum : une configuration chargée. */
let rushUrls: string[];
function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = JSON.parse(String(init.body ?? '{}'));
        if (Array.isArray(recu.rushUrls)) rushUrls = recu.rushUrls;
        return { ok: true, status: 200, json: async () => ({ success: true, brandingReady: true, config: { ...DEFAULT_CONFIG, rushUrls } }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, ready: true, brandingReady: true, config: { ...DEFAULT_CONFIG, rushUrls } }) } as unknown as Response;
    }
    if (u.includes('/api/voice/clone')) {
      return { ok: true, status: 200, json: async () => ({ success: true, voices: [] }) } as unknown as Response;
    }
    if (u.includes('/api/autopilot/analyses/') && u.includes('/candidats')) {
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, generation: {
          id: 'g1', etat: 'reussie', modele: null, creeeLe: '2026-09-14T00:00:00.000Z',
          candidats: [{ rang: 1, secondeReference: 2, dureeCibleSecondes: 5, debutSecondes: 0, finSecondes: 5, scoreMontage: 80, raison: 'net' }],
        } }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  rushUrls = [];
  stubApi();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const settle = async () => { await act(async () => { vi.advanceTimersByTime(600); }); };

/** Les boutons PRIMAIRES visibles — ceux qui se disputent l'attention. */
const primairesVisibles = () =>
  Array.from(document.querySelectorAll('button.button-primary'))
    .filter((b) => !b.closest('[hidden]'));

describe('Écran d’entrée — un choix, une action principale', () => {
  it('⚠️ UNE seule action principale : « Créer une vidéo »', async () => {
    render(<AssistantWizard />);
    await settle();
    const primaires = primairesVisibles();
    expect(primaires).toHaveLength(1);
    expect(primaires[0].textContent).toBe('Créer une vidéo');
  });

  it('les deux parcours sont dits par leur résultat : une vidéo maintenant / plusieurs contenus', async () => {
    render(<AssistantWizard />);
    await settle();
    const choix = document.querySelector('[data-parcours-choix]')!;
    expect(choix.textContent).toMatch(/une vidéo maintenant/i);
    expect(choix.textContent).toMatch(/plusieurs contenus/i);
    expect(choix.textContent).toContain('Sujet → Style → Audio → Contenu → Envoi');
    // Plus de « Commencer » ambigu, plus de « Créer avec l'assistant ».
    expect(screen.queryByText('Commencer')).toBeNull();
    expect(screen.queryByText(/Créer avec l.assistant/)).toBeNull();
  });

  it('⚠️ l’Autopilote est REPLIÉ tant qu’on ne l’a pas choisi — mais reste monté', async () => {
    render(<AssistantWizard />);
    await settle();
    const panneau = document.querySelector('[data-parcours-autopilote-panneau]') as HTMLElement;
    expect(panneau.hidden).toBe(true);
    // Monté : sa configuration et son aperçu ne sont pas perdus.
    expect(panneau.querySelector('[data-autopilot-etapes]')).not.toBeNull();
    // Le CTA de l'Autopilote n'est PAS primaire : il ne concurrence pas l'assistant.
    const cta = screen.getByRole('button', { name: /Configurer l.Autopilote/ });
    expect(cta.className).not.toContain('button-primary');
  });

  it('« Configurer l’Autopilote » déplie le panneau, masque le choix, et « Changer de parcours » revient', async () => {
    render(<AssistantWizard />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Configurer l.Autopilote/ }));
    await settle();
    expect(document.querySelector('[data-parcours-choix]')).toBeNull();
    const panneau = document.querySelector('[data-parcours-autopilote-panneau]') as HTMLElement;
    expect(panneau.hidden).toBe(false);
    // Aucun bouton primaire de l'assistant ne reste en concurrence.
    expect(primairesVisibles().map((b) => b.textContent)).not.toContain('Créer une vidéo');
    expect(window.localStorage.getItem('studiio:creer:parcours')).toBe('autopilote');

    fireEvent.click(screen.getByRole('button', { name: 'Changer de parcours' }));
    await settle();
    expect(document.querySelector('[data-parcours-choix]')).not.toBeNull();
    expect(panneau.hidden).toBe(true);
    expect(window.localStorage.getItem('studiio:creer:parcours')).toBeNull();
  });

  it('le parcours Autopilote choisi survit au rechargement', async () => {
    window.localStorage.setItem('studiio:creer:parcours', 'autopilote');
    render(<AssistantWizard />);
    await settle();
    expect(document.querySelector('[data-parcours-choix]')).toBeNull();
    expect((document.querySelector('[data-parcours-autopilote-panneau]') as HTMLElement).hidden).toBe(false);
  });

  it('« Créer une vidéo » démarre l’assistant : l’Autopilote disparaît, une seule action à la fois', async () => {
    render(<AssistantWizard />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    await settle();
    expect(document.querySelector('[data-parcours-autopilote-panneau]')).toBeNull();
    expect(screen.getByText('Sujet')).toBeDefined();
  });
});

describe('Autopilote — guidage par étape', () => {
  async function monter() {
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
  }
  const allerEtape = (i: number) => fireEvent.click(document.querySelector(`[data-autopilot-etape="${i}"]`)!);

  it('chaque étape dit « À faire maintenant »', async () => {
    await monter();
    for (let i = 0; i < 6; i++) {
      allerEtape(i);
      const ligne = document.querySelector('[data-autopilot-a-faire]')!;
      expect(ligne.textContent, `étape ${i}`).toMatch(/^À faire maintenant :/);
      expect(ligne.textContent!.length, `étape ${i}`).toBeGreaterThan(25);
    }
  });

  it('⚠️ étape Rushes : la banque (requise) vient AVANT les sessions ponctuelles, repliées', async () => {
    await monter();
    allerEtape(1);
    const html = document.body.innerHTML;
    const iBanque = html.indexOf('Banque de rushes');
    const iSessions = html.indexOf('data-autopilot-sessions');
    expect(iBanque).toBeGreaterThan(-1);
    expect(iSessions).toBeGreaterThan(iBanque);
    const sessions = document.querySelector('[data-autopilot-sessions]') as HTMLDetailsElement;
    expect(sessions.open).toBe(false);
    expect(sessions.textContent).toMatch(/facultatif/);
    expect(sessions.textContent).toMatch(/indépendant de l.Autopilote/);
    // Le socle des tournages est toujours là, intact.
    expect(sessions.querySelector('[data-tournage-panel]')).not.toBeNull();
  });

  it('étape Rushes : l’état dit ce qui est prêt et ce qu’il reste à faire', async () => {
    await monter();
    allerEtape(1);
    const etat = document.querySelector('[data-autopilot-rushes-etat]')!;
    expect(etat.getAttribute('data-autopilot-rushes-etat')).toBe('a-faire');
    expect(etat.textContent).toMatch(/ajoutez au moins un rush/i);
    expect(document.querySelector('[data-autopilot-suivant-bloque]')).not.toBeNull();
    expect((document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('⚠️ la dernière action s’appelle « Lancer l’Autopilote », pas « Activer »', async () => {
    await monter();
    allerEtape(5);
    const toggle = document.querySelector('[data-autopilot-toggle]')!;
    expect(toggle.textContent).toBe('Lancer l’Autopilote');
    expect(screen.queryByText('Activer')).toBeNull();
    // Et c'est la seule action mise en avant : pas de « Suivant » sur le récapitulatif.
    expect(document.querySelector('[data-autopilot-suivant]')).toBeNull();
  });
});

describe('Bouton par rush — nommé par sa portée, jamais primaire', () => {
  it('⚠️ « Générer une vidéo de ce rush », style secondaire, avec sa portée dite', async () => {
    render(<PassagesSuggeres analyseId="an-1" />);
    const bouton = await screen.findByRole('button', { name: 'Générer une vidéo de ce rush' });
    expect(bouton.className).not.toMatch(/bg-purple-600/);
    expect(bouton.hasAttribute('data-action-secondaire')).toBe(true);
    expect(screen.queryByText('Créer ma vidéo')).toBeNull();
    const portee = document.querySelector('[data-chaine-portee]')!;
    expect(portee.textContent).toMatch(/ponctuelle/);
    expect(portee.textContent).toMatch(/L.Autopilote n.en a pas besoin/);
    // La fonction est intacte : le bouton porte toujours la chaîne.
    expect(bouton.getAttribute('data-chaine-bouton')).not.toBeNull();
  });
});
