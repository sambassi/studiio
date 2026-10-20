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

/**
 * ZOOM LENT DES CARTES — la photo des cartes ne reste jamais une image figée.
 *
 * La séquence Cartes dure ce que dure sa voix (règle audio, inchangée) :
 * jusqu'à 40 s sur UNE photo immobile. Un zoom très lent, de 1,00 à 1,06 sur
 * toute la séquence, la fait vivre sans gêner la lecture. Uniforme (même
 * facteur en largeur et en hauteur) et centré : l'image n'est JAMAIS
 * déformée, son rapport largeur / hauteur est conservé.
 */
export const ZOOM_CARTES_DEBUT = 1;
export const ZOOM_CARTES_FIN = 1.06;

/** Échelle des cartes à `progres` (0 → 1) de la séquence. */
export function echelleZoomCartes(progres: number): number {
  const p = Number.isFinite(progres) ? Math.min(1, Math.max(0, progres)) : 0;
  return Math.round((ZOOM_CARTES_DEBUT + (ZOOM_CARTES_FIN - ZOOM_CARTES_DEBUT) * p) * 10000) / 10000;
}

/** Le rectangle agrandi de `echelle` autour de son CENTRE (rapport conservé). */
export function rectZoomeCentre(
  r: { x: number; y: number; w: number; h: number }, echelle: number,
): { x: number; y: number; w: number; h: number } {
  const s = Number.isFinite(echelle) && echelle > 0 ? echelle : 1;
  const w = r.w * s;
  const h = r.h * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
