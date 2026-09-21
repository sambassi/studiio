import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * L'écran de l'Autopilote, étape « Publication » : l'heure de publication à
 * la minute, et les trois intentions de diffusion.
 *
 * Le VRAI panneau est monté ; l'API est doublée. Ce qu'on lit, c'est ce que
 * le panneau ENVOIE (`PUT /api/autopilot/config`) et ce qu'il affiche —
 * pas une regex sur le source.
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

import AutopilotPanel from '../components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, type AutopilotConfig } from '../lib/autopilot/rules';

/** Ce que la base « contient » ; chaque PUT accepté la remplace. */
let enBase: AutopilotConfig;
/** Les corps des PUT, dans l'ordre. */
let puts: Array<Record<string, unknown>>;
/** La colonne `publish_time` existe-t-elle côté serveur ? */
let colonneHeure: boolean;

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        puts.push(recu);
        enBase = { ...enBase, ...(recu as Partial<AutopilotConfig>) };
        if (!colonneHeure) enBase.publishTime = '18:00';
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, brandingReady: true, publishTimeReady: colonneHeure, config: enBase }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, ready: true, brandingReady: true, publishTimeReady: colonneHeure, config: enBase }),
      } as unknown as Response;
    }
    if (u.includes('/api/voice/clone')) {
      return { ok: true, status: 200, json: async () => ({ success: true, voices: [] }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, success: true, sessions: [], luts: [], items: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  enBase = { ...DEFAULT_CONFIG, rushUrls: ['https://x/a.mp4'] };
  puts = [];
  colonneHeure = true;
  stubApi();
});
afterEach(() => { cleanup(); });

async function monter() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('De quoi Studiio doit-il parler ?')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="3"]')!);
  await waitFor(() => expect(document.querySelector('[data-autopilot-publish-time]')).not.toBeNull());
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const carte = (i: string) => q<HTMLButtonElement>(`[data-autopilot-intention="${i}"]`)!;
const dernierPut = () => puts[puts.length - 1];

describe('L heure de publication', () => {
  it('⚠️ « 18:45 » est envoyé tel quel — les minutes sont conservées', async () => {
    await monter();
    const champ = q<HTMLInputElement>('[data-autopilot-publish-time]')!;
    expect(champ.type).toBe('time');
    expect(champ.step).toBe('60');
    expect(champ.value).toBe('18:00');
    await act(async () => { fireEvent.change(champ, { target: { value: '18:45' } }); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().publishTime).toBe('18:45');
    // Et l'heure de PRODUCTION n'a pas bougé : deux réglages distincts.
    expect(dernierPut().runHour).toBe(DEFAULT_CONFIG.runHour);
    await waitFor(() => expect(q<HTMLInputElement>('[data-autopilot-publish-time]')!.value).toBe('18:45'));
  });

  it('une saisie incomplète (champ vide) n écrit rien — pas de retour forcé à 18:00', async () => {
    await monter();
    const champ = q<HTMLInputElement>('[data-autopilot-publish-time]')!;
    await act(async () => { fireEvent.change(champ, { target: { value: '' } }); });
    expect(puts).toHaveLength(0);
  });

  it('la phrase de diffusion dit les DEUX heures, séparément', async () => {
    enBase = { ...enBase, mode: 'auto', platforms: ['instagram', 'tiktok'], publishTime: '19:15', runHour: 8 };
    await monter();
    const phrase = q('[data-autopilot-phrase-diffusion]')!.textContent!;
    expect(phrase).toContain('produite à 08:00');
    expect(phrase).toContain('le lendemain à 19:15 sur Instagram, TikTok');
    expect(phrase).toContain('publication automatique');
  });

  it('l heure de production reste une liste de 24 heures entières', async () => {
    await monter();
    const select = q<HTMLSelectElement>('[data-autopilot-hour]')!;
    expect(select.options).toHaveLength(24);
    await act(async () => { fireEvent.change(select, { target: { value: '9' } }); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().runHour).toBe(9);
    expect(dernierPut().publishTime).toBe('18:00');
  });

  it('⚠️ quand la colonne manque, l écran le dit au lieu d un champ sans effet', async () => {
    colonneHeure = false;
    await monter();
    expect(q('[data-autopilot-publish-time-absente]')).not.toBeNull();
    expect(q('[data-autopilot-publish-time-absente]')!.textContent).toMatch(/2026-09-21-autopilot-publish-time/);
  });

  it('et la notice n apparaît pas quand la colonne existe', async () => {
    await monter();
    expect(q('[data-autopilot-publish-time-absente]')).toBeNull();
  });
});

describe('Les trois intentions', () => {
  it('sont toutes présentes, une seule choisie', async () => {
    await monter();
    for (const i of ['publier', 'valider', 'produire']) expect(carte(i), i).not.toBeNull();
    // Configuration par défaut : review + aucun réseau = produire seulement.
    expect(carte('produire').getAttribute('aria-pressed')).toBe('true');
    expect(carte('valider').getAttribute('aria-pressed')).toBe('false');
    expect(carte('publier').getAttribute('aria-pressed')).toBe('false');
    // Les repères historiques restent : chaque carte dit son mode.
    expect(carte('publier').getAttribute('data-autopilot-mode')).toBe('auto');
    expect(carte('valider').getAttribute('data-autopilot-mode')).toBe('review');
    expect(carte('produire').getAttribute('data-autopilot-mode')).toBe('review');
  });

  it('« produire seulement » masque les réseaux et explique le téléchargement', async () => {
    await monter();
    expect(q('[data-autopilot-reseaux-masques]')).not.toBeNull();
    expect(q('[data-autopilot-reseaux-masques]')!.textContent).toMatch(/brouillon.*Calendrier/);
    expect(q('[data-autopilot-reseaux-masques]')!.textContent).toMatch(/export sécurisé/);
    expect(q('[data-autopilot-platform="instagram"]')).toBeNull();
    expect(carte('produire').textContent).toMatch(/rendu facturé/);
  });

  it('⚠️ « publier » est désactivé tant qu aucun réseau n est choisi, et dit pourquoi', async () => {
    await monter();
    expect(carte('publier').disabled).toBe(true);
    expect(q('[data-autopilot-intention-bloquee]')!.textContent).toMatch(/Aucun réseau choisi/);
  });

  it('« me laisser valider » rend le sélecteur de réseaux — puis « publier » s ouvre', async () => {
    await monter();
    await act(async () => { fireEvent.click(carte('valider')); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().mode).toBe('review');
    expect(q('[data-autopilot-reseaux-masques]')).toBeNull();
    const insta = q<HTMLButtonElement>('[data-autopilot-platform="instagram"]');
    expect(insta).not.toBeNull();

    await act(async () => { fireEvent.click(insta!); });
    await waitFor(() => expect(puts.length).toBe(2));
    expect(dernierPut().platforms).toEqual(['instagram']);
    expect(dernierPut().mode).toBe('review');
    await waitFor(() => expect(carte('publier').disabled).toBe(false));

    await act(async () => { fireEvent.click(carte('publier')); });
    await waitFor(() => expect(puts.length).toBe(3));
    expect(dernierPut().mode).toBe('auto');
    expect(dernierPut().platforms).toEqual(['instagram']);
    await waitFor(() => expect(carte('publier').getAttribute('aria-pressed')).toBe('true'));
  });

  it('⚠️ « produire seulement » vide les réseaux dans UN seul enregistrement', async () => {
    enBase = { ...enBase, mode: 'auto', platforms: ['instagram', 'tiktok'] };
    await monter();
    expect(carte('publier').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(carte('produire')); });
    await waitFor(() => expect(puts.length).toBe(1));
    expect(dernierPut().mode).toBe('review');
    expect(dernierPut().platforms).toEqual([]);
    await waitFor(() => expect(q('[data-autopilot-reseaux-masques]')).not.toBeNull());
    // Aucun statut, aucune colonne de plus : rien d'autre que mode et réseaux.
    expect(Object.keys(dernierPut())).not.toContain('intention');
  });

  it('revenir de « produire » à « valider » rend le sélecteur, vide', async () => {
    enBase = { ...enBase, mode: 'review', platforms: [] };
    await monter();
    await act(async () => { fireEvent.click(carte('valider')); });
    await waitFor(() => expect(q('[data-autopilot-platform="instagram"]')).not.toBeNull());
    for (const p of ['instagram', 'tiktok', 'facebook', 'youtube']) {
      expect(q(`[data-autopilot-platform="${p}"]`)!.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('le récapitulatif dit l intention et les deux heures', async () => {
    enBase = { ...enBase, mode: 'review', platforms: [], publishTime: '18:45' };
    await monter();
    fireEvent.click(document.querySelector('[data-autopilot-etape="5"]')!);
    await waitFor(() => expect(q('[data-autopilot-recap="diffusion"]')).not.toBeNull());
    const recap = q('[data-autopilot-recap="diffusion"]')!.textContent!;
    expect(recap).toContain('Heure de départ');
    expect(recap).toContain('Heure de publication');
    expect(recap).toContain('18:45');
    expect(recap).toMatch(/Produire seulement/);
    expect(recap).toMatch(/à télécharger/);
  });
});
