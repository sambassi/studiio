import { describe, it, expect } from 'vitest';
import { parseLutPng } from '@/lib/luts/parse';
import { applyLutToPixels } from '@/lib/luts/apply';

/**
 * LUT au format image (PNG).
 *
 * Le piège du format : **HALD CLUT et grille de tuiles ont exactement les
 * mêmes dimensions** (512×512 pour un cube de 64 dans les deux cas) et un
 * ordre de pixels différent. Lire l'un pour l'autre ne produit pas une erreur,
 * mais des couleurs fausses et plausibles — invisibles en revue. Le parseur
 * doit donc trancher sur le CONTENU, et refuser quand il ne peut pas.
 */

/** Image HALD CLUT de niveau `t` : côté t³, cube t². Ordre linéaire, rouge le plus rapide. */
function haldIdentity(t: number): { data: Uint8ClampedArray; width: number } {
  const cube = t * t;
  const width = t * t * t;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    const r = i % cube;
    const g = Math.floor(i / cube) % cube;
    const b = Math.floor(i / (cube * cube));
    data[i * 4] = Math.round((r / (cube - 1)) * 255);
    data[i * 4 + 1] = Math.round((g / (cube - 1)) * 255);
    data[i * 4 + 2] = Math.round((b / (cube - 1)) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, width };
}

/** Grille t×t de tuiles cube×cube : le bleu indexe la tuile, rouge = x, vert = y. */
function tileIdentity(t: number): { data: Uint8ClampedArray; width: number } {
  const cube = t * t;
  const width = t * cube;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const b = Math.floor(y / cube) * t + Math.floor(x / cube);
      const r = x % cube;
      const g = y % cube;
      const i = (y * width + x) * 4;
      data[i] = Math.round((r / (cube - 1)) * 255);
      data[i + 1] = Math.round((g / (cube - 1)) * 255);
      data[i + 2] = Math.round((b / (cube - 1)) * 255);
      data[i + 3] = 255;
    }
  }
  return { data, width };
}

/** Un échantillon de couleurs, en RGBA. */
function sample(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    200, 40, 90, 255,
    17, 180, 240, 255,
  ]);
}

describe('parseLutPng — lecture', () => {
  it('lit une image HALD et en tire une LUT identité', () => {
    const { data, width } = haldIdentity(4); // 64×64, cube de 16
    const lut = parseLutPng(data, width, width);
    expect(lut.size).toBe(16);

    const pixels = sample();
    const before = Array.from(pixels);
    applyLutToPixels(pixels, lut, 1);
    Array.from(pixels).forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThanOrEqual(2));
  });

  it('lit une grille de tuiles et en tire la MÊME LUT identité', () => {
    const { data, width } = tileIdentity(4);
    const lut = parseLutPng(data, width, width);
    expect(lut.size).toBe(16);

    const pixels = sample();
    const before = Array.from(pixels);
    applyLutToPixels(pixels, lut, 1);
    Array.from(pixels).forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThanOrEqual(2));
  });

  it('distingue les deux dispositions alors qu’elles ont la même taille', () => {
    const hald = haldIdentity(4);
    const tile = tileIdentity(4);
    expect(hald.width).toBe(tile.width); // c'est tout le problème
    // Les deux doivent être reconnues, donc pas de choix codé en dur.
    expect(parseLutPng(hald.data, hald.width, hald.width).layout).toBe('hald');
    expect(parseLutPng(tile.data, tile.width, tile.width).layout).toBe('tiles');
  });
});

describe('parseLutPng — refus explicites', () => {
  it('refuse une image non carrée', () => {
    const data = new Uint8ClampedArray(64 * 32 * 4);
    expect(() => parseLutPng(data, 64, 32)).toThrow(/carrée/i);
  });

  it('refuse un côté qui ne correspond à aucun cube', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4);
    expect(() => parseLutPng(data, 100, 100)).toThrow(/100/);
  });

  it('refuse un cube plus grand que le plafond', () => {
    // Côté 1728 = 12³ → cube de 144, au-delà des 64 acceptés.
    const data = new Uint8ClampedArray(4);
    expect(() => parseLutPng(data, 1728, 1728)).toThrow(/64/);
  });

  it('refuse une image dont aucune disposition ne ressort — plutôt que de deviner', () => {
    // Bruit : ni l'une ni l'autre lecture n'est cohérente.
    const { width } = haldIdentity(4);
    const data = new Uint8ClampedArray(width * width * 4);
    let seed = 1;
    for (let i = 0; i < width * width; i++) {
      for (let c = 0; c < 3; c++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i * 4 + c] = seed % 256;
      }
      data[i * 4 + 3] = 255;
    }
    expect(() => parseLutPng(data, width, width)).toThrow(/disposition|ambig/i);
  });
});
