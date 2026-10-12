import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * Garanties de COÛT de « Suggérer » côté écran (Mon avatar → Ma voix) :
 * aucun appel à la route de suggestion (donc aucun appel Anthropic) au
 * chargement, à la saisie, à l'ouverture du formulaire, ni sur un clic
 * « Suggérer » quand la règle locale est sûre. La route n'est appelée QUE
 * sur clic explicite ET suggestion locale incertaine. `fetch` global espionné.
 */

const V1 = '44444444-4444-4444-8444-000000000001';
const ROUTE = '/api/voice/prononciations/suggestion';
const urls: string[] = [];
let suggestionJette = false;

function stub() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    urls.push(u);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    if (u === '/api/voice/profil') {
      return json(200, { success: true, data: {
        voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
        choix: null, voixResolue: { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
        motifVoix: null, messageVoix: null, ecouteDisponible: true,
        prononciations: [{ affiche: 'Neuchâtel', prononce: 'Neu-châ-tel' }],
      } });
    }
    if (u === ROUTE) {
      if (suggestionJette) throw new TypeError('Failed to fetch');
      return json(200, { success: true, data: { suggestion: body.affiche, source: 'locale' } });
    }
    if (u === '/api/voice/prononciations/ecoute') {
      return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
    }
    if (u === '/api/voice/profil/prononciations') return json(200, { success: true, data: { prononciations: body.prononciations } });
    return json(404, {});
  }) as unknown as typeof fetch;
}

class FausseAudio {
  src: string; onended: (() => void) | null = null;
  play = vi.fn(async () => {}); pause = vi.fn();
  constructor(src: string) { this.src = src; }
}

beforeEach(() => {
  urls.length = 0; suggestionJette = false;
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:x';
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  (globalThis as unknown as { Audio: unknown }).Audio = FausseAudio;
  stub();
});
afterEach(() => { cleanup(); });

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as unknown as T;
const appelsRoute = () => urls.filter((u) => u === ROUTE).length;
const appelsExternes = () => urls.filter((u) => /anthropic|^https?:/i.test(u)).length;
const champAffiche = () => q<HTMLInputElement>('[data-prononciation-affiche]');
const champPrononce = () => q<HTMLInputElement>('[data-prononciation-prononce]');

async function charger() {
  render(<MaVoixPanel />);
  await waitFor(() => expect(q('[data-prononciation-ajouter]')).not.toBeNull());
}

describe('MaVoixPanel — coût de « Suggérer »', () => {
  it('(1) chargement du panneau : aucun appel à la route de suggestion ni externe', async () => {
    await charger();
    await new Promise((r) => setTimeout(r, 20));
    expect(urls).toContain('/api/voice/profil');
    expect(appelsRoute()).toBe(0);
    expect(appelsExternes()).toBe(0);
  });

  it('(3) ouvrir le formulaire (ajout ou modification) : aucun appel', async () => {
    await charger();
    fireEvent.click(q('[data-prononciation-ajouter]'));
    expect(champAffiche()).not.toBeNull();
    fireEvent.click(q('[data-prononciation-annuler]'));
    fireEvent.click(q('[data-prononciation-modifier="Neuchâtel"]'));
    expect(champAffiche().value).toBe('Neuchâtel');
    await new Promise((r) => setTimeout(r, 20));
    expect(appelsRoute()).toBe(0);
    expect(appelsExternes()).toBe(0);
  });

  it('(2) saisie dans le texte d’origine et la forme dite (même incertaine) : aucun appel', async () => {
    await charger();
    fireEvent.click(q('[data-prononciation-ajouter]'));
    for (const v of ['A', 'Af', 'Afroboost', 'ADN', 'Neuchâtel']) fireEvent.change(champAffiche(), { target: { value: v } });
    for (const v of ['A', 'Afro', 'Afro-boust']) fireEvent.change(champPrononce(), { target: { value: v } });
    await new Promise((r) => setTimeout(r, 20));
    expect(appelsRoute()).toBe(0);
    expect(appelsExternes()).toBe(0);
  });

  it('(4) clic « Suggérer » avec suggestion locale sûre : champ rempli, AUCUN appel route', async () => {
    await charger();
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: '3-en-1 OS RENFORCÉS' } });
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('trois en un os renforcés'));
    await new Promise((r) => setTimeout(r, 20));
    expect(appelsRoute()).toBe(0);
  });

  it('(5) route appelée UNE fois, seulement sur clic explicite ET suggestion locale incertaine', async () => {
    await charger();
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: 'Afroboost' } });
    expect(appelsRoute()).toBe(0);
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')).not.toBeNull());
    expect(appelsRoute()).toBe(1);
  });

  it('(6) route injoignable (fetch jette) : suggestion locale en place, Écouter et Enregistrer utilisables', async () => {
    suggestionJette = true;
    await charger();
    fireEvent.click(q('[data-prononciation-ajouter]'));
    fireEvent.change(champAffiche(), { target: { value: 'ADN' } });
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')?.textContent).toMatch(/n’a pas trouvé mieux/));
    expect(appelsRoute()).toBe(1);
    expect(champPrononce().value).toBe('A D N');
    expect(q<HTMLButtonElement>('[data-prononciation-suggerer]').disabled).toBe(false);
    const ecouter = q<HTMLButtonElement>('[data-prononciation-brouillon-ecouter]');
    expect(ecouter.disabled).toBe(false);
    fireEvent.click(ecouter);
    await waitFor(() => expect(urls).toContain('/api/voice/prononciations/ecoute'));
    fireEvent.click(q('[data-prononciation-valider]'));
    await waitFor(() => expect(urls).toContain('/api/voice/profil/prononciations'));
  });
});
