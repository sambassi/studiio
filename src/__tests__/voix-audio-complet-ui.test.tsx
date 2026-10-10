import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * Section « Audio complet » de « Ma voix » : le prix est annoncé sur le
 * bouton (même fonction pure que le serveur), l'écran n'envoie que
 * `{ texte }`, le bouton est désactivé pendant la génération, et le lecteur
 * complet + le lien de téléchargement n'apparaissent qu'après un succès. La
 * pré-écoute, elle, ne se télécharge jamais.
 */

const V1 = '44444444-4444-4444-8444-000000000001';
const URL_AUDIO = 'https://studiio.pro/storage/v1/object/public/audio/u/voice/audio-complet-abc.mp3';
const appels: Array<{ url: string; body?: unknown }> = [];
let politique: 'credits' | 'partner_cost_only' = 'credits';
let reponseComplet: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
let liberer: (() => void) | null = null;

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
        motifVoix: null, messageVoix: null, ecouteDisponible: true, prononciations: [],
      } });
    }
    if (u === '/api/credits/balance') {
      return json(200, politique === 'credits' ? { ok: true, politique, balance: 42 } : { ok: true, politique, balance: null, libelle: 'x' });
    }
    if (u === '/api/voice/ecoute') {
      return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
    }
    if (u === '/api/voice/audio-complet') {
      await new Promise<void>((r) => { liberer = r; });
      return json(reponseComplet.status, reponseComplet.body);
    }
    return json(404, {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  appels.length = 0; politique = 'credits'; liberer = null;
  reponseComplet = { status: 200, body: { success: true, url: URL_AUDIO, creditsDebites: 3, cout: 3, caracteres: 2500, dejaGenere: false } };
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:preecoute';
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  stub();
});
afterEach(() => { cleanup(); });

const zone = () => document.querySelector('[data-audio-complet-texte]') as HTMLTextAreaElement;
const bouton = () => document.querySelector('[data-audio-complet-generer]') as HTMLButtonElement;
const saisir = (n: number) => fireEvent.change(zone(), { target: { value: 'a'.repeat(n) } });

describe('MaVoixPanel — audio complet', () => {
  it.each([[500, '1 crédit'], [1000, '1 crédit'], [1001, '2 crédits'], [2500, '3 crédits']])('⚠️ %i caractères → « Générer l’audio complet — %s »', async (n, libelle) => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(zone()).not.toBeNull());
    expect(zone().maxLength).toBe(5000);
    saisir(n);
    expect(bouton().textContent).toBe(`Générer l’audio complet — ${libelle}`);
    expect(document.querySelector('[data-audio-complet-compteur]')!.textContent).toBe(`${n}/5000 caractères`);
  });

  it('⚠️ administrateur : « 0 crédit (administrateur) »', async () => {
    politique = 'partner_cost_only';
    render(<MaVoixPanel />);
    await waitFor(() => expect(zone()).not.toBeNull());
    saisir(2500);
    await waitFor(() => expect(bouton().textContent).toBe('Générer l’audio complet — 0 crédit (administrateur)'));
  });

  it('⚠️ n’envoie que { texte }, désactivé pendant la génération ; lecteur + téléchargement SEULEMENT après succès', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(zone()).not.toBeNull());
    saisir(2500);
    expect(document.querySelector('[data-audio-complet-telecharger]')).toBeNull();
    expect(document.querySelector('[data-audio-complet-lecteur]')).toBeNull();
    fireEvent.click(bouton());
    await waitFor(() => expect(bouton().disabled).toBe(true));
    fireEvent.click(bouton());
    const envois = appels.filter((a) => a.url === '/api/voice/audio-complet');
    expect(envois).toHaveLength(1);
    expect(envois[0].body).toEqual({ texte: 'a'.repeat(2500) });
    expect(document.querySelector('[data-audio-complet-telecharger]')).toBeNull();
    liberer!();
    await waitFor(() => expect(document.querySelector('[data-audio-complet-telecharger]')).not.toBeNull());
    const lien = document.querySelector('[data-audio-complet-telecharger]') as HTMLAnchorElement;
    expect(lien.getAttribute('href')).toBe(URL_AUDIO);
    expect(lien.hasAttribute('download')).toBe(true);
    expect(lien.querySelector('svg')).not.toBeNull();
    expect(lien.textContent).toContain('Télécharger l’audio');
    const lecteur = document.querySelector('[data-audio-complet-lecteur]') as HTMLAudioElement;
    expect(lecteur.getAttribute('src')).toBe(URL_AUDIO);
    expect(lecteur.hasAttribute('controls')).toBe(true);
    expect(lecteur.getAttribute('controlslist')).toBeNull();
    expect(bouton().disabled).toBe(false);
  });

  it('402 : message avec le coût, aucun lien de téléchargement', async () => {
    reponseComplet = { status: 402, body: { success: false, code: 'credits_insuffisants', cout: 3, error: 'Crédits insuffisants : cet audio coûte 3 crédits.' } };
    render(<MaVoixPanel />);
    await waitFor(() => expect(zone()).not.toBeNull());
    saisir(2500);
    fireEvent.click(bouton());
    await waitFor(() => expect(liberer).not.toBeNull());
    liberer!();
    await waitFor(() => expect(document.querySelector('[data-audio-complet-erreur]')).not.toBeNull());
    expect(document.querySelector('[data-audio-complet-erreur]')!.textContent).toContain('3 crédits');
    expect(document.querySelector('[data-audio-complet-telecharger]')).toBeNull();
    expect(document.querySelector('[data-audio-complet-lecteur]')).toBeNull();
  });

  it('⚠️ la pré-écoute garde nodownload et aucun lien de téléchargement', async () => {
    render(<MaVoixPanel />);
    await waitFor(() => expect(document.querySelector('[data-ecouter]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-ecouter]') as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector('[data-ecoute-audio]')).not.toBeNull());
    expect(document.querySelector('[data-ecoute-audio]')!.getAttribute('controlslist')).toBe('nodownload');
    expect(document.querySelector('[download]')).toBeNull();
    expect(appels.some((a) => a.url === '/api/voice/audio-complet')).toBe(false);
  });
});
