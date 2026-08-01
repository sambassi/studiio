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
  fallback: Pos = { x: MIN_PCT, y: MIN_PCT },
): Pos {
  // Conteneur pas encore mesure (`displayScale` vaut 0 au premier rendu) :
  // on rend la position COURANTE. Renvoyer {0,0} teleportait l'element dans
  // le coin haut-gauche a la moindre mesure ratee.
  if (!rect || rect.width <= 0 || rect.height <= 0) return fallback;
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


/** Ancrage d'un element : d'ou partent ses coordonnees. */
export type Anchor = 'top-left' | 'bottom-center';

/** Encombrement du bloc, en % du conteneur. */
export interface BoxPct {
  width: number;
  height: number;
}

/**
 * Borne une position pour que le bloc reste ENTIEREMENT visible.
 *
 * Borner l'ancre a [0,100] ne suffit pas : un titre ancre en haut-gauche a
 * `y=100` commence au bas du cadre, donc il n'en reste rien a l'ecran ; un CTA
 * centre a `x=0` sort de moitie. Le compositeur reproduit fidelement ces
 * positions — l'apercu et l'export seraient donc vides tous les deux.
 */
export function clampToBox(pos: Pos, anchor: Anchor, box: BoxPct): Pos {
  const w = Math.max(0, Math.min(100, box.width));
  const h = Math.max(0, Math.min(100, box.height));
  if (anchor === 'bottom-center') {
    // x designe le CENTRE, y designe le BAS du bloc.
    const half = w / 2;
    return {
      x: Math.min(100 - half, Math.max(half, clampPct(pos.x))),
      y: Math.min(100, Math.max(h, clampPct(pos.y))),
    };
  }
  // top-left : x et y designent le coin haut-gauche.
  return {
    x: Math.min(100 - w, Math.max(0, clampPct(pos.x))),
    y: Math.min(100 - h, Math.max(0, clampPct(pos.y))),
  };
}

/**
 * Emplacement d'une carte en mode libre, en % de son CONTENEUR (pas du
 * plateau) : `x/y` pour le coin haut-gauche, `w/h` pour l'encombrement.
 *
 * La taille fait partie de l'etat parce que le mode libre nait d'une MESURE de
 * la disposition en flux : la conserver telle quelle est ce qui garantit qu'au
 * moment de la bascule, rien ne bouge a l'ecran.
 */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
