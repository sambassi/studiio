import { Lut } from './types';

/**
 * Applique une LUT à un buffer RGBA **en place**.
 *
 * Interpolation **trilinéaire** et non plus-proche-voisin : le Mode simple est
 * fait de dégradés, et le plus-proche-voisin y produit des bandes visibles.
 *
 * C'est le chemin CPU de référence — celui des tests et de l'aperçu, où le
 * buffer fait quelques centaines de pixels de large. Le rendu vidéo pleine
 * résolution a ses propres contraintes (temps réel) et les traite ailleurs.
 *
 * @param intensity 0 → aucun effet, 1 → LUT pleine.
 */
export function applyLutToPixels(
  pixels: Uint8ClampedArray,
  lut: Lut,
  intensity: number,
): void {
  const k = Math.max(0, Math.min(1, intensity));
  if (k === 0) return;

  if (lut.kind === '1d') {
    applyLut1D(pixels, lut, k);
    return;
  }

  const n = lut.size;
  const last = n - 1;
  const table = lut.table;

  // L'entrée est sur 8 bits : les 256 positions d'axe possibles se pré-calculent
  // une fois pour tout le buffer, ce qui retire trois divisions et trois
  // `Math.floor` de la boucle par pixel.
  const node = new Int32Array(256);
  const frac = new Float32Array(256);
  for (let c = 0; c < 256; c++) {
    const v = normalize(c / 255, lut.domainMin[0], lut.domainMax[0]) * last;
    const i0 = Math.min(Math.floor(v), last);
    node[c] = i0;
    frac[c] = v - i0;
  }

  const strideG = n * 3;
  const strideB = n * n * 3;

  for (let p = 0; p < pixels.length; p += 4) {
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];

    const r0 = node[r];
    const g0 = node[g];
    const b0 = node[b];
    const r1 = r0 < last ? r0 + 1 : r0;
    const g1 = g0 < last ? g0 + 1 : g0;
    const b1 = b0 < last ? b0 + 1 : b0;
    const dr = frac[r];
    const dg = frac[g];
    const db = frac[b];

    // Les huit sommets du cube encadrant (r,g,b).
    const o000 = b0 * strideB + g0 * strideG + r0 * 3;
    const o100 = b0 * strideB + g0 * strideG + r1 * 3;
    const o010 = b0 * strideB + g1 * strideG + r0 * 3;
    const o110 = b0 * strideB + g1 * strideG + r1 * 3;
    const o001 = b1 * strideB + g0 * strideG + r0 * 3;
    const o101 = b1 * strideB + g0 * strideG + r1 * 3;
    const o011 = b1 * strideB + g1 * strideG + r0 * 3;
    const o111 = b1 * strideB + g1 * strideG + r1 * 3;

    for (let ch = 0; ch < 3; ch++) {
      const c00 = table[o000 + ch] + (table[o100 + ch] - table[o000 + ch]) * dr;
      const c10 = table[o010 + ch] + (table[o110 + ch] - table[o010 + ch]) * dr;
      const c01 = table[o001 + ch] + (table[o101 + ch] - table[o001 + ch]) * dr;
      const c11 = table[o011 + ch] + (table[o111 + ch] - table[o011 + ch]) * dr;
      const c0 = c00 + (c10 - c00) * dg;
      const c1 = c01 + (c11 - c01) * dg;
      const graded = (c0 + (c1 - c0) * db) * 255;
      const src = pixels[p + ch];
      pixels[p + ch] = src + (graded - src) * k;
    }
  }
}

/** Courbe indépendante par canal. */
function applyLut1D(pixels: Uint8ClampedArray, lut: Lut, k: number): void {
  const last = lut.size - 1;
  const table = lut.table;
  // Une courbe 1D se résout entièrement en trois tables de 256 entrées.
  const curve = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let ch = 0; ch < 3; ch++) {
    for (let c = 0; c < 256; c++) {
      const v = normalize(c / 255, lut.domainMin[ch], lut.domainMax[ch]) * last;
      const i0 = Math.min(Math.floor(v), last);
      const i1 = i0 < last ? i0 + 1 : i0;
      const d = v - i0;
      const a = table[i0 * 3 + ch];
      const b = table[i1 * 3 + ch];
      curve[ch][c] = (a + (b - a) * d) * 255;
    }
  }
  for (let p = 0; p < pixels.length; p += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const src = pixels[p + ch];
      pixels[p + ch] = src + (curve[ch][src] - src) * k;
    }
  }
}

/** Ramène une valeur du domaine déclaré par la LUT vers 0→1, bornes comprises. */
function normalize(v: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return 0;
  const t = (v - min) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
