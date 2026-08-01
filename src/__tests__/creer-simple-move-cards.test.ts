import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { clampToBox } from '@/lib/creer/dragPosition';

/**
 * Déplacement libre des cartes — Mode simple.
 *
 * Deux garanties, dans cet ordre d'importance :
 *
 * 1. **Tant qu'aucune carte n'est déplacée, rien ne change.** La disposition
 *    reste la colonne centrée en flux, et l'export avec elle — le conteneur des
 *    cartes est photographié puis blitté tel quel par le compositeur, donc tout
 *    écart de rendu serait aussi un écart d'export.
 * 2. **Le mode libre naît d'une mesure**, pas de valeurs inventées : à la
 *    première prise, chaque carte reprend la place exacte qu'elle occupait.
 *    Sans cela, saisir une carte les ferait toutes sauter.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

describe('Default-safe : la disposition en flux reste le défaut', () => {
  it('le mode libre part de null — aucun emplacement imposé', () => {
    expect(wizard).toContain('useState<Record<string, CardBox> | null>(null)');
  });

  it('sans mode libre, le conteneur garde sa colonne centrée et son écart', () => {
    // Ce sont les classes et l'écart d'origine : les retirer changerait le
    // rendu de tous les montages existants.
    expect(wizard).toContain("cardBoxes ? 'absolute' : 'absolute flex flex-col justify-center'");
    expect(wizard).toContain('gap: cardBoxes ? undefined : vw * CARD_RATIO.gap');
  });

  it("une carte sans emplacement ne reçoit aucun style de position", () => {
    // `: null` — pas de `position: absolute` par défaut, sinon la colonne
    // s'effondrerait dès le premier rendu.
    expect(wizard).toContain('? { position: \'absolute\' as const');
    expect(wizard).toContain(': null),');
  });

  it("un aperçu en lecture seule n'annonce ni curseur ni glissement", () => {
    expect(wizard).toContain("title={onCardDragStart ? 'Glisser pour déplacer la carte' : undefined}");
    expect(wizard).toContain("touchAction: onCardDragStart ? 'none' : undefined");
    expect(wizard).toContain("cursor: onCardDragStart ? (draggingCard === c.id ? 'grabbing' : 'grab') : undefined");
  });

  it('les props de Preview sont optionnelles, défaut = comportement d avant', () => {
    expect(wizard).toContain('cardBoxes = null');
    expect(wizard).toContain('draggingCard = null');
  });

  it('un nouveau montage revient à la disposition en flux', () => {
    const start = wizard.indexOf('const reset = ');
    expect(wizard.slice(start, start + 900)).toContain('setCardBoxes(null)');
  });
});

describe('La bascule en mode libre MESURE la disposition existante', () => {
  it('les emplacements viennent du DOM, pas de constantes', () => {
    expect(wizard).toContain("host.querySelectorAll<HTMLElement>('[data-card-id]')");
    expect(wizard).toContain('getBoundingClientRect()');
  });

  it('la mesure est relative au conteneur et exprimée en %', () => {
    expect(wizard).toContain('((r.left - box.left) / box.width) * 100');
    expect(wizard).toContain('((r.top - box.top) / box.height) * 100');
  });

  it('la HAUTEUR est mesurée puis réappliquée', () => {
    // Une carte passée en absolu sans hauteur se rétrécirait à son contenu :
    // la bascule serait visible, donc l'export changerait.
    expect(wizard).toContain('h: (r.height / box.height) * 100');
    expect(wizard).toContain('height: `${box.h}%`');
  });

  it('un conteneur non mesuré ne déclenche pas la bascule', () => {
    expect(wizard).toContain('if (box.width <= 0 || box.height <= 0) return null;');
    expect(wizard).toContain('if (!rect || rect.width <= 0) return;');
  });

  it("une carte inconnue n'active pas le mode libre à moitié", () => {
    // La bascule n'est enregistrée qu'après avoir trouvé la carte saisie.
    const start = wizard.indexOf('const startCardDrag');
    const bloc = wizard.slice(start, start + 1200);
    expect(bloc.indexOf('if (!boxes || !box) return;')).toBeLessThan(
      bloc.indexOf('setCardBoxes(boxes)'),
    );
  });
});

describe('Le glissement d une carte est borné à SON conteneur', () => {
  it('le repère est le conteneur des cartes, pas le plateau', () => {
    // Se borner au plateau laisserait une carte sortir de la zone
    // photographiée : visible à l'aperçu, absente de la vidéo.
    expect(wizard).toContain("(drag?.el === 'card' ? cardsRef : previewRef)");
  });

  it('une carte reste entièrement dans le conteneur', () => {
    const carte = { width: 100, height: 18 }; // pleine largeur, en % du conteneur
    expect(clampToBox({ x: 50, y: 95 }, 'top-left', carte)).toEqual({ x: 0, y: 82 });
    expect(clampToBox({ x: -20, y: -20 }, 'top-left', carte)).toEqual({ x: 0, y: 0 });
  });

  it('une carte plus étroite garde sa marge de manœuvre horizontale', () => {
    const carte = { width: 60, height: 18 };
    expect(clampToBox({ x: 90, y: 10 }, 'top-left', carte)).toEqual({ x: 40, y: 10 });
    expect(clampToBox({ x: 25, y: 10 }, 'top-left', carte)).toEqual({ x: 25, y: 10 });
  });

  it('réutilise le bornage du titre plutôt qu une seconde règle', () => {
    expect(wizard).toContain("clampToBox(raw, 'top-left', { width: box.w, height: box.h })");
  });

  it('les autres cartes ne sont pas déplacées avec celle qu on glisse', () => {
    // Fusion immuable : seule la clé glissée change.
    expect(wizard).toContain('const merged = { ...boxes, [id]: { ...box, x: next.x, y: next.y } }');
  });

  it('un déplacement nul ne provoque pas de rendu', () => {
    expect(wizard).toContain('if (next.x === box.x && next.y === box.y) return;');
  });
});

describe('Glissement durci, comme pour le titre', () => {
  it('un seul pointeur à la fois, et c est le même qui poursuit', () => {
    const start = wizard.indexOf('const startCardDrag');
    expect(wizard.slice(start, start + 400)).toContain('if (dragRef.current) return;');
    expect(wizard).toContain('drag.pointerId !== e.pointerId');
  });

  it('une capture qui échoue ne laisse pas l état bloqué', () => {
    const start = wizard.indexOf('const startCardDrag');
    const bloc = wizard.slice(start, start + 1600);
    expect(bloc).toContain('catch');
    expect(bloc).toContain('setDraggingCard(null)');
  });

  it('la fin du glissement relâche aussi la carte', () => {
    const start = wizard.indexOf('const endDrag = ');
    expect(wizard.slice(start, start + 300)).toContain('setDraggingCard(null)');
  });

  it('chaque carte écoute la perte de capture', () => {
    const start = wizard.indexOf('data-card-id={c.id}');
    const bloc = wizard.slice(start, start + 500);
    for (const h of ['onPointerMove', 'onPointerUp', 'onPointerCancel', 'onLostPointerCapture']) {
      expect(bloc, h).toContain(h);
    }
  });
});
