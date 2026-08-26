import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pointToPct, grabOffset, clampPct, clampToBox } from '@/lib/creer/dragPosition';

/**
 * Déplacement du titre et du CTA — Mode simple.
 *
 * Le point le plus important n'est pas « ça bouge » : c'est que **tant que
 * rien n'est déplacé, l'export est identique à avant**. Les positions par
 * défaut doivent rester exactement celles des constantes `DESIGN`, et les
 * quatre consommateurs (aperçu, compositeur, métadonnées) doivent lire la même
 * source.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

const rect = { left: 100, top: 50, width: 400, height: 800 };

describe('Placement en pourcentage du conteneur', () => {
  it('convertit un point écran en % du conteneur', () => {
    expect(pointToPct(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(pointToPct(500, 850, rect)).toEqual({ x: 100, y: 100 });
    expect(pointToPct(300, 450, rect)).toEqual({ x: 50, y: 50 });
    // Point ASYMETRIQUE : sans lui, inverser x et y passerait inapercu — le
    // rect fait 400x800, donc x et y n'ont pas le meme diviseur.
    expect(pointToPct(300, 250, rect)).toEqual({ x: 50, y: 25 });
    expect(pointToPct(200, 650, rect)).toEqual({ x: 25, y: 75 });
  });

  it('BORNE au conteneur : un élément ne peut pas en sortir', () => {
    expect(pointToPct(-9999, -9999, rect)).toEqual({ x: 0, y: 0 });
    expect(pointToPct(9999, 9999, rect)).toEqual({ x: 100, y: 100 });
    expect(clampPct(-3)).toBe(0);
    expect(clampPct(140)).toBe(100);
  });

  it('tient compte du point de saisie : pas de saut au premier pixel', () => {
    // L'utilisateur saisit le titre à 10 % à droite de son ancre.
    const anchor = { x: 8, y: 8 };
    const grab = grabOffset(100 + 0.18 * 400, 50 + 0.08 * 800, rect, anchor);
    expect(grab.x).toBeCloseTo(10, 5);
    expect(grab.y).toBeCloseTo(0, 5);
    // Sans bouger la souris, l'ancre doit rester exactement où elle était.
    const same = pointToPct(100 + 0.18 * 400, 50 + 0.08 * 800, rect, grab);
    expect(same.x).toBeCloseTo(anchor.x, 5);
    expect(same.y).toBeCloseTo(anchor.y, 5);
  });

  it('résiste à un conteneur non mesuré ou à des valeurs absurdes', () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    // Conteneur non mesure : on garde la position courante au lieu de
    // teleporter l'element dans le coin.
    expect(pointToPct(10, 10, zero, { x: 0, y: 0 }, { x: 8, y: 8 })).toEqual({ x: 8, y: 8 });
    expect(grabOffset(10, 10, zero, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe('Default-safe : rien ne bouge tant qu on ne bouge rien', () => {
  it('les positions par défaut restent les constantes DESIGN d origine', () => {
    // Ce sont les valeurs historiques : titre en haut-gauche, CTA bas-centre.
    expect(wizard).toContain('titlePos: { x: 8, y: 8 }');
    expect(wizard).toContain('ctaPos: { x: 50, y: 92 }');
    expect(wizard).toContain('useState<Pos>(DESIGN.titlePos)');
    expect(wizard).toContain('useState<Pos>(DESIGN.ctaPos)');
  });

  it('aucun consommateur ne lit plus la constante figée', () => {
    // Sinon l'aperçu bougerait et l'export non — la divergence classique.
    // Interdiction TOTALE, et non une liste de formes littérales : une variante
    // d'écriture (`DESIGN.titlePos.x + '%'`, une espace en plus) réintroduirait
    // la divergence sans rien déclencher. Seule exception, retirée du texte
    // avant l'examen : `layoutTouched`, qui COMPARE la position courante à la
    // constante au lieu de la consommer.
    const debut = wizard.indexOf('const layoutTouched =');
    expect(debut).toBeGreaterThan(0);
    const fin = wizard.indexOf(';', wizard.indexOf('ctaPos.y !== DESIGN.ctaPos.y'));
    const sansComparaison = wizard.slice(0, debut) + wizard.slice(fin);
    for (const interdit of ['DESIGN.titlePos.x', 'DESIGN.titlePos.y', 'DESIGN.ctaPos.x', 'DESIGN.ctaPos.y']) {
      expect(sansComparaison, interdit).not.toContain(interdit);
    }
  });

  it('le compositeur ET les métadonnées lisent la même source que l aperçu', () => {
    expect(wizard).toContain('titlePosition: { x: titlePos.x, y: titlePos.y }');
    expect(wizard).toContain('watermarkPosition: { x: ctaPos.x, y: ctaPos.y }');
    expect(wizard).toContain('title: { x: titlePos.x, y: titlePos.y }');
    expect(wizard).toContain('watermark: { x: ctaPos.x, y: ctaPos.y }');
  });
});

describe('Le glissement est branché sur les deux éléments', () => {
  it('titre et CTA écoutent tous les événements pointeur, annulation comprise', () => {
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      // Deux occurrences : une pour le titre, une pour le CTA.
      expect(wizard.split(handler).length - 1, handler).toBeGreaterThanOrEqual(2);
    }
    expect(wizard).toContain("onDragStart?.('title'");
    expect(wizard).toContain("onDragStart?.('cta'");
  });

  it('capture le pointeur pour ne pas perdre le glissement hors de l élément', () => {
    expect(wizard).toContain('setPointerCapture');
  });

  it('désactive le défilement tactile quand l aperçu est déplaçable', () => {
    // Sans `touchAction: none`, un glissement au doigt fait défiler la page.
    // Conditionnel : un aperçu en lecture seule ne doit pas bloquer le pinch.
    expect(wizard.split("touchAction: onDragStart ? 'none' : undefined").length - 1).toBe(2);
  });
});

describe('Bornage : le bloc reste ENTIÈREMENT visible', () => {
  const titre = { width: 84, height: 12 };   // largeur du bloc titre, en %
  const cta = { width: 70, height: 8 };

  it('un titre (ancré haut-gauche) ne peut pas sortir par le bas ni par la droite', () => {
    // Borner l'ancre à [0,100] laissait un titre à y=100 entièrement hors écran.
    expect(clampToBox({ x: 100, y: 100 }, 'top-left', titre)).toEqual({ x: 16, y: 88 });
    expect(clampToBox({ x: -50, y: -50 }, 'top-left', titre)).toEqual({ x: 0, y: 0 });
  });

  it('un CTA (ancré bas-centre) ne peut pas sortir de moitié sur les côtés', () => {
    // x = centre du bloc : à x=0, la moitié gauche était hors cadre.
    expect(clampToBox({ x: 0, y: 92 }, 'bottom-center', cta)).toEqual({ x: 35, y: 92 });
    expect(clampToBox({ x: 100, y: 92 }, 'bottom-center', cta)).toEqual({ x: 65, y: 92 });
  });

  it('un CTA ne peut pas sortir par le haut : y désigne son BAS', () => {
    expect(clampToBox({ x: 50, y: 0 }, 'bottom-center', cta)).toEqual({ x: 50, y: 8 });
    expect(clampToBox({ x: 50, y: 100 }, 'bottom-center', cta)).toEqual({ x: 50, y: 100 });
  });

  it('laisse INCHANGÉE une position déjà valide', () => {
    // La garantie « rien ne change quand la valeur est bonne ».
    expect(clampToBox({ x: 8, y: 8 }, 'top-left', titre)).toEqual({ x: 8, y: 8 });
    expect(clampToBox({ x: 50, y: 92 }, 'bottom-center', cta)).toEqual({ x: 50, y: 92 });
  });

  it('un bloc plus large que le cadre ne produit pas de borne inversée', () => {
    const enorme = { width: 140, height: 200 };
    const p = clampToBox({ x: 50, y: 50 }, 'top-left', enorme);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

describe('Glissement durci', () => {
  it('un seul pointeur à la fois — le multi-touch ne vole pas le glissement', () => {
    expect(wizard).toContain('if (dragRef.current) return;');
    expect(wizard).toContain('drag.pointerId !== e.pointerId');
  });

  it('le survol sans bouton ne déplace rien', () => {
    expect(wizard).toContain("e.buttons === 0 && e.pointerType === 'mouse'");
  });

  it('la perte de capture termine le glissement', () => {
    expect(wizard.split('onLostPointerCapture').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('une capture qui échoue ne laisse pas l état bloqué', () => {
    const start = wizard.indexOf('const startDrag');
    const bloc = wizard.slice(start, start + 1400);
    expect(bloc).toContain('try {');
    expect(bloc).toContain('catch');
  });

  it('le titre et le CTA passent au-dessus de la grille de cartes', () => {
    // Sinon un titre déposé au centre devient insaisissable.
    expect(wizard.split('zIndex: onDragStart ? 2 : undefined').length - 1).toBe(2);
  });

  it('un nouveau montage repart des positions par défaut', () => {
    const start = wizard.indexOf('const reset = ');
    const bloc = wizard.slice(start, start + 700);
    expect(bloc).toContain('setTitlePos(DESIGN.titlePos)');
    expect(bloc).toContain('setCtaPos(DESIGN.ctaPos)');
  });

  it('un aperçu en lecture seule n annonce pas un glissement impossible', () => {
    // ⚠️ ON VERIFIE L'INVARIANT, PAS LA LIGNE. Le libelle a gagne une branche
    // (double-clic pour la police, cote Autopilote) ; ce qui compte reste que
    // le REPLI soit `undefined` quand aucun glissement n'est possible.
    expect(wizard).toContain("onDragStart ? 'Glisser pour déplacer le titre' : undefined");
    expect(wizard).toContain("onDragStart ? 'Glisser pour déplacer le CTA' : undefined");
    expect(wizard).toContain("touchAction: onDragStart ? 'none' : undefined");
  });
});
