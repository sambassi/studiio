import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * SOURCE DISPONIBLE = média réellement lisible (`validite-rush.ts`), À L'ÉCRAN.
 *
 * 3 rushes dont 1 expiré : « 2 rushes prêts », « Médias prévus » = 2, et la
 * même chose après un rechargement de l'écran. Un rush REFUSÉ par la garde de
 * sécurité ne compte pas, n'est ni « réimportez-le » ni retiré en lot, et son
 * adresse n'apparaît dans aucun message.
 */

const S = 'https://studiio.pro/storage/v1/object/public/media/u1/library/';
const R1 = `${S}r1.mp4`;
const R2 = `${S}r2.mp4`;
const R3 = `${S}r3.mp4`;

let envois: AutopilotConfig[];
let configServeur: AutopilotConfig;
let etats: Record<string, string>;
/** Réponse « d'avant » (booléens seuls) : aucun champ `etats`. */
let reponseAncienne: boolean;

beforeEach(() => {
  envois = [];
  configServeur = { ...DEFAULT_CONFIG, rushUrls: [R1, R2, R3] };
  etats = { [R1]: 'utilisable', [R2]: 'expire', [R3]: 'utilisable' };
  reponseAncienne = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
    if (u.startsWith('/api/autopilot/rush/verifier')) {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { urls?: string[] };
      const resultats: Record<string, boolean> = {};
      const e: Record<string, string> = {};
      for (const x of corps.urls ?? []) if (x in etats) { resultats[x] = etats[x] === 'utilisable'; e[x] = etats[x]; }
      return { ok: true, json: async () => (reponseAncienne ? { success: true, resultats, refusees: [] } : { success: true, resultats, etats: e, refusees: [] }) };
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

const compteur = () => document.querySelector('[data-autopilot-rushes-utilisables]') as HTMLElement;
const mediasRushes = () => document.querySelector('[data-autopilot-medias-rushes]')?.getAttribute('data-autopilot-medias-rushes');

describe('G — 3 rushes dont 1 expiré : 2 partout, et après rechargement', () => {
  it('« 2 rushes prêts », 1 indisponible, Médias prévus = 2', async () => {
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('2'));
    expect(compteur().textContent).toContain('2 rushes personnels');
    expect(document.querySelector('[data-autopilot-rushes-indisponibles="1"]')).toBeTruthy();
    expect(mediasRushes()).toBe('2');
    // Le rush expiré reste VISIBLE dans la banque, avec son état.
    expect(document.querySelector(`[data-autopilot-rush-expire="${R2}"]`)).toBeTruthy();
  });

  it('rechargement de l écran : même résumé', async () => {
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('2'));
    cleanup();
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('2'));
    expect(mediasRushes()).toBe('2');
  });

  it('réponse de vérification d’avant (booléens seuls) : même compte', async () => {
    reponseAncienne = true;
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('2'));
  });
});

describe('Rush refusé par la garde de sécurité', () => {
  it('ne compte pas, n est pas « réparable », n est pas retiré en lot, aucune adresse dans le message', async () => {
    etats = { [R1]: 'utilisable', [R2]: 'expire', [R3]: 'refuse' };
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('1'));
    // Pas de « réimportez-le » pour le refusé.
    expect(document.querySelector(`[data-autopilot-rush-expire="${R3}"]`)).toBeNull();
    const badge = document.querySelector('[data-autopilot-rush-refuse]') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).not.toContain('http');
    expect(badge.textContent).not.toMatch(/réimport/i);
    // Le retrait en lot ne retire QUE l'expiré — le refusé reste écrit (aucune modification sur un refus).
    fireEvent.click(document.querySelector('[data-autopilot-retirer-expires]') as Element);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0].rushUrls).toEqual([R1, R3]);
  });
});

describe('Sans vérification (réseau indisponible) : l écran d avant', () => {
  it('tous les rushes comptent tant que rien n est prouvé', async () => {
    etats = {};
    await ouvrirRushes();
    await waitFor(() => expect(compteur().getAttribute('data-autopilot-rushes-utilisables')).toBe('3'));
    expect(document.querySelector('[data-autopilot-rushes-indisponibles]')).toBeNull();
  });
});
