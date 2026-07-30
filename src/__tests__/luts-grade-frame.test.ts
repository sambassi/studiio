import { describe, it, expect } from 'vitest';
import { gradeFrame } from '@/lib/luts/gradeFrame';
import { Lut } from '@/lib/luts/types';

/**
 * Étalonnage d'une frame.
 *
 * jsdom n'a pas de contexte 2D : on en fournit une VRAIE petite
 * implémentation (un tampon de pixels que `drawImage` remplit et que
 * `putImageData` recueille), et on regarde les pixels qui en sortent. Ce n'est
 * pas un mock du code testé — c'est la surface de dessin, remplacée par une
 * surface équivalente qu'on peut lire.
 */

function invertLut(): Lut {
  const n = 2;
  const table = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        table[i++] = 1 - r;
        table[i++] = 1 - g;
        table[i++] = 1 - b;
      }
    }
  }
  return { kind: '3d', size: n, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** Surface de dessin minimale : `drawImage` peint la couleur de la source. */
function fakeCanvas(width: number, height: number, sourceColor: [number, number, number]) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  const calls: string[] = [];
  const ctx = {
    drawImage() {
      calls.push('drawImage');
      for (let p = 0; p < buffer.length; p += 4) {
        buffer[p] = sourceColor[0];
        buffer[p + 1] = sourceColor[1];
        buffer[p + 2] = sourceColor[2];
        buffer[p + 3] = 255;
      }
    },
    getImageData() {
      calls.push('getImageData');
      return { data: new Uint8ClampedArray(buffer), width, height };
    },
    putImageData(img: { data: Uint8ClampedArray }) {
      calls.push('putImageData');
      buffer.set(img.data);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, buffer, calls };
}

const SOURCE = {} as CanvasImageSource;

describe('gradeFrame', () => {
  it('rend la frame étalonnée, pas la frame d’origine', () => {
    const { ctx, buffer } = fakeCanvas(2, 2, [0, 0, 0]);
    gradeFrame(ctx, SOURCE, invertLut(), 1, 2, 2);
    expect(Array.from(buffer.slice(0, 3))).toEqual([255, 255, 255]);
  });

  it('dessine la source AVANT de lire les pixels', () => {
    // Inversé, on étalonnerait la frame précédente : l'aperçu aurait une
    // frame de retard en permanence.
    const { ctx, calls } = fakeCanvas(1, 1, [10, 20, 30]);
    gradeFrame(ctx, SOURCE, invertLut(), 1, 1, 1);
    expect(calls).toEqual(['drawImage', 'getImageData', 'putImageData']);
  });

  it('laisse la frame intacte à intensité 0', () => {
    const { ctx, buffer } = fakeCanvas(1, 1, [10, 20, 30]);
    gradeFrame(ctx, SOURCE, invertLut(), 0, 1, 1);
    expect(Array.from(buffer.slice(0, 3))).toEqual([10, 20, 30]);
  });

  it('dessine sans rien lire quand il n’y a pas de LUT', () => {
    // `getImageData` sur une frame pleine résolution coûte cher : sans LUT il
    // ne doit tout simplement pas avoir lieu.
    const { ctx, buffer, calls } = fakeCanvas(1, 1, [10, 20, 30]);
    gradeFrame(ctx, SOURCE, null, 1, 1, 1);
    expect(calls).toEqual(['drawImage']);
    expect(Array.from(buffer.slice(0, 3))).toEqual([10, 20, 30]);
  });
});
