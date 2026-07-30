'use client';

import React, { useEffect, useRef } from 'react';
import { applyLutToPixels } from '@/lib/luts/apply';
import type { Lut } from '@/lib/luts/types';

/**
 * Nuancier « avant / après ».
 *
 * Sans rush, l'aperçu n'a rien à étalonner : le filtre resterait invisible et
 * l'utilisateur choisirait un look à l'aveugle. Le nuancier montre ce que la
 * LUT fait aux couleurs sans dépendre d'aucune vidéo.
 *
 * La mire est **dessinée**, pas embarquée : une photo de référence aurait
 * pesé quelques dizaines de Ko pour moins d'information. Une bande de teintes
 * révèle les virages de couleur, une bande de gris révèle la courbe de
 * contraste — les deux choses qu'une LUT fait.
 */

const W = 160;
const H = 40;

/** Mire : teintes en haut, gris en bas. */
function buildRamp(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const hueRow = y < H / 2;
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      let r: number;
      let g: number;
      let b: number;
      if (hueRow) {
        [r, g, b] = hueToRgb(t * 360);
      } else {
        r = g = b = Math.round(t * 255);
      }
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Teinte pleinement saturée, luminosité moyenne. */
function hueToRgb(h: number): [number, number, number] {
  const c = 1;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function Ramp({ lut, intensity }: { lut: Lut | null; intensity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Contexte indisponible (vieux navigateur, mémoire saturée) : le nuancier
    // reste vide plutôt que d'échouer. Il est illustratif, pas indispensable.
    if (!ctx) return;
    const pixels = buildRamp();
    if (lut) applyLutToPixels(pixels, lut, intensity);
    // `createImageData` plutot que `new ImageData` : le tampon suit alors
    // l'espace colorimetrique du contexte, et le typage n'exige pas un
    // `ArrayBuffer` non partage.
    const frame = ctx.createImageData(W, H);
    frame.data.set(pixels);
    ctx.putImageData(frame, 0, 0);
  }, [lut, intensity]);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      aria-hidden
      className="h-8 w-full rounded-md border border-white/10"
    />
  );
}

export default function LutSwatch({
  lut,
  intensity,
}: {
  lut: Lut | null;
  intensity: number;
}) {
  if (!lut) return null;
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <span className="block text-[10px] text-gray-500">Avant</span>
        <Ramp lut={null} intensity={1} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <span className="block text-[10px] text-gray-500">Après</span>
        <Ramp lut={lut} intensity={intensity} />
      </div>
    </div>
  );
}
