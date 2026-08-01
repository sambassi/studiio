import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pointToPct, grabOffset, clampPct, samePos } from '@/lib/creer/dragPosition';

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
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const rect = { left: 100, top: 50, width: 400, height: 800 };

describe('Placement en pourcentage du conteneur', () => {
  it('convertit un point écran en % du conteneur', () => {
    expect(pointToPct(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(pointToPct(500, 850, rect)).toEqual({ x: 100, y: 100 });
    expect(pointToPct(300, 450, rect)).toEqual({ x: 50, y: 50 });
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
    expect(samePos(same, anchor)).toBe(true);
  });

  it('résiste à un conteneur non mesuré ou à des valeurs absurdes', () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    expect(pointToPct(10, 10, zero)).toEqual({ x: 0, y: 0 });
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
    expect(wizard).not.toContain('DESIGN.titlePos.x');
    expect(wizard).not.toContain('DESIGN.ctaPos.y');
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

  it('désactive le défilement tactile pendant le glissement', () => {
    // Sans `touchAction: none`, un glissement au doigt fait défiler la page.
    expect(wizard.split("touchAction: 'none'").length - 1).toBeGreaterThanOrEqual(2);
  });
});
