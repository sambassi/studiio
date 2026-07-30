import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import GradedVideo from '@/components/creer/GradedVideo';
import { Lut } from '@/lib/luts/types';

/**
 * Vidéo étalonnée de l'aperçu.
 *
 * Le canvas ne remplace la vidéo que lorsqu'il a vraiment de quoi l'afficher.
 * C'est le point qui tient toute la dégradation : si le contexte 2D est
 * indisponible — vieux navigateur, mémoire GPU saturée, ou simplement jsdom —
 * masquer la vidéo laisserait un rectangle noir à la place du rush.
 */

const LUT: Lut = {
  kind: '3d',
  size: 2,
  table: Float32Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1,
  ]),
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const video = (c: HTMLElement) => c.querySelector('video') as HTMLVideoElement;
const canvas = (c: HTMLElement) => c.querySelector('canvas');

describe('GradedVideo', () => {
  it('sans filtre, affiche la vidéo seule', () => {
    const { container } = render(<GradedVideo src="/rush.mp4" lut={null} intensity={1} />);
    expect(video(container)).toBeTruthy();
    expect(canvas(container)).toBeNull();
  });

  it('avec un filtre, ajoute une surface de dessin', () => {
    const { container } = render(<GradedVideo src="/rush.mp4" lut={LUT} intensity={1} />);
    expect(canvas(container)).toBeTruthy();
  });

  it('garde la vidéo visible tant qu’aucune frame n’est étalonnée', () => {
    // Cas réel de dégradation : sans contexte 2D, masquer la vidéo
    // remplacerait le rush par un rectangle noir.
    const { container } = render(<GradedVideo src="/rush.mp4" lut={LUT} intensity={1} />);
    expect(video(container).style.opacity).not.toBe('0');
  });

  it('respecte la politique d’autoplay de Chrome', () => {
    // Sans `muted`, la lecture automatique est refusée et l'aperçu reste figé
    // sur la première frame.
    const { container } = render(<GradedVideo src="/rush.mp4" lut={LUT} intensity={1} />);
    const v = video(container);
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.getAttribute('playsinline')).not.toBeNull();
  });

  it('arrête sa boucle au démontage', () => {
    // Une boucle qui survit au démontage continue de lire une vidéo détachée
    // à chaque frame, pour rien, jusqu'au rechargement de la page.
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { unmount } = render(<GradedVideo src="/rush.mp4" lut={LUT} intensity={1} />);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('signale une source illisible', () => {
    const onError = vi.fn();
    const { container } = render(
      <GradedVideo src="/casse.mp4" lut={LUT} intensity={1} onError={onError} />,
    );
    video(container).dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalled();
  });
});
