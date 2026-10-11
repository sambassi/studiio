/**
 * KEN BURNS — le mouvement d'une PHOTO montée comme plan de la séquence
 * « Vidéo » (Autopilote multi-sources : photos Pexels / Unsplash retenues).
 *
 * Module PUR (aucun React, aucun Remotion) : la composition
 * `CreerSimpleMontage` l'appelle à chaque image, les tests le vérifient sur
 * des valeurs. Mouvement lent et linéaire — un zoom de 12 % ou un panoramique
 * de ±4 % sur la durée du plan : assez pour que la photo vive, jamais assez
 * pour découvrir un bord (l'image reste en `object-fit: cover`, agrandie).
 */
import type { MouvementImage } from '@/lib/creer/multi-rush';

export const ZOOM_KEN_BURNS = 1.12;
export const PAN_KEN_BURNS_PCT = 4;

/** Transformation CSS d'une photo à `progres` (0 → 1) de son plan. */
export function transformeKenBurns(mouvement: MouvementImage | undefined, progres: number): { scale: number; translateXPct: number; css: string } {
  const p = Number.isFinite(progres) ? Math.min(1, Math.max(0, progres)) : 0;
  const z = ZOOM_KEN_BURNS;
  let scale = 1 + (z - 1) * p;
  let translateXPct = 0;
  switch (mouvement ?? 'zoomIn') {
    case 'zoomOut': scale = z - (z - 1) * p; break;
    case 'panG': scale = z; translateXPct = PAN_KEN_BURNS_PCT - 2 * PAN_KEN_BURNS_PCT * p; break;
    case 'panD': scale = z; translateXPct = -PAN_KEN_BURNS_PCT + 2 * PAN_KEN_BURNS_PCT * p; break;
    default: break;
  }
  scale = Math.round(scale * 10000) / 10000;
  translateXPct = Math.round(translateXPct * 10000) / 10000;
  return { scale, translateXPct, css: `scale(${scale}) translateX(${translateXPct}%)` };
}
