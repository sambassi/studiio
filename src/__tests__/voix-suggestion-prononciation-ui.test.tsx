import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * Formulaire d'une prononciation : « Suggérer » remplit le champ prononcé
 * (modifiable), « Écouter » fait dire la paire EN COURS avant tout
 * enregistrement, et seul « Enregistrer » enregistre. Le texte d'origine
 * n'est jamais modifié. Tout le réseau est simulé.
 */

const V1 = '44444444-4444-4444-8444-000000000001';
const appels: Array<{ url: string; method: string; body?: unknown }> = [];
const lectures: Array<{ src: string; play: ReturnType<typeof vi.fn> }> = [];
let reponseSuggestion: { status: number; data?: { suggestion: string; source: 'locale' | 'ia' } } = { status: 200 };

class FausseAudio {
  src: string;
  onended: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(src: string) { this.src = src; lectures.push(this); }
}

function stub() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    appels.push({ url: u, method: init?.method ?? 'GET', body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    if (u === '/api/voice/profil') {
      return json(200, { success: true, data: {
        voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
        choix: null, voixResolue: { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
        motifVoix: null, messageVoix: null, ecouteDisponible: true,
        prononciations: [{ affiche: 'Neuchâtel', prononce: 'Neu-châ-tel' }],
      } });
    }
    if (u === '/api/voice/prononciations/suggestion') {
      if (reponseSuggestion.status !== 200) return json(reponseSuggestion.status, { success: false, error: 'refus' });
      return json(200, { success: true, data: reponseSuggestion.data ?? { suggestion: body.affiche, source: 'locale' } });
    }
    if (u === '/api/voice/prononciations/ecoute') {
      return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
    }
    if (u === '/api/voice/profil/prononciations') {
      return json(200, { success: true, data: { prononciations: body.prononciations } });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
}

let compteur = 0;
beforeEach(() => {
  appels.length = 0; lectures.length = 0; compteur = 0;
  reponseSuggestion = { status: 200 };
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => `blob:brouillon-${++compteur}`;
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  (globalThis as unknown as { Audio: unknown }).Audio = FausseAudio;
  stub();
});
afterEach(() => { cleanup(); });

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as unknown as T;
const champAffiche = () => q<HTMLInputElement>('[data-prononciation-affiche]');
const champPrononce = () => q<HTMLInputElement>('[data-prononciation-prononce]');
const enregistrements = () => appels.filter((a) => a.url === '/api/voice/profil/prononciations');

async function ouvrirFormulaire(affiche: string) {
  render(<MaVoixPanel />);
  await waitFor(() => expect(q('[data-prononciation-ajouter]')).not.toBeNull());
  fireEvent.click(q('[data-prononciation-ajouter]'));
  fireEvent.change(champAffiche(), { target: { value: affiche } });
}

describe('MaVoixPanel — Suggérer / Écouter / Enregistrer', () => {
  it('⚠️ « Suggérer » remplit le champ prononcé localement, sans réseau ni enregistrement, et le texte d’origine reste intact', async () => {
    await ouvrirFormulaire('3-en-1 OS RENFORCÉS');
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('trois en un os renforcés'));
    expect(champAffiche().value).toBe('3-en-1 OS RENFORCÉS');
    expect(appels.some((a) => a.url === '/api/voice/prononciations/suggestion')).toBe(false);
    expect(enregistrements()).toHaveLength(0);
    expect(q('[data-prononciation-note]').textContent).toMatch(/modifiez-la si besoin/);
    // Sans emoji : icône SVG.
    expect(q('[data-prononciation-suggerer]').querySelector('svg')).not.toBeNull();
  });

  it('⚠️ la suggestion est modifiable, et « Écouter » envoie la forme MODIFIÉE avant tout enregistrement', async () => {
    await ouvrirFormulaire('3-en-1 OS RENFORCÉS');
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('trois en un os renforcés'));
    fireEvent.change(champPrononce(), { target: { value: 'trois en un, os renforcés' } });
    fireEvent.click(q('[data-prononciation-brouillon-ecouter]'));
    await waitFor(() => expect(lectures).toHaveLength(1));
    const ecoute = appels.filter((a) => a.url === '/api/voice/prononciations/ecoute');
    expect(ecoute).toHaveLength(1);
    expect(ecoute[0].body).toEqual({ affiche: '3-en-1 OS RENFORCÉS', prononce: 'trois en un, os renforcés' });
    expect(lectures[0].play).toHaveBeenCalled();
    expect(enregistrements()).toHaveLength(0);
    // Aucun lecteur visible, aucun téléchargement.
    expect(document.querySelector('[download]')).toBeNull();
  });

  it('⚠️ « Enregistrer » enregistre seulement au clic, avec le texte d’origine inchangé et la forme choisie', async () => {
    await ouvrirFormulaire('3-en-1 OS RENFORCÉS');
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('trois en un os renforcés'));
    expect(enregistrements()).toHaveLength(0);
    fireEvent.click(q('[data-prononciation-valider]'));
    await waitFor(() => expect(enregistrements()).toHaveLength(1));
    expect(enregistrements()[0].method).toBe('PUT');
    expect(enregistrements()[0].body).toEqual({ prononciations: [
      { affiche: 'Neuchâtel', prononce: 'Neu-châ-tel' },
      { affiche: '3-en-1 OS RENFORCÉS', prononce: 'trois en un os renforcés' },
    ] });
  });

  it('cas difficile : la route serveur est appelée, sa proposition remplace la suggestion locale', async () => {
    reponseSuggestion = { status: 200, data: { suggestion: 'Afro-boust', source: 'ia' } };
    await ouvrirFormulaire('Afroboost');
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(champPrononce().value).toBe('Afro-boust'));
    const s = appels.filter((a) => a.url === '/api/voice/prononciations/suggestion');
    expect(s).toHaveLength(1);
    expect(s[0].body).toEqual({ affiche: 'Afroboost' });
    expect(champAffiche().value).toBe('Afroboost');
    expect(enregistrements()).toHaveLength(0);
  });

  it('cas difficile sans aide disponible (repli local ou 429) : le champ reste modifiable et la note le dit', async () => {
    reponseSuggestion = { status: 429 };
    await ouvrirFormulaire('Afroboost');
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')?.textContent).toMatch(/Aucune suggestion fiable — vous pouvez saisir la prononciation vous-même/));
    // Jamais le même texte présenté comme une correction : le champ n'est pas touché.
    expect(champPrononce().value).toBe('');
    fireEvent.change(champPrononce(), { target: { value: 'Afro-boost' } });
    expect(champPrononce().value).toBe('Afro-boost');
    expect(enregistrements()).toHaveLength(0);
  });

  it('les boutons du formulaire ne se confondent pas avec les haut-parleurs des lignes enregistrées', async () => {
    await ouvrirFormulaire('HIIT');
    expect(document.querySelectorAll('[data-prononciation-ecouter]')).toHaveLength(1);
    expect(q('[data-prononciation-brouillon-ecouter]').textContent).toContain('Écouter');
    // Sans forme dite, « Écouter » est désactivé.
    expect(q<HTMLButtonElement>('[data-prononciation-brouillon-ecouter]').disabled).toBe(true);
  });
});

describe('MaVoixPanel — Suggérer : expression ordinaire', () => {
  it('« lien en bio » : aucun appel serveur, message « Aucune suggestion fiable », champ intact et modifiable', async () => {
    await ouvrirFormulaire('lien en bio');
    const avant = champPrononce().value;
    fireEvent.click(q('[data-prononciation-suggerer]'));
    await waitFor(() => expect(q('[data-prononciation-note]')?.textContent).toBe('Aucune suggestion fiable — vous pouvez saisir la prononciation vous-même.'));
    expect(appels.some((a) => a.url === '/api/voice/prononciations/suggestion')).toBe(false);
    expect(champPrononce().value).toBe(avant);
    expect(champAffiche().value).toBe('lien en bio');
    fireEvent.change(champPrononce(), { target: { value: 'lien an bio' } });
    expect(champPrononce().value).toBe('lien an bio');
  });
});
