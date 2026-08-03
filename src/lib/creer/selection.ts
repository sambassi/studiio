/**
 * Selection de cartes, et deplacement d'un lot.
 *
 * Regles PURES, sans React ni DOM : c'est ce qui les rend verifiables sur des
 * valeurs. Laissees en ligne dans un composant de pres de 4 000 lignes, elles
 * n'etaient testables que par correspondance de chaine — et une inversion de
 * `additive` passait alors inapercue.
 */

import type { CardBox, Pos } from './dragPosition';

/**
 * Etat suivant de la selection apres un appui sur `id`.
 *
 * `additive` (Maj, Cmd ou Ctrl) ajoute ou retire. Sinon l'appui isole la
 * carte — SAUF si elle fait deja partie du lot : sans cette exception, saisir
 * une carte d'un ensemble le deferait des l'appui, et deplacer un lot serait
 * impossible.
 *
 * Rend la reference PRECEDENTE quand rien ne change : un `Set` neuf a chaque
 * appui re-rendrait tout l'editeur pour rien.
 */
export function nextSelection(prev: Set<string>, id: string, additive: boolean): Set<string> {
  if (additive) {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (prev.has(id)) return prev;
  return new Set([id]);
}

/** Retire de la selection les cartes qui n'existent plus. */
export function pruneSelection(prev: Set<string>, ids: string[]): Set<string> {
  if (prev.size === 0) return prev;
  const kept = new Set([...prev].filter((id) => ids.includes(id)));
  return kept.size === prev.size ? prev : kept;
}

/**
 * Cartes qui suivront le glissement : le lot si la carte saisie en fait
 * partie, la carte seule sinon.
 */
export function movingIds(selection: Set<string>, dragged: string): string[] {
  return selection.has(dragged) ? [...selection] : [dragged];
}

/** Rectangle englobant d'un lot, en % du conteneur. */
export function groupBounds(boxes: Record<string, CardBox>, ids: string[]): CardBox | null {
  const list = ids.map((id) => boxes[id]).filter(Boolean);
  if (list.length === 0) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  const right = Math.max(...list.map((b) => b.x + b.w));
  const bottom = Math.max(...list.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Deplacement reellement applicable a un lot.
 *
 * Borner chaque carte separement DEFORMERAIT le lot : celles qui touchent le
 * bord s'arreteraient pendant que les autres continuent. On borne donc le
 * rectangle englobant, et le meme ecart est applique a toutes.
 */
export function clampGroupDelta(bounds: CardBox, delta: Pos): Pos {
  const minDx = -bounds.x;
  const maxDx = 100 - bounds.w - bounds.x;
  const minDy = -bounds.y;
  const maxDy = 100 - bounds.h - bounds.y;
  return {
    // `min` avant `max` : un lot plus large que le conteneur donnerait des
    // bornes inversees, et l'ecart doit alors rester nul plutot que negatif.
    x: Math.max(minDx, Math.min(maxDx, delta.x)),
    y: Math.max(minDy, Math.min(maxDy, delta.y)),
  };
}

/** Applique un ecart commun a chaque carte du lot. */
export function shiftBoxes(
  boxes: Record<string, CardBox>,
  ids: string[],
  delta: Pos,
): Record<string, CardBox> {
  if (delta.x === 0 && delta.y === 0) return boxes;
  const out = { ...boxes };
  for (const id of ids) {
    const b = boxes[id];
    if (!b) continue;
    out[id] = { ...b, x: b.x + delta.x, y: b.y + delta.y };
  }
  return out;
}
