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

/**
 * Nombre maximal de cartes que le compositeur sait dessiner.
 *
 * `video-composer.ts` borne a `isReel ? 5 : 6`, et `isReel` s'y decide sur
 * `hauteur > largeur` : le CARRE compte donc comme un paysage, 6 cartes. Les
 * cartes au-dela seraient silencieusement absentes du montage de secours — et
 * en flux, la colonne deborderait de son conteneur, donc de la photo.
 */
export function maxCards(format: string): number {
  return format === '9:16' ? 5 : 6;
}

/** Une carte, vue par les regles de duplication : seul l'`id` compte ici. */
export interface Identified {
  id: string;
}

export interface Duplication<T extends Identified> {
  /** Liste complete apres insertion. */
  cards: T[];
  /** Copies creees, dans l'ordre — elles deviennent la nouvelle selection. */
  created: { sourceId: string; id: string }[];
  /** Copies refusees faute de place. */
  dropped: number;
}

/**
 * Duplique les cartes retenues, chaque copie inseree JUSTE APRES son original.
 *
 * Inserer a la fin eloignerait la copie de ce qu'on vient de designer ; la
 * placer juste apres garde la lecture du montage intacte. L'ordre du tableau
 * fait foi, pas l'ordre de selection : deux copies restent dans le meme ordre
 * que leurs sources.
 */
export function duplicateCards<T extends Identified>(
  cards: T[],
  selection: Set<string>,
  newId: () => string,
  max: number,
): Duplication<T> {
  const out: T[] = [];
  const created: { sourceId: string; id: string }[] = [];
  let dropped = 0;
  let total = cards.length;
  for (const card of cards) {
    out.push(card);
    if (!selection.has(card.id)) continue;
    if (total >= max) { dropped += 1; continue; }
    const id = newId();
    out.push({ ...card, id });
    created.push({ sourceId: card.id, id });
    total += 1;
  }
  return { cards: out, created, dropped };
}

/**
 * Emplacements des copies, decales de `offset` par rapport a leur source et
 * bornes au conteneur.
 *
 * Sans decalage, une copie se poserait EXACTEMENT sur son original : on
 * croirait que rien ne s'est passe, puis on deplacerait la mauvaise.
 */
export function duplicateBoxes(
  boxes: Record<string, CardBox>,
  created: { sourceId: string; id: string }[],
  offset = 3,
): Record<string, CardBox> {
  const out = { ...boxes };
  for (const { sourceId, id } of created) {
    const src = boxes[sourceId];
    if (!src) continue;
    out[id] = {
      ...src,
      x: Math.min(Math.max(0, 100 - src.w), src.x + offset),
      y: Math.min(Math.max(0, 100 - src.h), src.y + offset),
    };
  }
  return out;
}
