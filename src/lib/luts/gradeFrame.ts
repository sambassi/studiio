import { applyLutToPixels } from './apply';
import { Lut } from './types';

/**
 * Peint une frame sur un canvas, étalonnée si une LUT est fournie.
 *
 * L'ordre est le point sensible : on DESSINE puis on lit. Inversé, on
 * étalonnerait la frame précédente et l'aperçu aurait une frame de retard en
 * permanence — un décalage qu'on ne voit pas sur une image fixe et qui saute
 * aux yeux sur une vidéo.
 *
 * Sans LUT, aucun `getImageData` : sur une frame pleine résolution, cette
 * lecture est ce qui coûte le plus cher, et elle n'aurait rien à faire.
 */
export function gradeFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  lut: Lut | null,
  intensity: number,
  width: number,
  height: number,
): void {
  ctx.drawImage(source, 0, 0, width, height);
  if (!lut || intensity <= 0) return;
  const frame = ctx.getImageData(0, 0, width, height);
  applyLutToPixels(frame.data, lut, intensity);
  ctx.putImageData(frame as ImageData, 0, 0);
}
