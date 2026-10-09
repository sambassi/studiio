import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act, screen } from '@testing-library/react';

/**
 * ENREGISTRER MA SOURCE — caméra + micro, 3-2-1, durée, contrôle avant envoi,
 * recommencer, utiliser. Repris des tests « caméra » de la PR #530, sans le
 * prompteur (non repris). Aucune caméra réelle, aucun réseau.
 */

import EnregistreurSource from '../components/avatar/studio/EnregistreurSource';

const appels: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  appels.length = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    appels.push({ url: String(url), method: init?.method ?? 'GET' });
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;


// ─────────────────────────────────────────────────────────────────────────
// Caméra + prompteur
// ─────────────────────────────────────────────────────────────────────────
class FauxRecorder {
  static instances: FauxRecorder[] = [];
  static isTypeSupported = (m: string) => m.startsWith('video/webm');
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: MediaStream, readonly options: { mimeType: string }) { FauxRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['images'], { type: 'video/webm' }) }); this.onstop?.(); }
}
const piste = (kind: string) => ({ kind, stop: vi.fn(), getSettings: () => ({ deviceId: `${kind}-1` }) });
const fauxFlux = { getTracks: () => [piste('video'), piste('audio')], getVideoTracks: () => [piste('video')], getAudioTracks: () => [] } as unknown as MediaStream;

function installerCamera(comportement: 'ok' | 'refus' | 'absente') {
  FauxRecorder.instances = [];
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FauxRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (comportement === 'refus') throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
        if (comportement === 'absente') throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        return fauxFlux;
      }),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'c1', label: 'Caméra A' }, { kind: 'videoinput', deviceId: 'c2', label: 'Caméra B' }, { kind: 'audioinput', deviceId: 'm1', label: 'Micro A' }]),
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:prise';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
}

describe('Enregistrer ma source — caméra', () => {
  it('⚠️ permission refusée : message clair, sortie « Importer une vidéo », aucun envoi', async () => {
    installerCamera('refus');
    const importer = vi.fn();
    render(<EnregistreurSource mp4Requis={false} onUtiliser={vi.fn()} onImporterAlaPlace={importer} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/refusé/));
    fireEvent.click(screen.getByText('Importer une vidéo à la place'));
    expect(importer).toHaveBeenCalledTimes(1);
    expect(appels).toEqual([]);
  });

  it('caméra absente : message clair', async () => {
    installerCamera('absente');
    render(<EnregistreurSource mp4Requis={false} onUtiliser={vi.fn()} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/Aucune caméra/));
  });

  it('⚠️ MP4 exigé et navigateur WebM seulement : refus nommé AVANT d’ouvrir la caméra', async () => {
    installerCamera('ok');
    render(<EnregistreurSource mp4Requis onUtiliser={vi.fn()} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/MP4/));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('⚠️ permission acceptée → choix caméra et micro, 3-2-1, enregistrement, arrêt, recommencer, utiliser : un FICHIER rendu, aucune requête réseau', async () => {
    installerCamera('ok');
    const utiliser = vi.fn();
    render(<EnregistreurSource mp4Requis={false} onUtiliser={utiliser} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    expect(q<HTMLSelectElement>('[data-enregistreur-camera]')?.options).toHaveLength(2);
    expect(q('[data-prompteur-ouvrir]')).toBeNull();

    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    expect(q('[data-enregistreur-decompte="3"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(q('[data-enregistreur-source="enregistrement"]')).not.toBeNull();
    // Le recorder capte le flux CAMÉRA + MICRO.
    expect(FauxRecorder.instances).toHaveLength(1);
    expect(FauxRecorder.instances[0].stream).toBe(fauxFlux);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(q('[data-enregistreur-duree]')?.textContent).toBe('0:02');
    // ⚠️ Prise trop courte (< 15 s, exigence du fournisseur) : refusée AVANT tout envoi.
    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    vi.useRealTimers();
    expect(q('[data-enregistreur-source="apercu"]')).not.toBeNull();
    expect(q('[data-enregistreur-refus]')?.textContent).toMatch(/au moins 15 secondes/);
    expect(q<HTMLButtonElement>('[data-enregistreur-utiliser]')!.disabled).toBe(true);
    fireEvent.click(q('[data-enregistreur-utiliser]')!);
    expect(q('[data-enregistreur-video="prise"]')).not.toBeNull();
    fireEvent.click(q('[data-enregistreur-recommencer]')!);
    expect(q('[data-enregistreur-source="pret"]')).not.toBeNull();
    expect(utiliser).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    await act(async () => { vi.advanceTimersByTime(3100 + 20_000); });
    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    vi.useRealTimers();
    expect(q('[data-enregistreur-refus]')).toBeNull();
    // Débit plafonné : la prise tient sous la limite d'envoi.
    expect(FauxRecorder.instances.at(-1)!.options).toMatchObject({ videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 128_000 });
    fireEvent.click(q('[data-enregistreur-utiliser]')!);
    expect(utiliser).toHaveBeenCalledTimes(1);
    const fichier = utiliser.mock.calls[0][0] as File;
    expect(fichier.type).toBe('video/webm');
    expect(fichier.name).toBe('ma-source-avatar.webm');
    // ⚠️ Rien envoyé, rien écrit : le fichier repart vers le parcours d'import
    // (préparation, consentement).
    expect(appels).toEqual([]);
    expect(appels.some((x) => x.url.startsWith('/api/avatar'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Prononciations
