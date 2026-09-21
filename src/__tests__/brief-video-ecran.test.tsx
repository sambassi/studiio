import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * Le brief de la vidéo, À L'ÉCRAN — les VRAIS composants sont montés.
 *
 * - Créer : la saisie à l'étape Sujet arrive dans le brouillon (localStorage),
 *   et le récapitulatif « Ce que la vidéo dira » mène à l'étape Contenu.
 * - Autopilote : la saisie à l'étape 1 part en `PUT /api/autopilot/config`
 *   sous `brief`, à la perte du focus (pas une écriture par frappe).
 * - L'aperçu de l'Autopilote se présente comme une DÉMONSTRATION, pas comme
 *   le script des futures vidéos.
 *
 * Rien ici ne déclenche une synthèse vocale ni un rendu : aucun appel
 * `/api/tts/*` ne doit partir.
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
import { draftKey } from '../lib/creer/draft';
import { DEFAULT_CONFIG, type AutopilotConfig } from '../lib/autopilot/rules';

const KEY = draftKey('a@b.c');
const lireBrouillon = () => {
  const raw = window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
};

let enBase: AutopilotConfig;
let puts: Array<Record<string, unknown>>;
let appelsTts: number;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    // Seule une SYNTHÈSE (POST) est payante ; lister les voix (GET) ne l'est pas.
    if (u.includes('/api/tts/') && String(init?.method ?? 'GET').toUpperCase() === 'POST') appelsTts += 1;
    if (u.includes('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        puts.push(recu);
        enBase = { ...enBase, ...(recu as Partial<AutopilotConfig>) };
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, brandingReady: true, publishTimeReady: true, briefReady: true, config: enBase }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, ready: true, brandingReady: true, publishTimeReady: true, briefReady: true, config: enBase }),
      } as unknown as Response;
    }
    if (u.includes('/api/voice/clone')) {
      return { ok: true, status: 200, json: async () => ({ success: true, voices: [] }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [], voices: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  enBase = { ...DEFAULT_CONFIG, rushUrls: ['https://x/a.mp4'] };
  puts = [];
  appelsTts = 0;
  stubApi();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;

const OBJECTIF = 'Donner envie de découvrir Afroboost à Neuchâtel et réserver un cours d’essai.';

describe('Créer — étape Sujet', () => {
  const settle = async () => { await act(async () => { vi.advanceTimersByTime(600); }); };

  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });

  it('le brief est saisi sous le sujet et arrive dans le brouillon', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    // Le champ du sujet existe toujours, et il est unique (les tests
    // existants le trouvent par /Ex\. :/).
    expect(screen.getByPlaceholderText(/Ex\. :/)).toBeTruthy();
    const bloc = q('[data-brief-video]')!;
    expect(bloc).not.toBeNull();
    for (const cle of ['objectif', 'message', 'public', 'cta']) {
      expect(q(`[data-brief-field="${cle}"]`), cle).not.toBeNull();
    }
    // L'exemple de l'utilisateur sert de placeholder.
    expect(q<HTMLTextAreaElement>('[data-brief-field="objectif"]')!.placeholder).toBe(OBJECTIF);

    fireEvent.change(q('[data-brief-field="objectif"]')!, { target: { value: OBJECTIF } });
    fireEvent.change(q('[data-brief-field="cta"]')!, { target: { value: 'Réservez votre cours d’essai.' } });
    await settle();
    expect(lireBrouillon().brief).toEqual({ objectif: OBJECTIF, cta: 'Réservez votre cours d’essai.' });
    expect(appelsTts).toBe(0);
  });

  it('sans saisie, le brouillon ne porte pas de brief', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.change(screen.getByPlaceholderText(/Ex\. :/), { target: { value: 'danse' } });
    await settle();
    expect(lireBrouillon().customTopic).toBe('danse');
    expect('brief' in lireBrouillon()).toBe(false);
  });

  it('« Ce que la vidéo dira » dit ce qui manque, puis mène à l étape Contenu', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    const recap = q('[data-brief-narration]')!;
    expect(recap.textContent).toContain('Ce que la vidéo dira');
    // Rien de généré : on le dit, et on ne génère rien.
    expect(q('[data-brief-narration-vide]')).not.toBeNull();
    expect(recap.textContent).toContain('Rien n’est généré ni facturé ici');
    const lien = q<HTMLButtonElement>('[data-brief-modifier-narration]')!;
    expect(lien.textContent).toContain('Modifier le texte de la narration (étape Contenu)');
    fireEvent.click(lien);
    await waitFor(() => expect(screen.getByText('Votre contenu')).toBeTruthy());
    await settle();
    expect(lireBrouillon().step).toBe(3);
    expect(appelsTts).toBe(0);
  });

  it('une fois le contenu généré, le récapitulatif montre le texte EXACT des narrations, brief compris', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.change(q('[data-brief-field="cta"]')!, { target: { value: 'Réservez votre cours d’essai.' } });
    fireEvent.click(q('[data-brief-modifier-narration]')!);
    // La génération locale (smart-content) tourne sur une minuterie de 30 ms.
    await waitFor(() => expect(screen.getByText('Votre contenu')).toBeTruthy());
    await settle();
    // Retour à l'étape Sujet : le récapitulatif lit les textes courants.
    await act(async () => { fireEvent.click(q('[data-step="0"]')!); });
    await waitFor(() => expect(q('[data-brief-narration-sequence="cta"]')).not.toBeNull());
    expect(q('[data-brief-narration-sequence="cta"]')!.textContent).toContain('Réservez votre cours d’essai.');
    expect(q('[data-brief-narration-sequence="titre"]')).not.toBeNull();
    expect(appelsTts).toBe(0);
  });
});

describe('Autopilote — étape 1 Sujets', () => {
  async function monter() {
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
    await waitFor(() => expect(q('[data-brief-video]')).not.toBeNull());
  }

  it('le brief récurrent est saisi à l étape 1 et part en PUT sous `brief`, à la perte du focus', async () => {
    await monter();
    expect(q('[data-brief-video]')!.textContent).toContain('Brief récurrent');
    const champ = q<HTMLTextAreaElement>('[data-brief-field="objectif"]')!;
    await act(async () => { fireEvent.change(champ, { target: { value: OBJECTIF } }); });
    // La frappe n'écrit rien.
    expect(puts).toHaveLength(0);
    await act(async () => { fireEvent.blur(champ); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0].brief).toEqual({ objectif: OBJECTIF });
    // Le reste de la configuration n'a pas bougé.
    expect(puts[0].cadence).toBe(DEFAULT_CONFIG.cadence);
    // Un second blur sans changement n'écrit pas une seconde fois.
    await act(async () => { fireEvent.blur(champ); });
    expect(puts).toHaveLength(1);
    expect(appelsTts).toBe(0);
  });

  it('un brief déjà en base est affiché', async () => {
    enBase = { ...enBase, brief: { cta: 'Réservez.' } };
    await monter();
    expect(q<HTMLTextAreaElement>('[data-brief-field="cta"]')!.value).toBe('Réservez.');
    expect(q('[data-autopilot-brief-recap-champ="cta"]')!.textContent).toContain('Réservez.');
  });

  it('« Ce que dira chaque vidéo » distingue le brief du script, et n annonce aucun audio', async () => {
    await monter();
    const recap = q('[data-autopilot-brief-recap]')!;
    expect(recap.textContent).toContain('Ce que dira chaque vidéo');
    expect(q('[data-autopilot-brief-recap-vide]')).not.toBeNull();
    expect(q('[data-autopilot-brief-recap-note]')!.textContent).toContain('produite à chaque cycle');
    expect(q('[data-autopilot-brief-recap-note]')!.textContent).toContain('Aucun audio n’existe avant le rendu');
  });

  it('sans la colonne, l écran dit que le brief ne sera pas conservé', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/autopilot/config')) {
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, ready: true, brandingReady: true, publishTimeReady: true, briefReady: false, config: enBase }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, voices: [], sessions: [], items: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await monter();
    expect(q('[data-autopilot-brief-absent]')!.textContent).toContain('2026-09-21-autopilot-brief');
  });
});

describe('Autopilote — l aperçu est une démonstration', () => {
  it('le libellé le dit, et distingue le script de chaque vidéo', async () => {
    render(<AssistantWizard />);
    fireEvent.click(q('[data-parcours-autopilote]')!);
    const mention = await waitFor(() => q('[data-autopilot-script-exemple]')!);
    expect(mention.textContent).toContain('Exemple de démonstration');
    expect(mention.textContent).toContain('le script de chaque vidéo est généré à sa production à partir de votre brief');
  });
});
