import { describe, it, expect } from 'vitest';
import {
  nextSelection, pruneSelection, movingIds, groupBounds, clampGroupDelta, shiftBoxes,
} from '@/lib/creer/selection';
import type { CardBox } from '@/lib/creer/dragPosition';

/**
 * Règles de sélection et de déplacement d'un lot — sur des VALEURS.
 *
 * Ces règles vivaient en ligne dans un composant de près de 4 000 lignes : un
 * audit a montré qu'une inversion pure et simple de `additive` — clic simple
 * qui accumule, Maj+clic qui isole — passait la suite complète au vert.
 */

const box = (x: number, y: number, w = 20, h = 10): CardBox => ({ x, y, w, h });

describe('nextSelection', () => {
  it('un clic simple isole la carte', () => {
    expect(nextSelection(new Set(['a', 'b']), 'c', false)).toEqual(new Set(['c']));
    expect(nextSelection(new Set(), 'a', false)).toEqual(new Set(['a']));
  });

  it('Maj+clic ajoute', () => {
    expect(nextSelection(new Set(['a']), 'b', true)).toEqual(new Set(['a', 'b']));
  });

  it('Maj+clic sur une carte déjà retenue la retire', () => {
    expect(nextSelection(new Set(['a', 'b']), 'a', true)).toEqual(new Set(['b']));
  });

  it('un clic simple sur une carte du lot CONSERVE le lot', () => {
    // Sinon saisir une carte d'un ensemble le déferait dès l'appui, et
    // déplacer un lot serait impossible.
    const lot = new Set(['a', 'b', 'c']);
    expect(nextSelection(lot, 'b', false)).toBe(lot);
  });

  it('les deux modes ne sont pas interchangeables', () => {
    // Le test qui tue l'inversion de `additive`.
    const prev = new Set(['a', 'b']);
    expect(nextSelection(prev, 'c', false)).toEqual(new Set(['c']));
    expect(nextSelection(prev, 'c', true)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('pruneSelection', () => {
  it('retire les cartes disparues', () => {
    expect(pruneSelection(new Set(['a', 'b']), ['a'])).toEqual(new Set(['a']));
  });

  it('rend la MÊME référence quand rien ne change', () => {
    // Un Set neuf à chaque rendu relancerait l'effet en boucle.
    const prev = new Set(['a']);
    expect(pruneSelection(prev, ['a', 'b'])).toBe(prev);
    const vide = new Set<string>();
    expect(pruneSelection(vide, [])).toBe(vide);
  });

  it('vide la sélection si plus aucune carte ne subsiste', () => {
    expect(pruneSelection(new Set(['a']), [])).toEqual(new Set());
  });
});

describe('movingIds — qui suit le glissement', () => {
  it('tout le lot si la carte saisie en fait partie', () => {
    expect(movingIds(new Set(['a', 'b']), 'a').sort()).toEqual(['a', 'b']);
  });

  it('la seule carte saisie sinon', () => {
    expect(movingIds(new Set(['a', 'b']), 'c')).toEqual(['c']);
    expect(movingIds(new Set(), 'c')).toEqual(['c']);
  });
});

describe('groupBounds', () => {
  it('englobe toutes les cartes du lot', () => {
    const boxes = { a: box(10, 10), b: box(50, 40) };
    expect(groupBounds(boxes, ['a', 'b'])).toEqual({ x: 10, y: 10, w: 60, h: 40 });
  });

  it('une seule carte : ses propres bornes', () => {
    expect(groupBounds({ a: box(10, 10) }, ['a'])).toEqual({ x: 10, y: 10, w: 20, h: 10 });
  });

  it('ignore les identifiants inconnus', () => {
    expect(groupBounds({ a: box(10, 10) }, ['a', 'fantome'])).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    expect(groupBounds({ a: box(10, 10) }, ['fantome'])).toBeNull();
  });
});

describe('clampGroupDelta — le lot ne se déforme pas au bord', () => {
  it('laisse passer un déplacement qui tient dans le cadre', () => {
    expect(clampGroupDelta({ x: 10, y: 10, w: 30, h: 20 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('arrête le lot ENTIER dès que son bord touche', () => {
    // Borner chaque carte séparément arrêterait celles du bord pendant que les
    // autres continuent : l'agencement se déformerait.
    expect(clampGroupDelta({ x: 10, y: 10, w: 30, h: 20 }, { x: 999, y: 999 }))
      .toEqual({ x: 60, y: 70 });
    expect(clampGroupDelta({ x: 10, y: 10, w: 30, h: 20 }, { x: -999, y: -999 }))
      .toEqual({ x: -10, y: -10 });
  });

  it('un lot déjà au bord ne bouge plus de ce côté', () => {
    expect(clampGroupDelta({ x: 0, y: 0, w: 100, h: 100 }, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });

  it('un lot plus grand que le cadre ne produit pas d écart négatif inversé', () => {
    const d = clampGroupDelta({ x: 0, y: 0, w: 140, h: 200 }, { x: 10, y: 10 });
    expect(d.x).toBeLessThanOrEqual(0);
    expect(d.y).toBeLessThanOrEqual(0);
  });
});

describe('shiftBoxes', () => {
  it('applique le MÊME écart à chaque carte du lot', () => {
    const boxes = { a: box(10, 10), b: box(50, 40) };
    const out = shiftBoxes(boxes, ['a', 'b'], { x: 5, y: -5 });
    expect(out.a).toEqual(box(15, 5));
    expect(out.b).toEqual(box(55, 35));
  });

  it('ne touche pas aux cartes hors du lot', () => {
    const boxes = { a: box(10, 10), b: box(50, 40) };
    const out = shiftBoxes(boxes, ['a'], { x: 5, y: 5 });
    expect(out.b).toBe(boxes.b);
  });

  it('un écart nul rend l objet inchangé', () => {
    const boxes = { a: box(10, 10) };
    expect(shiftBoxes(boxes, ['a'], { x: 0, y: 0 })).toBe(boxes);
  });

  it('ne mute pas l entrée', () => {
    const boxes = { a: box(10, 10) };
    shiftBoxes(boxes, ['a'], { x: 5, y: 5 });
    expect(boxes.a).toEqual(box(10, 10));
  });

  it('conserve la largeur et la hauteur — un déplacement ne redimensionne pas', () => {
    const out = shiftBoxes({ a: box(10, 10, 33, 7) }, ['a'], { x: 5, y: 5 });
    expect(out.a.w).toBe(33);
    expect(out.a.h).toBe(7);
  });
});
