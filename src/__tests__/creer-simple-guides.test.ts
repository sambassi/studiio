import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  snapPosition,
  computeDistanceBadges,
  anchorToCenter,
  centerToAnchor,
  SNAP_THRESHOLD_PERCENT,
  type ElementPos,
} from '@/lib/creer/smartGuides';

/**
 * Guides d'alignement — Mode simple.
 *
 * La logique existait déjà, autonome, dans `lib/creer/smartGuides` : rien à
 * porter, tout à câbler.
 *
 * Le point qui ne se voit pas et décide du résultat : **les éléments ne sont
 * pas ancrés au même endroit**. Le titre l'est par son coin haut-gauche, le
 * CTA par le milieu de son bas, un élément libre par son centre. Or un guide
 * de centrage parle du CENTRE. Aimanter la position d'ancre reviendrait à
 * centrer le **bord gauche** du titre sur l'axe — visiblement décalé de la
 * moitié de sa largeur.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const autre = (x: number, y: number): ElementPos => ({ key: 'element', x, y, label: 'Autre' });

describe('L aimantation', () => {
  it('attire vers le centre du plateau', () => {
    const r = snapPosition(50.5, 20, []);
    expect(r.x).toBe(50);
    expect(r.guides.some((g) => g.axis === 'x' && g.source === 'preview-center')).toBe(true);
  });

  it('ne s applique pas au-delà du seuil', () => {
    const loin = 50 + SNAP_THRESHOLD_PERCENT + 1;
    const r = snapPosition(loin, 20, []);
    expect(r.x).toBe(loin);
    expect(r.guides).toHaveLength(0);
  });

  it('juste sous le seuil, ça aimante ; juste au-dessus, non', () => {
    // La borne EXACTE n'est pas testable : `50 + 1.6 - 50` vaut
    // 1.6000000000000085 en virgule flottante, donc au-dessus du seuil.
    // Ce qui compte est le comportement de part et d'autre.
    expect(snapPosition(50 + SNAP_THRESHOLD_PERCENT * 0.99, 20, []).x).toBe(50);
    expect(snapPosition(50 + SNAP_THRESHOLD_PERCENT * 1.01, 20, []).x).not.toBe(50);
  });

  it('attire aussi vers le centre d un AUTRE élément', () => {
    const r = snapPosition(30.5, 80, [autre(30, 40)]);
    expect(r.x).toBe(30);
    expect(r.guides.some((g) => g.source === 'element-center')).toBe(true);
  });

  it('retient la cible la PLUS PROCHE', () => {
    // Deux repères dans le seuil : celui de 50 est à 0,2, celui de 51 à 0,8.
    const r = snapPosition(50.2, 20, [autre(51, 20)]);
    expect(r.x).toBe(50);
  });

  it('les deux axes sont indépendants', () => {
    const r = snapPosition(50.4, 12, []);
    expect(r.x).toBe(50);
    expect(r.y).toBe(12);
    expect(r.guides).toHaveLength(1);
  });
});

describe('Ancre ↔ centre — la conversion qui décide de tout', () => {
  const box = { width: 40, height: 10 };

  it('un titre ancré en haut-gauche a son centre au milieu de sa boîte', () => {
    expect(anchorToCenter({ x: 10, y: 20 }, 'top-left', box)).toEqual({ x: 30, y: 25 });
  });

  it('un CTA ancré en bas-centre a son centre au-DESSUS de son ancre', () => {
    expect(anchorToCenter({ x: 50, y: 90 }, 'bottom-center', box)).toEqual({ x: 50, y: 85 });
  });

  it('un élément ancré au centre est déjà son centre', () => {
    expect(anchorToCenter({ x: 33, y: 44 }, 'center', box)).toEqual({ x: 33, y: 44 });
  });

  it('la réciproque est EXACTE — sinon l élément dériverait à chaque frame', () => {
    for (const anchor of ['top-left', 'bottom-center', 'center'] as const) {
      const pos = { x: 27, y: 61 };
      const retour = centerToAnchor(anchorToCenter(pos, anchor, box), anchor, box);
      expect(retour, anchor).toEqual(pos);
    }
  });

  it('une boîte absente ou aberrante ne déplace rien', () => {
    const nulle = { width: Number.NaN, height: Number.NaN };
    expect(anchorToCenter({ x: 10, y: 20 }, 'top-left', nulle)).toEqual({ x: 10, y: 20 });
    expect(centerToAnchor({ x: 10, y: 20 }, 'bottom-center', nulle)).toEqual({ x: 10, y: 20 });
  });

  it('centrer un titre large le pose bien à gauche de l axe', () => {
    // C'est le cas qui prouve l'utilité de la conversion : le centre est
    // à 50, donc l'ancre doit être à 50 − largeur/2.
    expect(centerToAnchor({ x: 50, y: 50 }, 'top-left', box)).toEqual({ x: 30, y: 45 });
  });
});

describe('Les badges d écart', () => {
  const actif = { key: 'element' as const, x: 50, y: 50, label: 'En cours' };

  it('un badge par voisin, sur les quatre côtés', () => {
    const b = computeDistanceBadges(actif, [autre(50, 20), autre(50, 80), autre(20, 50), autre(80, 50)], 400, 800);
    expect(b).toHaveLength(4);
  });

  it('la distance est convertie en pixels de l aperçu', () => {
    const b = computeDistanceBadges(actif, [autre(50, 25)], 400, 800);
    // 25 % de 800 px = 200 px.
    expect(b[0].distancePx).toBe(200);
  });

  it('les deux axes n ont pas le même diviseur', () => {
    const vertical = computeDistanceBadges(actif, [autre(50, 25)], 400, 800)[0];
    const horizontal = computeDistanceBadges(actif, [autre(25, 50)], 400, 800)[0];
    expect(vertical.distancePx).not.toBe(horizontal.distancePx);
  });

  it('des écarts ÉGAUX donnent des distances égales — c est tout l intérêt', () => {
    const b = computeDistanceBadges(actif, [autre(50, 30), autre(50, 70)], 400, 800);
    expect(b[0].distancePx).toBe(b[1].distancePx);
  });

  it('sans voisin, aucun badge', () => {
    expect(computeDistanceBadges(actif, [], 400, 800)).toEqual([]);
  });
});

describe('Le câblage dans le Mode simple', () => {
  it('l aimantation passe par le CENTRE, pas par l ancre', () => {
    expect(wizard).toContain('const centre = anchorToCenter(pos, anchor, box);');
    expect(wizard).toContain("return centerToAnchor({ x: snap.x, y: snap.y }, anchor, box);");
  });

  it('le titre et le CTA gardent CHACUN leur ancre', () => {
    expect(wizard).toContain("const ancre: Anchor = drag.el === 'title' ? 'top-left' : 'bottom-center';");
    expect(wizard).toContain('snapAndGuide(raw, ancre, drag.box, drag.el, rect)');
  });

  it('un élément s aimante sur son centre', () => {
    expect(wizard).toContain("snapAndGuide(raw, 'center', drag.box, id, rect)");
  });

  it('l élément déplacé est EXCLU de ses propres repères', () => {
    // Sinon il s'aimanterait à sa position courante et ne bougerait plus.
    expect(wizard).toContain('const alignmentTargets = useCallback((exclure: string)');
    expect(wizard).toContain("if (exclure !== 'title') {");
    expect(wizard).toContain('if (el.id === exclure) continue;');
  });

  it('l aimantation vient AVANT le bornage', () => {
    // L'inverse laisserait le bornage défaire l'aimantation sur un élément
    // posé au ras du cadre.
    const i = wizard.indexOf("const aimante = snapAndGuide(raw, 'center'");
    const j = wizard.indexOf("clampToBox(aimante, 'center', drag.box)");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});

describe('Les guides ne se gravent JAMAIS dans l export', () => {
  it('ils disparaissent au relâchement', () => {
    const fin = wizard.slice(wizard.indexOf('const endDrag = useCallback'), wizard.indexOf('const frameRef'));
    expect(fin).toContain('setDragGuides([]);');
    expect(fin).toContain('setDragBadges([]);');
  });

  it('le drapeau de capture les efface AUSSI — deux verrous, pas un', () => {
    // La photo des cartes part dans la vidéo : un guide gravé ne se
    // rattrape pas.
    expect(wizard).toContain('{!capturing && (guides.length > 0 || distanceBadges.length > 0) && (');
  });

  it('le calque n intercepte aucun geste', () => {
    const svg = readFileSync(resolve(__dirname, '../components/creer/SmartGuides.tsx'), 'utf-8');
    expect(svg).toContain('pointer-events-none');
    expect(svg).toContain('aria-hidden');
  });

  it('la grille de fond n est pas activée ici', () => {
    // Elle serait photographiée avec les cartes.
    expect(wizard).toContain('showGrid={false}');
  });
});

describe('Default-safe', () => {
  it('un aperçu monté nu ne rend aucun guide', () => {
    // C'est le cas des tests et de tout appelant qui ne les passe pas.
    expect(wizard).toContain('guides = EMPTY_GUIDES,');
    expect(wizard).toContain('distanceBadges = EMPTY_BADGES,');
  });

  it('les tableaux vides sont STABLES entre deux rendus', () => {
    // Un littéral par rendu relancerait le calque à chaque frame de
    // glissement, soit soixante fois par seconde.
    expect(wizard).toContain('const EMPTY_GUIDES: ActiveGuide[] = [];');
    expect(wizard).toContain('const EMPTY_BADGES: DistanceBadge[] = [];');
  });

  it('l union des clés s est ÉLARGIE, jamais restreinte', () => {
    // L'éditeur avancé lit le même module : lui retirer une clé le casserait.
    const src = readFileSync(resolve(__dirname, '../lib/creer/smartGuides.ts'), 'utf-8');
    for (const k of ['title', 'cards', 'watermark', 'overlay', 'logo', 'sitetext', 'character']) {
      expect(src.includes(`| '${k}'`), k).toBe(true);
    }
    expect(src).toContain("| 'cta'");
    expect(src).toContain("| 'element'");
  });
});
