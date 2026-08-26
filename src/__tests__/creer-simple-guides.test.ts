import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  snapPosition,
  computeGapBadges,
  anchorToCenter,
  centerToAnchor,
  pctToFormatPx,
  SNAP_THRESHOLD_PERCENT,
  type ElementPos,
  type ElementBox,
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
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
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
  // ⚠️ CE SONT DES BORDS, PAS DES CENTRES. Un actif de 20 % × 20 %, centré.
  const actif: ElementBox = { key: 'element', label: 'En cours', left: 40, top: 40, right: 60, bottom: 60 };
  const voisin = (left: number, top: number, right: number, bottom: number): ElementBox =>
    ({ key: 'element', label: 'Autre', left, top, right, bottom });

  it('rien tant que les écarts ne sont pas égaux — quatre badges quand ils le sont', () => {
    // L'actif est centré dans le cadre : les deux axes s'affichent.
    expect(computeGapBadges(actif, [], '9:16')).toHaveLength(4);
    // Un voisin au-dessus casse l'égalité verticale : cet axe s'éteint.
    expect(computeGapBadges(actif, [voisin(40, 10, 60, 30)], '9:16')
      .every((g) => g.axis === 'x')).toBe(true);
  });

  it('l écart est le VIDE entre les deux bords, pas la distance des centres', () => {
    // Actif 40→90, voisin au-dessus finissant à 30 : 10 % de vide en haut,
    // 10 % jusqu'au bas du cadre — donc égalité, donc affichage.
    const grand = { key: 'element' as const, label: 'En cours', left: 40, top: 40, right: 60, bottom: 90 };
    const b = computeGapBadges(grand, [voisin(40, 10, 60, 30)], '9:16');
    const haut = b.find((g) => g.side === 'top')!;
    // Bords : 40 − 30 = 10 %. Centres : 65 − 20 = 45 %, plus de quatre fois plus.
    expect(haut.gapPct).toBeCloseTo(10);
  });

  it('la distance est convertie en pixels du FORMAT, pas de l écran', () => {
    const b = computeGapBadges(actif, [], '9:16');
    // 40 % de 1920 px de haut = 768 px.
    expect(b.find((g) => g.side === 'top')!.gapPx).toBe(pctToFormatPx(40, 'y', '9:16'));
    expect(b.find((g) => g.side === 'top')!.gapPx).toBe(768);
  });

  it('les deux axes n ont pas le même diviseur', () => {
    const b = computeGapBadges(actif, [], '9:16');
    expect(b.find((g) => g.side === 'top')!.gapPx).not.toBe(b.find((g) => g.side === 'left')!.gapPx);
  });

  it('des écarts ÉGAUX sont signalés — c est tout l intérêt', () => {
    const b = computeGapBadges(actif, [voisin(40, 20, 60, 30), voisin(40, 70, 60, 80)], '9:16');
    const haut = b.find((g) => g.side === 'top')!;
    const bas = b.find((g) => g.side === 'bottom')!;
    expect(haut.gapPx).toBe(bas.gapPx);
    expect(haut.equal).toBe(true);
    expect(bas.equal).toBe(true);
  });

  it('sans voisin, la mesure va au cadre — jamais rien du tout', () => {
    const b = computeGapBadges(actif, [], '9:16');
    expect(b.every((g) => g.target === 'frame')).toBe(true);
  });
});

describe('Le câblage dans le Mode simple', () => {
  it('l aimantation passe par le CENTRE, pas par l ancre', () => {
    expect(wizard).toContain('const centre = anchorToCenter(pos, anchor, box);');
    expect(wizard).toContain("return centerToAnchor({ x: snap.x, y: snap.y }, anchor, box);");
  });

  it('le titre et le CTA gardent CHACUN leur ancre', () => {
    expect(wizard).toContain("const ancre: Anchor = drag.el === 'title' ? 'top-left' : 'bottom-center';");
    expect(wizard).toContain('snapAndGuide(raw, ancre, drag.box, drag.el)');
  });

  it('un élément s aimante sur son centre', () => {
    expect(wizard).toContain("snapAndGuide(raw, 'center', drag.box, id, `element:${id}`)");
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
  it('les LIGNES disparaissent au relâchement — les ÉCARTS, non', () => {
    // ⚠️ L'ANCRE EST CELLE DU WIZARD, PAS LA PREMIÈRE DU FICHIER. Un autre
    // composant déclare un `endDrag` plus haut : chercher le motif court
    // découpait SA tranche à lui, et le test répondait sur le mauvais code.
    const debut = wizard.indexOf('const endDrag = useCallback(() => {\n    dragRef.current = null;');
    expect(debut).toBeGreaterThan(0);
    const corps = wizard.slice(debut, wizard.indexOf('}, []);', debut));
    expect(corps.length).toBeGreaterThan(0);
    expect(corps).toContain('setDragGuides([]);');
    // Les lignes magnétiques disent « ça s'aligne EN CE MOMENT » : elles
    // meurent avec le geste. Les écarts répondent à « quelle distance entre
    // ces deux blocs », question qui lui survit — les effacer ici est
    // exactement ce qui rendait la mesure illisible dès le bloc posé.
    expect(corps).not.toContain('setDragGaps([]);');
  });

  it('le drapeau de capture les efface AUSSI — deux verrous, pas un', () => {
    // La photo des cartes part dans la vidéo : un guide gravé ne se
    // rattrape pas.
    expect(wizard).toContain('{!capturing && (\n        <SmartGuides');
  });

  it('le calque vit HORS du plateau photographié', () => {
    // ⚠️ C'EST LA GARANTIE STRUCTURELLE. Le plateau (`previewRef`) est ce que
    // `modern-screenshot` photographie : un repère posé dedans finirait
    // gravé dans le montage, quel que soit l'état des drapeaux.
    const plateau = wizard.indexOf('ref={previewRef}');
    const calque = wizard.indexOf('<SmartGuides', plateau);
    const finPlateau = wizard.indexOf('data-preview-overlay', plateau);
    expect(finPlateau).toBeGreaterThan(0);
    expect(calque).toBeGreaterThan(finPlateau);
  });

  it('le calque n intercepte aucun geste', () => {
    const calque = readFileSync(resolve(__dirname, '../components/creer/SmartGuides.tsx'), 'utf-8');
    expect(calque).toContain('pointer-events-none');
    expect(calque).toContain('aria-hidden');
  });
});

describe('Default-safe', () => {
  it('un aperçu monté nu ne rend aucun guide', () => {
    // C'est le cas des tests et de tout appelant qui ne les passe pas.
    expect(wizard).toContain('guides = EMPTY_GUIDES,');
    expect(wizard).toContain('gaps = EMPTY_GAPS,');
  });

  it('les tableaux vides sont STABLES entre deux rendus', () => {
    // Un littéral par rendu relancerait le calque à chaque frame de
    // glissement, soit soixante fois par seconde.
    expect(wizard).toContain('const EMPTY_GUIDES: ActiveGuide[] = [];');
    expect(wizard).toContain('const EMPTY_GAPS: GapBadge[] = [];');
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
