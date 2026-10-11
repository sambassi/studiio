import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * L'icône haut-parleur de chaque prononciation : l'écran n'envoie que
 * `{ affiche }`, joue l'audio sans lecteur visible ni téléchargement, une
 * lecture à la fois, et dit honnêtement les refus (409, 429).
 */

const V1 = '44444444-4444-4444-8444-000000000001';
const appels: Array<{ url: string; body?: unknown }> = [];
const lectures: Array<{ src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }> = [];
const revoquees: string[] = [];
let reponsePrononciation: { status: number; error?: string } = { status: 200 };

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
    appels.push({ url: u, body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    if (u === '/api/voice/profil') {
      return json(200, { success: true, data: {
        voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
        choix: null, voixResolue: { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
        motifVoix: null, messageVoix: null, ecouteDisponible: true,
        prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-Boost' }, { affiche: 'Neuchâtel', prononce: 'Neu-châ-tel' }],
      } });
    }
    if (u === '/api/voice/prononciations/ecoute') {
      if (reponsePrononciation.status !== 200) return json(reponsePrononciation.status, { success: false, error: reponsePrononciation.error ?? 'refus' });
      return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
    }
    return json(404, {});
  }) as unknown as typeof fetch;
}

let compteur = 0;
beforeEach(() => {
  appels.length = 0; lectures.length = 0; revoquees.length = 0; compteur = 0;
  reponsePrononciation = { status: 200 };
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => `blob:ligne-${++compteur}`;
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = (u: string) => { revoquees.push(u); };
  (globalThis as unknown as { Audio: unknown }).Audio = FausseAudio;
  stub();
});
afterEach(() => { cleanup(); });

const bouton = (affiche: string) => document.querySelector(`[data-prononciation-ecouter="${affiche}"]`) as HTMLButtonElement;

describe('MaVoixPanel — écouter une prononciation', () => {
  it('⚠️ un bouton haut-parleur par ligne, nommé « Écouter « … » », sans emoji', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(document.querySelectorAll('[data-prononciation-ecouter]')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Écouter « Afroboost »' })).toBe(bouton('Afroboost'));
    expect(screen.getByRole('button', { name: 'Écouter « Neuchâtel »' })).toBe(bouton('Neuchâtel'));
    expect(bouton('Afroboost').querySelector('svg')).not.toBeNull();
    expect(bouton('Afroboost').textContent).toBe('');
  });

  it('⚠️ un clic envoie { affiche } SEULEMENT à la nouvelle route et joue l’audio sans lecteur visible', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(bouton('Afroboost')).not.toBeNull());
    fireEvent.click(bouton('Afroboost'));
    await waitFor(() => expect(lectures).toHaveLength(1));
    const appel = appels.filter((a) => a.url === '/api/voice/prononciations/ecoute');
    expect(appel).toHaveLength(1);
    expect(appel[0].body).toEqual({ affiche: 'Afroboost' });
    expect(appels.some((a) => a.url === '/api/voice/ecoute')).toBe(false);
    expect(lectures[0].play).toHaveBeenCalled();
    // Aucun lecteur ajouté au DOM, aucun téléchargement possible.
    expect(document.querySelector('[data-ecoute-audio]')).toBeNull();
    expect(document.querySelector('[download]')).toBeNull();
    expect(document.querySelector('a[href^="blob:"]')).toBeNull();
  });

  it('une seule lecture à la fois : la précédente est arrêtée et son URL libérée', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(bouton('Afroboost')).not.toBeNull());
    fireEvent.click(bouton('Afroboost'));
    await waitFor(() => expect(lectures).toHaveLength(1));
    await waitFor(() => expect(bouton('Neuchâtel').disabled).toBe(false));
    fireEvent.click(bouton('Neuchâtel'));
    await waitFor(() => expect(lectures).toHaveLength(2));
    expect(lectures[0].pause).toHaveBeenCalled();
    expect(revoquees).toContain(lectures[0].src);
  });

  it('429 → « Trop d’écoutes, réessayez dans un instant. » sur la ligne ; 409 → message du serveur', async () => {
    reponsePrononciation = { status: 429 };
    render(<MaVoixPanel />);
    await waitFor(() => expect(bouton('Afroboost')).not.toBeNull());
    fireEvent.click(bouton('Afroboost'));
    await waitFor(() => expect(document.querySelector('[data-prononciation-erreur="Afroboost"]')!.textContent).toBe('Trop d’écoutes, réessayez dans un instant.'));
    expect(lectures).toHaveLength(0);
    reponsePrononciation = { status: 409, error: 'Aucune voix personnelle n’est enregistrée sur votre compte.' };
    fireEvent.click(bouton('Neuchâtel'));
    await waitFor(() => expect(document.querySelector('[data-prononciation-erreur="Neuchâtel"]')!.textContent).toBe('Aucune voix personnelle n’est enregistrée sur votre compte.'));
    expect(document.querySelector('[data-prononciation-erreur="Afroboost"]')).toBeNull();
  });

  it('« Écouter ma voix » : pré-écoute ≈ 5 s annoncée, zone de texte bornée, lecteur sans contrôles natifs ni téléchargement', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(document.querySelector('[data-apercu-texte]')).not.toBeNull());
    expect(document.querySelector('[data-preecoute-indice]')!.textContent).toMatch(/Pré-écoute gratuite : environ 5 secondes/);
    const zone = document.querySelector('[data-apercu-texte]') as HTMLTextAreaElement;
    expect(zone.maxLength).toBe(70);
    fireEvent.change(zone, { target: { value: 'x'.repeat(200) } });
    expect(zone.value.length).toBe(70);
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../components/voice/MaVoixPanel.tsx'), 'utf8');
    // Plus de lecteur natif : le lecteur Studiio (`LecteurVoixCompact`) n'a ni menu ⋮ ni téléchargement.
    expect(src).toMatch(/<LecteurVoixCompact/);
    expect(src).not.toMatch(/\scontrols[=\s>]/);
    expect(src).not.toMatch(/\sdownload[=\s>]/);
  });
});
