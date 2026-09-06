import { describe, it, expect, vi } from 'vitest';
import { toCube, lutToTextureData, createLutGrader } from '@/lib/luts/grader';
import { Lut } from '@/lib/luts/types';

/**
 * Étalonnage sur GPU.
 *
 * Le shader ne peut pas tourner ici — jsdom n'a pas de WebGL. Ce qui est
 * testable, et c'est là que vivent les vrais bugs, c'est **la table envoyée à
 * la carte** : une erreur d'indexation y produit des couleurs fausses et
 * plausibles, exactement le défaut qu'aucune relecture ne rattrape.
 *
 * Le repli est testé aussi : sans WebGL, on rend une vidéo NON étalonnée
 * plutôt que de tomber sur un chemin CPU qui perdrait des frames.
 */

function identityCube(n: number): Lut {
  const table = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        table[i++] = r / (n - 1);
        table[i++] = g / (n - 1);
        table[i++] = b / (n - 1);
      }
    }
  }
  return { kind: '3d', size: n, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

describe('toCube', () => {
  it('laisse une LUT 3D telle quelle', () => {
    const lut = identityCube(4);
    expect(toCube(lut)).toBe(lut);
  });

  it('déplie une LUT 1D en cube, courbe par canal', () => {
    // Rouge écrasé à 0, vert et bleu inchangés.
    const lut: Lut = {
      kind: '1d',
      size: 2,
      table: Float32Array.from([0, 0, 0, 0, 1, 1]),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
    const cube = toCube(lut);
    expect(cube.kind).toBe('3d');
    expect(cube.size).toBe(2);
    // Nœud (r=1, g=1, b=1) → dernier triplet.
    const last = cube.table.slice(-3);
    expect(Array.from(last)).toEqual([0, 1, 1]);
  });
});

describe('lutToTextureData', () => {
  const N = 4;

  it('produit une bande de tuiles : size² de large, size de haut', () => {
    const { data, width, height } = lutToTextureData(identityCube(N));
    expect(width).toBe(N * N);
    expect(height).toBe(N);
    expect(data.length).toBe(width * height * 4);
  });

  it('range chaque nœud dans la bonne tuile', () => {
    // C'est LE test d'indexation : la tuile z porte le bleu, x le rouge,
    // y le vert. Une permutation ici donne des couleurs fausses mais
    // plausibles — invisibles en revue.
    const { data, width } = lutToTextureData(identityCube(N));
    const texel = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    const level = (v: number) => Math.round((v / (N - 1)) * 255);

    for (const [r, g, b] of [
      [0, 0, 0],
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
      [2, 1, 3],
    ]) {
      expect(texel(b * N + r, g)).toEqual([level(r), level(g), level(b), 255]);
    }
  });
});

describe('createLutGrader', () => {
  it('rend null quand WebGL est indisponible', () => {
    // Sans repli explicite, le compositeur tomberait sur un chemin CPU qui
    // ne tient pas les 33 ms par frame : mieux vaut une vidéo non étalonnée
    // qu'une vidéo saccadée.
    const canvas = { getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement;
    expect(createLutGrader(identityCube(4), 1, { createCanvas: () => canvas })).toBeNull();
  });
});
