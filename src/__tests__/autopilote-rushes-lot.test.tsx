import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { UploadResult } from '@/lib/storage/uploadFile';

/**
 * L'Autopilote reçoit plusieurs rushes d'un coup — en UN enregistrement.
 *
 * ⚠️ CE TEST MONTE L'ÉCRAN ET LA MÉDIATHÈQUE RÉELLE. Seul le helper d'envoi
 * est remplacé, et il rejoue la forme que la prod renvoie : une URL
 * RELATIVE. Ce qu'on vérifie, c'est ce que le serveur REÇOIT en `PUT`.
 */

const uploadFileMock = vi.fn<(file: File) => Promise<UploadResult>>();
vi.mock('@/lib/storage/uploadFile', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/storage/uploadFile')>();
  return { ...reel, uploadFile: (file: File) => uploadFileMock(file) };
});

const ORIGINE = window.location.origin;
const abs = (nom: string) => `${ORIGINE}/storage/v1/object/public/media/u/${nom}`;
const rel = (nom: string) => `/storage/v1/object/public/media/u/${nom}`;

let envois: AutopilotConfig[] = [];
let configServeur: AutopilotConfig = DEFAULT_CONFIG;

beforeEach(() => {
  envois = [];
  configServeur = { ...DEFAULT_CONFIG, rushUrls: [abs('a.mp4')] };
  uploadFileMock.mockReset();
  uploadFileMock.mockImplementation(async (file) => ({
    publicUrl: rel(file.name), path: `u/${file.name}`, bucket: 'media', mode: 'direct',
  }));

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: [] }) };
    }
    if (u.startsWith('/api/media/list')) {
      return { ok: true, json: async () => ({ success: true, files: [
        { name: 'a.mp4', url: abs('a.mp4'), path: 'u/a.mp4', bucket: 'media', type: 'video', size: 10, createdAt: new Date().toISOString() },
        { name: 'z.mp4', url: abs('z.mp4'), path: 'u/z.mp4', bucket: 'media', type: 'video', size: 10, createdAt: new Date().toISOString() },
      ] }) };
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

function fichier(nom: string): File {
  return new File([new Uint8Array(10)], nom, { type: 'video/mp4' });
}

async function ouvrirRushes() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-add-rush]')).toBeTruthy());
  // La banque de départ est relue du serveur avant qu'on ajoute.
  await waitFor(() => expect(screen.getByText('a.mp4')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-add-rush]') as Element);
  await waitFor(() => expect(document.querySelector('[data-mediatheque-input]')).toBeTruthy());
}

describe('Ajouter plusieurs rushes à l Autopilote', () => {
  it('trois fichiers → UN `PUT`, URL absolues, sans doublon avec la banque', async () => {
    await ouvrirRushes();
    const input = document.querySelector('[data-mediatheque-input]') as HTMLInputElement;
    // `a.mp4` est déjà dans la banque (en absolu) ; il revient ici en RELATIF.
    fireEvent.change(input, { target: { files: [fichier('a.mp4'), fichier('b.mp4'), fichier('c.mp4')] } });

    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0].rushUrls).toEqual([abs('a.mp4'), abs('b.mp4'), abs('c.mp4')]);
    // Toutes absolues : `sanitizeConfig` n'en a écarté aucune.
    expect(envois[0].rushUrls.every((u) => /^https?:\/\//.test(u))).toBe(true);
    // La Médiathèque s'est refermée, la banque affiche les trois.
    await waitFor(() => expect(document.querySelector('[data-mediatheque-input]')).toBeNull());
    expect(screen.getByText('b.mp4')).toBeTruthy();
    expect(screen.getByText('c.mp4')).toBeTruthy();
    // Un seul enregistrement : pas un par fichier.
    await new Promise((r) => setTimeout(r, 20));
    expect(envois.length).toBe(1);
  });

  it('le clic sur la grille ajoute un rush à la fois, dédoublonné lui aussi', async () => {
    await ouvrirRushes();
    await waitFor(() => expect(document.querySelector('img, video[src]')).toBeTruthy());
    // `a.mp4` est déjà là : le re-choisir n'enregistre rien.
    const tuiles = Array.from(document.querySelectorAll('video[src]')) as HTMLVideoElement[];
    const tuileA = tuiles.find((v) => v.getAttribute('src') === abs('a.mp4'))!.parentElement as HTMLElement;
    fireEvent.click(tuileA);
    await new Promise((r) => setTimeout(r, 20));
    expect(envois.length).toBe(0);

    fireEvent.click(document.querySelector('[data-autopilot-add-rush]') as Element);
    await waitFor(() => expect(document.querySelectorAll('video[src]').length).toBeGreaterThan(0));
    const tuileZ = (Array.from(document.querySelectorAll('video[src]')) as HTMLVideoElement[])
      .find((v) => v.getAttribute('src') === abs('z.mp4'))!.parentElement as HTMLElement;
    fireEvent.click(tuileZ);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0].rushUrls).toEqual([abs('a.mp4'), abs('z.mp4')]);
  });
});
