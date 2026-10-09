import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import EnregistreurSource from '../components/avatar/studio/EnregistreurSource';

/**
 * ENREGISTRER MA SOURCE — guide de tournage, ovale de cadrage, caméra
 * avant/arrière, pause. Aucune caméra réelle, aucun réseau.
 */

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;

class RecorderSansPause {
  static instances: RecorderSansPause[] = [];
  static isTypeSupported = (m: string) => m.startsWith('video/webm');
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: MediaStream) { RecorderSansPause.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x'], { type: 'video/webm' }) }); this.onstop?.(); }
}
class RecorderAvecPause extends RecorderSansPause {
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
}

const piste = (kind: string) => ({ kind, stop: vi.fn(), getSettings: () => ({ deviceId: `${kind}-1`, width: 1280, height: 720 }) });
const fauxFlux = { getTracks: () => [piste('video'), piste('audio')], getVideoTracks: () => [piste('video')], getAudioTracks: () => [] } as unknown as MediaStream;

function installer(Recorder: unknown, cameras = 2) {
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = Recorder;
  const getUserMedia = vi.fn(async () => fauxFlux);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        ...Array.from({ length: cameras }, (_, i) => ({ kind: 'videoinput', deviceId: `c${i}`, label: `Caméra ${i}` })),
        { kind: 'audioinput', deviceId: 'm1', label: 'Micro' },
      ]),
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:prise';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  return getUserMedia;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function ouvrir(Recorder: unknown, cameras = 2) {
  const gum = installer(Recorder, cameras);
  const utiliser = vi.fn();
  render(<EnregistreurSource mp4Requis={false} onUtiliser={utiliser} onImporterAlaPlace={vi.fn()} />);
  return { gum, utiliser };
}

describe('Guide de tournage et cadrage', () => {
  it('⚠️ AVANT d’activer la caméra : la liste de tournage, durée 15 s minimum / idéalement 2 minutes', async () => {
    await ouvrir(RecorderSansPause);
    const guide = q('[data-enregistreur-guide]')!;
    expect(guide.textContent).toMatch(/Visage bien éclairé/);
    expect(guide.textContent).toMatch(/Caméra stable/);
    expect(guide.textContent).toMatch(/Regardez l’objectif/);
    expect(guide.textContent).toMatch(/contre-jour/);
    expect(guide.textContent).toMatch(/Son clair/);
    expect(guide.textContent).toMatch(/Restez dans le cadre/);
    expect(guide.textContent).toMatch(/15 s minimum, idéalement 2 minutes/);
  });

  it('caméra active : ovale de cadrage sur l’aperçu, décoratif (aria-hidden)', async () => {
    await ouvrir(RecorderSansPause);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    const ovale = q('[data-enregistreur-ovale]')!;
    expect(ovale).not.toBeNull();
    expect(ovale.getAttribute('aria-hidden')).toBe('true');
    expect(ovale.textContent).toMatch(/visage dans l’ovale/);
  });

  it('⚠️ « Changer de caméra » : bascule avant → arrière (facingMode), image non inversée à l’arrière', async () => {
    const { gum } = await ouvrir(RecorderSansPause, 2);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-changer-camera]')).not.toBeNull());
    expect(q<HTMLVideoElement>('[data-enregistreur-video="direct"]')!.style.transform).toBe('scaleX(-1)');
    await act(async () => { fireEvent.click(q('[data-enregistreur-changer-camera]')!); });
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
    const appel = (gum.mock.calls as unknown as Array<[MediaStreamConstraints]>)[1][0];
    expect((appel.video as MediaTrackConstraints).facingMode).toBe('environment');
    await waitFor(() => expect(q<HTMLVideoElement>('[data-enregistreur-video="direct"]')!.style.transform).toBe('none'));
    await act(async () => { fireEvent.click(q('[data-enregistreur-changer-camera]')!); });
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(3));
    expect(((gum.mock.calls as unknown as Array<[MediaStreamConstraints]>)[2][0].video as MediaTrackConstraints).facingMode).toBe('user');
  });

  it('une seule caméra : pas de bouton « Changer de caméra »', async () => {
    await ouvrir(RecorderSansPause, 1);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    expect(q('[data-enregistreur-changer-camera]')).toBeNull();
  });
});

describe('Pause / Reprendre', () => {
  it('navigateur sans `pause` : bouton absent', async () => {
    await ouvrir(RecorderSansPause);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(q('[data-enregistreur-source="enregistrement"]')).not.toBeNull();
    expect(q('[data-enregistreur-pause]')).toBeNull();
  });

  it('⚠️ avec `pause` : Pause/Reprendre pilotent le recorder, et le temps en pause ne compte pas', async () => {
    RecorderSansPause.instances = [];
    const { utiliser } = await ouvrir(RecorderAvecPause);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    await act(async () => { vi.advanceTimersByTime(3100); });
    const rec = RecorderSansPause.instances.at(-1)!;
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(q('[data-enregistreur-pause="non"]')!.textContent).toMatch(/Pause/);
    fireEvent.click(q('[data-enregistreur-pause]')!);
    expect(rec.state).toBe('paused');
    expect(q('[data-enregistreur-pause="oui"]')!.textContent).toMatch(/Reprendre/);
    // 60 s de pause : ni comptées, ni enregistrées.
    await act(async () => { vi.advanceTimersByTime(60_000); });
    fireEvent.click(q('[data-enregistreur-pause]')!);
    expect(rec.state).toBe('recording');
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(q('[data-enregistreur-duree]')!.textContent).toBe('0:18');
    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    vi.useRealTimers();
    // 18 s effectives ≥ 15 s : la prise est acceptée, et rendue en FICHIER.
    expect(q('[data-enregistreur-refus]')).toBeNull();
    fireEvent.click(q('[data-enregistreur-utiliser]')!);
    expect(utiliser).toHaveBeenCalledTimes(1);
    expect(utiliser.mock.calls[0][0]).toBeInstanceOf(File);
  });
});
