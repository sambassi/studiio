import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * Mon avatar — « Enregistrer avec ma caméra » ne CHANGE PAS l'avatar : la
 * prise rejoint le parcours d'import existant (consentement → « Créer mon
 * avatar vidéo »). Aucun envoi, aucune écriture avant ce clic.
 */
vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const appels: Array<{ url: string; method: string }> = [];
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);

class FauxRecorder {
  static isTypeSupported = (m: string) => m.startsWith('video/webm');
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.ondataavailable?.({ data: new Blob(['images'], { type: 'video/webm' }) }); this.onstop?.(); }
}

beforeEach(() => {
  appels.length = 0;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FauxRecorder;
  const piste = { stop: vi.fn(), getSettings: () => ({ deviceId: 'd' }) };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [piste], getVideoTracks: () => [piste], getAudioTracks: () => [] })),
      enumerateDevices: vi.fn(async () => []),
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:prise';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, method: init?.method ?? 'GET' });
    if (u === '/api/avatar/create') return json(200, { success: true, data: { avatar: null, voices: [], defaultVoiceId: null, didVideoActif: false, jumeauVideoActif: true, nomProfil: 'Bassi' } });
    return json(200, { success: true, data: {} });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;

describe('Mon avatar — enregistrer sa source à la caméra', () => {
  it('⚠️ deux choix clairs ; la prise rejoint l’import (consentement à cocher) ; aucun envoi avant « Créer mon avatar vidéo »', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(q('[data-avatar-source-mode="camera"]')).not.toBeNull());
    expect(q('[data-avatar-source-mode="import"]')!.textContent).toContain('Importer une photo ou une vidéo');
    fireEvent.click(q('[data-avatar-source-mode="camera"]')!);
    expect(q('[data-enregistreur-source="inactif"]')).not.toBeNull();

    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    await act(async () => { vi.advanceTimersByTime(3100 + 20_000); });
    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    vi.useRealTimers();
    fireEvent.click(q('[data-enregistreur-utiliser]')!);

    // Retour au parcours d'import : le fichier enregistré est choisi, le consentement reste à donner.
    await waitFor(() => expect(document.body.textContent).toContain('ma-source-avatar.webm'));
    expect(q('[data-avatar-source-mode="import"]')!.getAttribute('aria-checked')).toBe('true');
    const consent = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => /certifie/.test(c.closest('label')?.textContent ?? ''))!;
    expect(consent.checked).toBe(false);
    expect(appels.filter((a) => a.method !== 'GET')).toEqual([]);
  });
});
