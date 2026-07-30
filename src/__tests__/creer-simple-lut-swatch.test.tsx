import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LutSwatch from '@/components/creer/LutSwatch';
import { Lut } from '@/lib/luts/types';

/**
 * Nuancier « avant / après ».
 *
 * Sans rush, l'aperçu n'a rien à étalonner et le filtre reste invisible :
 * l'utilisateur choisirait un look à l'aveugle. Le nuancier montre ce que la
 * LUT fait aux couleurs, indépendamment de toute vidéo.
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

afterEach(cleanup);

describe('LutSwatch', () => {
  it('ne montre rien tant qu’aucun filtre n’est chargé', () => {
    const { container } = render(<LutSwatch lut={null} intensity={1} />);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('montre les deux états, nommés', () => {
    render(<LutSwatch lut={LUT} intensity={1} />);
    expect(screen.getByText(/Avant/i)).toBeDefined();
    expect(screen.getByText(/Après/i)).toBeDefined();
  });

  it('dessine une surface par état', () => {
    // Une seule surface ne permettrait pas la comparaison, qui est tout
    // l'objet du nuancier.
    const { container } = render(<LutSwatch lut={LUT} intensity={1} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });
});
