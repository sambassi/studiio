import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Hygiène de la banque de rushes, VISIBLE dans l'écran (étape « Rushes »).
 *
 * Au chargement de la configuration, l'écran vérifie chaque rush et affiche,
 * par rush, « accessible » ou « expiré (rétention 24 h) — réimportez-le ». Un
 * bouton retire les expirés en UN `enregistrer({ rushUrls: vivants })` — rien
 * n'est supprimé sans clic.
 */

const A = 'https://projet.supabase.co/storage/v1/object/public/media/u/a.mp4';
const DEAD = 'https://projet.supabase.co/storage/v1/object/public/media/u/dead.mp4';

let envois: AutopilotConfig[];
let configServeur: AutopilotConfig;
/** Ce que la route de vérification renvoie, par URL. */
let resultats: Record<string, boolean>;
let appelsVerif: number;

beforeEach(() => {
  envois = [];
  configServeur = { ...DEFAULT_CONFIG, rushUrls: [A, DEAD] };
  resultats = { [A]: true, [DEAD]: false };
  appelsVerif = 0;

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: [] }) };
    }
    if (u.startsWith('/api/autopilot/rush/verifier')) {
      appelsVerif += 1;
      const corps = JSON.parse(String(init?.body ?? '{}')) as { urls?: string[] };
      const rep: Record<string, boolean> = {};
      for (const url2 of corps.urls ?? []) if (url2 in resultats) rep[url2] = resultats[url2];
      return { ok: true, json: async () => ({ success: true, resultats: rep, refusees: [] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(recu);
        configServeur = recu;
        return { ok: true, json: async () => ({ success: true, config: recu }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrirRushes() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-add-rush]')).toBeTruthy());
}

describe('L écran signale les rushes expirés', () => {
  it('un rush 404 est marqué « expiré », l autre « accessible »', async () => {
    await ouvrirRushes();
    await waitFor(() => expect(document.querySelector(`[data-autopilot-rush-expire="${DEAD}"]`)).toBeTruthy());
    expect(document.querySelector(`[data-autopilot-rush-accessible="${A}"]`)).toBeTruthy();
    // La vérification a bien été appelée avec la banque.
    expect(appelsVerif).toBeGreaterThan(0);
  });

  it('« Retirer les expirés » enregistre les vivants en UN seul PUT', async () => {
    await ouvrirRushes();
    await waitFor(() => expect(document.querySelector('[data-autopilot-retirer-expires]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-retirer-expires]') as Element);
    await waitFor(() => expect(envois.length).toBe(1));
    // Le rush mort a disparu ; le vivant reste. UN seul enregistrement.
    expect(envois[0].rushUrls).toEqual([A]);
    expect(envois.length).toBe(1);
  });

  it('sans expiré, aucun bandeau de retrait', async () => {
    resultats = { [A]: true, [DEAD]: true };
    await ouvrirRushes();
    await waitFor(() => expect(document.querySelector(`[data-autopilot-rush-accessible="${A}"]`)).toBeTruthy());
    expect(document.querySelector('[data-autopilot-retirer-expires]')).toBeNull();
    expect(document.querySelector('[data-autopilot-rush-expire-lot]')).toBeNull();
  });
});
