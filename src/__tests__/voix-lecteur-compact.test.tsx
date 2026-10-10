import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, act } from '@testing-library/react';
import LecteurVoixCompact, { BARRES_LECTEUR_VOIX } from '../components/voice/LecteurVoixCompact';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * « Écouter ma voix » — lecteur Studiio compact à la place de `<audio controls>`.
 *
 * jsdom ne lit aucun son : `play`/`pause` sont simulés sur le prototype de
 * HTMLMediaElement, `duration`/`currentTime` posés à la main, et les
 * événements (`loadedmetadata`, `timeupdate`, `ended`) déclenchés par le test.
 */

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
const origPlay = proto.play;
const origPause = proto.pause;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  proto.play = play;
  proto.pause = pause;
});
afterEach(() => { cleanup(); proto.play = origPlay; proto.pause = origPause; });

const audio = () => document.querySelector('[data-ecoute-audio]') as HTMLAudioElement;
const bouton = () => document.querySelector('[data-lecteur-voix-bouton]') as HTMLButtonElement;
const temps = () => document.querySelector('[data-lecteur-voix-temps]')!.textContent;
const onde = () => document.querySelector('[data-lecteur-voix-onde]') as HTMLElement;
const lues = () => document.querySelectorAll('[data-barre="lue"]').length;

/** Pose une durée lue par `loadedmetadata`, comme le ferait le navigateur. */
function metadonnees(el: HTMLAudioElement, duree: number) {
  Object.defineProperty(el, 'duration', { configurable: true, get: () => duree });
  fireEvent(el, new Event('loadedmetadata'));
}
function position(el: HTMLAudioElement, t: number) {
  Object.defineProperty(el, 'currentTime', { configurable: true, writable: true, value: t });
  fireEvent(el, new Event('timeupdate'));
}

describe('LecteurVoixCompact', () => {
  it('aucun contrôle natif, aucun téléchargement : `<audio>` caché sans `controls`', () => {
    render(<LecteurVoixCompact src="blob:a" />);
    expect(audio()).not.toBeNull();
    expect(audio().hasAttribute('controls')).toBe(false);
    expect(document.querySelector('[controls]')).toBeNull();
    expect(document.querySelector('[download]')).toBeNull();
    expect(document.querySelectorAll('[data-barre]')).toHaveLength(BARRES_LECTEUR_VOIX);
  });

  it('avant lecture : « Lire », 0:00 / 0:00 ; la durée vient de loadedmetadata → 0:00 / 0:05', () => {
    render(<LecteurVoixCompact src="blob:a" />);
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
    expect(temps()).toBe('0:00 / 0:00');
    act(() => metadonnees(audio(), 5.2));
    expect(temps()).toBe('0:00 / 0:05');
    expect(onde().getAttribute('aria-valuemax')).toBe('5');
    expect(onde().getAttribute('role')).toBe('slider');
  });

  it('Lire → play() appelé, le bouton devient « Pause » ; Pause → pause()', async () => {
    const onLecture = vi.fn();
    render(<LecteurVoixCompact src="blob:a" onLecture={onLecture} />);
    fireEvent.click(bouton());
    expect(play).toHaveBeenCalledTimes(1);
    expect(onLecture).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Pause'));
    expect(screen.getByRole('button', { name: 'Pause' })).toBe(bouton());
    fireEvent.click(bouton());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
  });

  it('timeupdate : progression (barres lues, aria-valuenow) et chrono « 0:02 / 0:05 »', () => {
    render(<LecteurVoixCompact src="blob:a" />);
    act(() => metadonnees(audio(), 5));
    expect(lues()).toBe(0);
    act(() => position(audio(), 2.5));
    expect(temps()).toBe('0:02 / 0:05');
    expect(onde().getAttribute('aria-valuenow')).toBe('3');
    expect(lues()).toBe(BARRES_LECTEUR_VOIX / 2);
  });

  it('ended : retour à « Lire » et 0:00', async () => {
    render(<LecteurVoixCompact src="blob:a" />);
    act(() => metadonnees(audio(), 5));
    fireEvent.click(bouton());
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Pause'));
    act(() => position(audio(), 5));
    act(() => { fireEvent(audio(), new Event('ended')); });
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
    expect(temps()).toBe('0:00 / 0:05');
    expect(lues()).toBe(0);
  });

  it('clavier : Entrée puis Espace basculent lecture / pause (une fois par appui)', async () => {
    render(<LecteurVoixCompact src="blob:a" />);
    fireEvent.keyDown(bouton(), { key: 'Enter' });
    expect(play).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Pause'));
    fireEvent.keyDown(bouton(), { key: ' ' });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
  });

  it('clavier sur l’onde : flèche droite avance d’une seconde', () => {
    render(<LecteurVoixCompact src="blob:a" />);
    act(() => metadonnees(audio(), 5));
    act(() => position(audio(), 1));
    fireEvent.keyDown(onde(), { key: 'ArrowRight' });
    expect(audio().currentTime).toBe(2);
    expect(temps()).toBe('0:02 / 0:05');
  });

  it('nouvelle source : état remis à zéro', async () => {
    const { rerender } = render(<LecteurVoixCompact src="blob:a" />);
    act(() => metadonnees(audio(), 5));
    fireEvent.click(bouton());
    act(() => position(audio(), 3));
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Pause'));
    rerender(<LecteurVoixCompact src="blob:b" />);
    expect(audio().getAttribute('src')).toBe('blob:b');
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
    expect(temps()).toBe('0:00 / 0:00');
  });

  it('une lecture qui échoue revient à « Lire »', async () => {
    proto.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    render(<LecteurVoixCompact src="blob:a" />);
    fireEvent.click(bouton());
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Lire'));
  });
});

describe('MaVoixPanel — « Écouter ma voix » dans le lecteur Studiio', () => {
  let urls: string[];
  let revoquees: string[];

  beforeEach(() => {
    urls = []; revoquees = [];
    let n = 0;
    URL.createObjectURL = () => { const u = `blob:ecoute-${++n}`; urls.push(u); return u; };
    URL.revokeObjectURL = (u: string) => { revoquees.push(u); };
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b, headers: new Headers() } as unknown as Response);
      if (u === '/api/voice/profil') {
        return json({ success: true, data: {
          voix: [{ id: 'v1', nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
          choix: 'v1', voixResolue: { id: 'v1', nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
          motifVoix: null, messageVoix: null, prononciations: [], ecouteDisponible: true,
        } });
      }
      if (u === '/api/voice/ecoute') return { ok: true, status: 200, blob: async () => new Blob(['AUDIO']), headers: new Headers() } as unknown as Response;
      return json({ success: true });
    }) as unknown as typeof fetch;
  });

  it('avant : seul « Écouter ma voix » ; après : lecteur ▶ sans `controls` ni téléchargement ; une nouvelle écoute remplace la source et libère l’ancienne URL ; démontage libère la dernière', async () => {
    const { unmount } = render(<MaVoixPanel />);
    const ecouter = await waitFor(() => screen.getByRole('button', { name: /Écouter ma voix/ }));
    expect(document.querySelector('[data-lecteur-voix]')).toBeNull();
    fireEvent.click(ecouter);
    await waitFor(() => expect(document.querySelector('[data-lecteur-voix]')).not.toBeNull());
    expect(audio().getAttribute('src')).toBe('blob:ecoute-1');
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
    expect(document.querySelector('[controls]')).toBeNull();
    expect(document.querySelector('[download]')).toBeNull();
    expect(document.querySelector('[data-voix-panel] audio[controls]')).toBeNull();

    // Seconde écoute : nouvelle source, ancienne URL libérée, état remis à zéro.
    act(() => metadonnees(audio(), 5));
    fireEvent.click(bouton());
    await waitFor(() => expect(bouton().getAttribute('aria-label')).toBe('Pause'));
    fireEvent.click(screen.getByRole('button', { name: /Écouter ma voix/ }));
    await waitFor(() => expect(audio().getAttribute('src')).toBe('blob:ecoute-2'));
    expect(revoquees).toContain('blob:ecoute-1');
    expect(bouton().getAttribute('aria-label')).toBe('Lire');
    expect(temps()).toBe('0:00 / 0:00');

    unmount();
    expect(revoquees).toContain('blob:ecoute-2');
  });
});
