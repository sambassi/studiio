/**
 * CONTRAT C-PLAYER — « Audio complet » (Mon avatar › Ma voix) n'affiche
 * JAMAIS le lecteur natif blanc `<audio controls>` : pré-écoute et Audio
 * complet partagent `LecteurVoixCompact`. Un audio déjà généré se relit
 * sans nouvel appel. Validé par #564.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MaVoixPanel from '@/components/voice/MaVoixPanel';
import LecteurVoixCompact from '@/components/voice/LecteurVoixCompact';

const V1 = '44444444-4444-4444-8444-000000000001';
const URL_AUDIO = 'https://studiio.pro/storage/v1/object/public/audio/u/voice/audio-complet.mp3';
const appels: string[] = [];

beforeEach(() => {
  appels.length = 0;
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:preecoute';
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    appels.push(u);
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    const voix = { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true };
    if (u === '/api/voice/profil') {
      return json(200, { success: true, data: { voix: [voix], choix: null, voixResolue: voix, motifVoix: null, messageVoix: null, ecouteDisponible: true, prononciations: [], prononciationsIdentiques: [] } });
    }
    if (u === '/api/credits/balance') return json(200, { ok: true, politique: 'credits', balance: 42 });
    if (u === '/api/voice/audio-complet') return json(200, { success: true, url: URL_AUDIO, creditsDebites: 0, cout: 1, caracteres: 20, dejaGenere: true });
    return json(404, {});
  }) as unknown as typeof fetch;
});
afterEach(() => cleanup());

const q = (s: string) => document.querySelector(s) as HTMLElement;

describe('C-PLAYER — un seul lecteur Studiio', () => {
  it('Audio complet : lecteur Studiio, aucun <audio controls>, lecture sans appel réseau', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(q('[data-audio-complet-texte]')).not.toBeNull());
    fireEvent.change(q('[data-audio-complet-texte]'), { target: { value: 'Texte déjà généré' } });
    fireEvent.click(q('[data-audio-complet-generer]'));
    await waitFor(() => expect(q('[data-audio-complet-resultat]')).not.toBeNull());
    const zone = q('[data-audio-complet-lecteur]');
    expect(zone.querySelector('[data-lecteur-voix]')).not.toBeNull();
    expect(zone.querySelector('audio')!.getAttribute('src')).toBe(URL_AUDIO);
    expect(document.querySelectorAll('audio[controls]').length).toBe(0);
    const avant = appels.length;
    fireEvent.click(zone.querySelector('[data-lecteur-voix-bouton]')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(appels.length).toBe(avant);
    expect(appels.filter((a) => a === '/api/voice/audio-complet')).toHaveLength(1);
  });

  it('LecteurVoixCompact seul : jamais l’attribut controls', () => {
    const { container } = render(<LecteurVoixCompact src={URL_AUDIO} />);
    const audio = container.querySelector('audio')!;
    expect(audio).not.toBeNull();
    expect(audio.hasAttribute('controls')).toBe(false);
  });

  it('pré-écoute et Audio complet importent LE MÊME composant ; aucun <audio controls> dans le CODE voix', () => {
    const dossier = join(process.cwd(), 'src/components/voice');
    const lire = (f: string) => readFileSync(join(dossier, f), 'utf8');
    const importLecteur = "import LecteurVoixCompact from '@/components/voice/LecteurVoixCompact';";
    expect(lire('MaVoixPanel.tsx')).toContain(importLecteur);
    expect(lire('AudioCompletSection.tsx')).toContain(importLecteur);
    const code = (f: string) => lire(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['MaVoixPanel.tsx', 'AudioCompletSection.tsx', 'LecteurVoixCompact.tsx']) {
      expect(code(f), f).not.toMatch(/<audio[^>]*\scontrols\b/);
    }
  });
});
