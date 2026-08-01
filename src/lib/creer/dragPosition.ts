/**
 * Conversion d'un deplacement a la souris en position, exprimee en POURCENTAGE
 * du conteneur d'apercu.
 *
 * Pourquoi en pourcentage : l'apercu est mis a l'echelle (`displayScale`) et
 * change de taille avec le format (9:16, 16:9, 1:1), alors que le compositeur
 * et les metadonnees raisonnent en pourcentage de la frame. Passer par des
 * pixels obligerait a reconvertir partout, avec une divergence garantie entre
 * ce qu'on voit et ce qui est exporte.
 *
 * Fonctions PURES, sans React ni DOM : c'est la regle de placement, testable
 * seule.
 */

export interface Pos {
  x: number;
  y: number;
}

/** Rectangle du conteneur, en coordonnees ecran. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Bornes autorisees, en % — l'element ne peut pas sortir du conteneur. */
export const MIN_PCT = 0;
export const MAX_PCT = 100;

export function clampPct(v: number): number {
  // NaN n'a pas de place sur l'axe : on retombe sur la borne basse. En
  // revanche ±Infinity a un sens directionnel, on le borne normalement.
  if (Number.isNaN(v)) return MIN_PCT;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, v));
}

/**
 * Position d'un point ecran, en % du conteneur.
 *
 * `grab` est l'ecart entre le point saisi et l'ancre de l'element, lui aussi
 * en % : sans lui, l'element sauterait pour se centrer sous le curseur au
 * premier pixel de deplacement.
 */
export function pointToPct(
  clientX: number,
  clientY: number,
  rect: Rect,
  grab: Pos = { x: 0, y: 0 },
): Pos {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: MIN_PCT, y: MIN_PCT };
  const x = ((clientX - rect.left) / rect.width) * 100 - grab.x;
  const y = ((clientY - rect.top) / rect.height) * 100 - grab.y;
  return { x: clampPct(x), y: clampPct(y) };
}

/**
 * Ecart entre le point saisi et l'ancre actuelle de l'element, en % — a
 * calculer au `pointerdown` et a conserver pendant tout le glissement.
 */
export function grabOffset(clientX: number, clientY: number, rect: Rect, anchor: Pos): Pos {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) / rect.width) * 100 - anchor.x,
    y: ((clientY - rect.top) / rect.height) * 100 - anchor.y,
  };
}

/** `true` si deux positions sont identiques a l'arrondi d'affichage pres. */
export function samePos(a: Pos, b: Pos, epsilon = 0.01): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}
