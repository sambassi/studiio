import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  computeGapBadges,
  collectGuideBoxes,
  boxDistancePx,
  sameGaps,
  pctToFormatPx,
  type ElementBox,
  type GapBadge,
} from '@/lib/creer/smartGuides';

/**
 * La règle ne mesurait pas ENTRE DEUX ÉLÉMENTS. Trois causes, aucune dans le
 * moteur de calcul — qui, lui, était juste depuis la #334.
 *
 * 1. Seuls sept blocs portaient `data-guide-key`. Les autres — icône du
 *    titre, second titre, second sous-titre, calques de texte, cartes prises
 *    une à une, éléments libres — étaient INVISIBLES à `collectGuideBoxes`.
 * 2. Les écarts n'étaient calculés que dans le gestionnaire de glissement :
 *    au relâchement ils disparaissaient, donc lire la distance entre deux
 *    blocs déjà posés était impossible.
 * 3. Un voisin n'était mesuré que s'il se faisait FACE. Deux textes décalés
 *    ne produisaient donc aucun chiffre — le symptôme exact rapporté.
 */

const box = (
  key: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
  label = key,
): ElementBox => ({ key, label, left, top, right, bottom });

/** Élément de DOM mesurable, avec un rectangle imposé. */
const noeud = (rect: { left: number; top: number; width: number; height: number }, attrs: Record<string, string> = {}) => {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => rect as DOMRect;
  return el;
};

const cadre = (...enfants: HTMLElement[]) => {
  const f = document.createElement('div');
  f.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  f.append(...enfants);
  return f;
};

describe('Cause 3 — deux éléments NON alignés donnent quand même un chiffre', () => {
  // Deux blocs en biais : aucun ne se fait face, ni horizontalement ni
  // verticalement. C'est le cas « deux titres décalés ».
  const actif = box('actif', 10, 10, 30, 20);
  const enBiais = box('autre', 60, 50, 80, 60, 'Titre 2');

  it('avant, aucun badge ne le mesurait — désormais si', () => {
    const gaps = computeGapBadges(actif, [enBiais], '9:16');
    const vers = gaps.filter((g) => g.targetKey === 'autre');
    expect(vers.length).toBeGreaterThan(0);
    for (const g of vers) expect(g.gapPx).toBeGreaterThan(0);
  });

  it('deux chiffres, un par axe — jamais une diagonale qui mélange les unités', () => {
    const vers = computeGapBadges(actif, [enBiais], '9:16').filter((g) => g.targetKey === 'autre');
    expect(vers.map((g) => g.axis).sort()).toEqual(['x', 'y']);
    // Horizontal : 60 − 30 = 30 % de 1080 px. Vertical : 50 − 20 = 30 % de
    // 1920 px. Le MÊME écart en % donne deux chiffres différents — c'est
    // précisément pourquoi une longueur diagonale unique n'aurait aucun sens.
    expect(vers.find((g) => g.axis === 'x')!.gapPx).toBe(pctToFormatPx(30, 'x', '9:16'));
    expect(vers.find((g) => g.axis === 'y')!.gapPx).toBe(pctToFormatPx(30, 'y', '9:16'));
  });

  it('ces mesures-là sont marquées NON alignées — le calque les trace autrement', () => {
    const vers = computeGapBadges(actif, [enBiais], '9:16').filter((g) => g.targetKey === 'autre');
    for (const g of vers) expect(g.aligned).toBe(false);
    // Les quatre côtés, eux, restent des mesures franches.
    const cotes = computeGapBadges(actif, [enBiais], '9:16').filter((g) => g.target === 'frame');
    for (const g of cotes) expect(g.aligned).toBe(true);
  });

  it('un axe qui se recouvre ne produit rien à mesurer sur cet axe', () => {
    // Même bande horizontale : il n'y a de vide qu'à la verticale.
    const dessous = box('autre', 10, 60, 30, 70);
    const vers = computeGapBadges(actif, [dessous], '9:16').filter((g) => g.targetKey === 'autre');
    expect(vers.map((g) => g.axis)).toEqual(['y']);
    // Et comme ils se font face, la mesure passe par les quatre côtés : elle
    // est franche, pas « en biais ».
    expect(vers[0].aligned).toBe(true);
  });

  it('les quatre côtés ne perdent PAS le bord du cadre au profit d un voisin lointain', () => {
    // Régression à éviter : mesurer le voisin en biais ne doit pas remplacer
    // la marge au cadre, qui est ce qui permet de juger un centrage.
    const gaps = computeGapBadges(actif, [enBiais], '9:16');
    expect(gaps.filter((g) => g.target === 'frame')).toHaveLength(4);
  });

  it('le voisin retenu est le plus proche, distance bord-à-bord', () => {
    const proche = box('proche', 40, 12, 50, 18, 'Proche');
    const loin = box('loin', 90, 90, 95, 95, 'Loin');
    expect(boxDistancePx(actif, proche, '9:16')).toBeLessThan(boxDistancePx(actif, loin, '9:16'));
    const gaps = computeGapBadges(actif, [proche, loin], '9:16');
    expect(gaps.some((g) => g.targetKey === 'proche')).toBe(true);
    expect(gaps.some((g) => g.targetKey === 'loin')).toBe(false);
  });

  it('au survol, c est l utilisateur qui choisit la paire', () => {
    const proche = box('proche', 40, 12, 50, 18, 'Proche');
    const loin = box('loin', 90, 90, 95, 95, 'Loin');
    const gaps = computeGapBadges(actif, [proche, loin], '9:16', { pairWith: 'loin' });
    expect(gaps.some((g) => g.targetKey === 'loin')).toBe(true);
  });

  it('un voisin déjà mesuré par un des quatre côtés n est pas mesuré deux fois', () => {
    const dessous = box('autre', 10, 60, 30, 70);
    const gaps = computeGapBadges(actif, [dessous], '9:16');
    expect(gaps.filter((g) => g.targetKey === 'autre')).toHaveLength(1);
  });

  it('sans aucun voisin, on garde exactement les quatre côtés', () => {
    expect(computeGapBadges(actif, [], '9:16')).toHaveLength(4);
  });
});

describe('Cause 1 — chaque bloc déplaçable est mesurable, et une seule fois', () => {
  it('collectGuideBoxes rend une boîte par bloc marqué', () => {
    const f = cadre(
      noeud({ left: 10, top: 10, width: 20, height: 5 }, { 'data-guide-key': 'title', 'data-guide-label': 'Titre' }),
      noeud({ left: 10, top: 30, width: 20, height: 5 }, { 'data-guide-key': 'extraTitle', 'data-guide-label': 'Titre 2' }),
      noeud({ left: 10, top: 50, width: 20, height: 5 }, { 'data-guide-key': 'overlay:0', 'data-guide-label': 'Texte 2' }),
      noeud({ left: 10, top: 70, width: 20, height: 5 }, { 'data-guide-key': 'element:el-7', 'data-guide-label': 'Élément' }),
    );
    expect(collectGuideBoxes(f).map((b) => b.key)).toEqual([
      'title', 'extraTitle', 'overlay:0', 'element:el-7',
    ]);
  });

  it('deux instances du même type gardent des clés DISTINCTES', () => {
    // ⚠️ C'EST LA CONDITION POUR MESURER « ENTRE DEUX TEXTES ». Deux blocs
    // qui partageraient une clé se confondraient : `find` rendrait toujours
    // le premier, et le second ne serait jamais ni mesuré ni exclu.
    const f = cadre(
      noeud({ left: 0, top: 0, width: 10, height: 10 }, { 'data-guide-key': 'card:a' }),
      noeud({ left: 0, top: 20, width: 10, height: 10 }, { 'data-guide-key': 'card:b' }),
      noeud({ left: 0, top: 40, width: 10, height: 10 }, { 'data-guide-key': 'element:x' }),
      noeud({ left: 0, top: 60, width: 10, height: 10 }, { 'data-guide-key': 'element:y' }),
    );
    const cles = collectGuideBoxes(f).map((b) => b.key);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('et l on mesure bien de l une à l autre', () => {
    const f = cadre(
      noeud({ left: 0, top: 0, width: 10, height: 10 }, { 'data-guide-key': 'card:a', 'data-guide-label': 'A' }),
      noeud({ left: 0, top: 30, width: 10, height: 10 }, { 'data-guide-key': 'card:b', 'data-guide-label': 'B' }),
    );
    const boxes = collectGuideBoxes(f);
    const a = boxes.find((b) => b.key === 'card:a')!;
    const gaps = computeGapBadges(a, boxes.filter((b) => b.key !== 'card:a'), '9:16');
    const versB = gaps.find((g) => g.targetKey === 'card:b')!;
    expect(versB.gapPct).toBeCloseTo(20); // 30 − 10
    expect(versB.gapPx).toBe(pctToFormatPx(20, 'y', '9:16'));
  });
});

describe('Cause 2 — la comparaison qui rend la mesure persistante possible', () => {
  const g = (over: Partial<GapBadge> = {}): GapBadge => ({
    axis: 'y', side: 'top', midXPct: 50, midYPct: 20, gapPct: 40, gapPx: 768,
    target: 'frame', targetLabel: 'Cadre', sourceLabel: 'Actif', equal: false, aligned: true, ...over,
  });

  it('deux séries identiques sont reconnues — sinon la boucle de rendu ne s arrête jamais', () => {
    expect(sameGaps([g()], [g()])).toBe(true);
    expect(sameGaps([], [])).toBe(true);
  });

  it('le moindre changement utile est vu', () => {
    expect(sameGaps([g()], [g({ gapPx: 769 })])).toBe(false);
    expect(sameGaps([g()], [g({ equal: true })])).toBe(false);
    expect(sameGaps([g()], [g({ aligned: false })])).toBe(false);
    expect(sameGaps([g()], [g({ targetKey: 'x' })])).toBe(false);
    expect(sameGaps([g()], [g({ midYPct: 21 })])).toBe(false);
    expect(sameGaps([g()], [])).toBe(false);
  });
});

describe('Le câblage des deux éditeurs', () => {
  const avance = readFileSync(resolve(__dirname, '../app/dashboard/creer/page.tsx'), 'utf-8');
  const simple = readFileSync(
    resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
    'utf-8',
  );
  const cartes = readFileSync(resolve(__dirname, '../components/creer/SequenceCards.tsx'), 'utf-8');
  const elements = readFileSync(resolve(__dirname, '../components/creer/FreeElementsLayer.tsx'), 'utf-8');

  it('l éditeur avancé marque TOUS ses blocs déplaçables', () => {
    // La liste est celle des `setDragging(...)` du fichier : chaque bloc qui
    // se déplace doit se mesurer, sinon la règle reste aveugle.
    for (const cle of [
      'title', 'cards', 'watermark', 'overlay', 'logo', 'sitetext',
      'titleIcon', 'extraTitle', 'extraSubtitle',
    ]) {
      expect(avance.includes(`data-guide-key="${cle}"`), cle).toBe(true);
    }
    // Instances multiples — clé portant l'index.
    expect(avance).toContain('data-guide-key={`overlay:${i}`}');
    expect(avance).toContain('data-guide-key={`card:${i}`}');
  });

  it('aucun bloc déplaçable de l éditeur avancé n est laissé sans clé', () => {
    // Garde-fou contre l'oubli : tout `setDragging("x")` doit avoir sa clé.
    // Les deux styles de guillemets : `setDragging('titleIcon')` est écrit en
    // simples, et c'est justement un de ceux qui manquaient.
    const cles = Array.from(avance.matchAll(/setDragging\(['"]([a-zA-Z]+)['"]\)/g)).map((m) => m[1]);
    expect(cles).toContain('titleIcon');
    expect(new Set(cles).size).toBeGreaterThan(7);
    for (const cle of new Set(cles)) {
      expect(avance.includes(`data-guide-key="${cle}"`), cle).toBe(true);
    }
  });

  it('les blocs secondaires sont aussi des cibles d aimantation', () => {
    // Marqués mais absents de `allPositions`, ils seraient mesurables sans
    // être aimantables — deux comportements pour un même bloc.
    expect(avance).toContain("key: 'titleIcon'");
    expect(avance).toContain("key: 'extraTitle' as const");
    expect(avance).toContain("key: 'extraSubtitle' as const");
    expect(avance).toContain('key: `overlay:${i}` as const');
  });

  it('le Mode simple marque titre, CTA, chaque carte et chaque élément', () => {
    expect(simple).toContain('data-guide-key="title"');
    expect(simple).toContain('data-guide-key="cta"');
    expect(cartes).toContain("'data-guide-key': `card:${c.id}`");
    expect(elements).toContain("'data-guide-key': `element:${el.id}`");
  });

  it('les cartes ne sont plus mesurées en bloc — chacune l est', () => {
    // Mesurer la bande entière ne répondait pas à « quel écart jusqu'à LA
    // carte la plus proche », ni à « quel écart d'une carte à sa voisine ».
    expect(cartes).not.toContain("'data-guide-key': 'cards'");
    expect(cartes).not.toContain("'data-guide-union'");
  });

  it('les attributs restent absents du rendu serveur', () => {
    // Remotion doit produire exactement le même DOM qu'avant.
    for (const src of [cartes, elements]) {
      expect(src).toContain('...(editable');
    }
  });

  it('les deux éditeurs mesurent le bloc SÉLECTIONNÉ, pas seulement le bloc glissé', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('measuredKey'), nom).toBe(true);
      expect(src.includes('sameGaps('), nom).toBe(true);
      // La clé est lue dans le DOM : elle vaut donc pour TOUT bloc marqué, y
      // compris ceux qu'aucun état de sélection ne connaît.
      expect(src.includes("closest('[data-guide-key]')"), nom).toBe(true);
    }
  });

  it('les deux éditeurs savent mesurer la paire survolée', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('hoveredKey'), nom).toBe(true);
      expect(
        src.includes('pairWith: hoveredKey && hoveredKey !== measuredKey ? hoveredKey : null'),
        nom,
      ).toBe(true);
    }
  });
});
