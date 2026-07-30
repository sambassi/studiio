import { describe, it, expect } from 'vitest';
import { applyLutToPixels } from '@/lib/luts/apply';
import { Lut } from '@/lib/luts/types';

/**
 * Application d'une LUT à un buffer RGBA.
 *
 * Le test qui compte vraiment est « l’identité est un no-op » : une LUT
 * identité qui décale les couleurs signale une erreur d'indexation ou
 * d'interpolation, et c'est exactement le genre de bug qui ne se voit pas à
 * l'œil sur un étalonnage réel.
 */

/** Cube identité de taille n, ordre `.cube` (rouge le plus rapide). */
function identityLut(n: number): Lut {
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

/** Cube qui inverse chaque canal. */
function invertLut(n: number): Lut {
  const lut = identityLut(n);
  for (let i = 0; i < lut.table.length; i++) lut.table[i] = 1 - lut.table[i];
  return lut;
}

function px(...rgba: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba);
}

describe('applyLutToPixels — fidélité', () => {
  it('une LUT identité ne modifie aucun pixel', () => {
    const pixels = px(0, 0, 0, 255, 255, 255, 255, 255, 12, 200, 77, 255);
    const before = Array.from(pixels);
    applyLutToPixels(pixels, identityLut(2), 1);
    expect(Array.from(pixels)).toEqual(before);
  });

  it('une LUT identité de taille 33 ne modifie aucun pixel', () => {
    // Taille impaire et grande : c'est là que se voient les erreurs d'indexation.
    const pixels = px(1, 2, 3, 255, 128, 128, 128, 255, 254, 17, 99, 255);
    const before = Array.from(pixels);
    applyLutToPixels(pixels, identityLut(33), 1);
    expect(Array.from(pixels)).toEqual(before);
  });

  it('interpole entre les nœuds au lieu de prendre le plus proche', () => {
    // Une identité de taille 2 n'a que les nœuds 0 et 255. Sans interpolation
    // trilinéaire, 128 tomberait sur 0 ou sur 255 — pas sur lui-même.
    const pixels = px(128, 128, 128, 255);
    applyLutToPixels(pixels, identityLut(2), 1);
    expect(pixels[0]).toBeGreaterThan(120);
    expect(pixels[0]).toBeLessThan(136);
  });

  it('préserve le canal alpha', () => {
    const pixels = px(10, 20, 30, 42);
    applyLutToPixels(pixels, invertLut(2), 1);
    expect(pixels[3]).toBe(42);
  });
});

describe('applyLutToPixels — étalonnage', () => {
  it('inverse les canaux avec une LUT d’inversion', () => {
    const pixels = px(0, 0, 0, 255, 255, 0, 0, 255);
    applyLutToPixels(pixels, invertLut(2), 1);
    expect(Array.from(pixels.slice(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(pixels.slice(4, 7))).toEqual([0, 255, 255]);
  });

  it('n’applique rien à intensité 0', () => {
    const pixels = px(10, 20, 30, 255);
    applyLutToPixels(pixels, invertLut(2), 0);
    expect(Array.from(pixels)).toEqual([10, 20, 30, 255]);
  });

  it('mélange à mi-chemin à intensité 0,5', () => {
    const pixels = px(0, 0, 0, 255);
    applyLutToPixels(pixels, invertLut(2), 0.5);
    // 0 → 255 à pleine intensité, donc ~127 à mi-chemin.
    expect(pixels[0]).toBeGreaterThan(125);
    expect(pixels[0]).toBeLessThan(130);
  });

  it('applique une LUT 1D canal par canal', () => {
    // Courbe qui écrase tout à 0 sur le rouge, laisse vert et bleu intacts.
    const lut: Lut = {
      kind: '1d',
      size: 2,
      table: Float32Array.from([0, 0, 0, 0, 1, 1]),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
    const pixels = px(255, 255, 255, 255);
    applyLutToPixels(pixels, lut, 1);
    expect(pixels[0]).toBe(0);
    expect(pixels[1]).toBe(255);
    expect(pixels[2]).toBe(255);
  });
});
