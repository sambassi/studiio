import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  computeGapBadges,
  collectGuideBoxes,
  sameGaps,
  pctToFormatPx,
  EQUAL_GAP_TOLERANCE_PX,
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

describe('Rien ne s affiche tant que les écarts ne sont pas ÉGAUX', () => {
  // ⚠️ RENVERSEMENT ASSUMÉ. Une étape précédente affichait un chiffre vers le
  // voisin le plus proche « quoi qu'il arrive ». À l'usage, c'était le nuage :
  // « 157 » au-dessus de « 109 », quatre nombres qui ne répondent à aucune
  // question. L'utilisateur ne cherche pas à LIRE des distances, il cherche à
  // les ÉGALISER — et deux nombres identiques sont la seule réponse utile.
  const actif = box('actif', 10, 10, 30, 20);

  it('un bloc posé de travers ne montre rien', () => {
    const enBiais = box('autre', 60, 50, 80, 60, 'Titre 2');
    expect(computeGapBadges(actif, [enBiais], '9:16')).toEqual([]);
  });

  it('un écart non égal n est JAMAIS affiché seul', () => {
    // Écart haut = 10 %, écart bas = 80 % : rien à égaliser, rien à l'écran.
    expect(computeGapBadges(box('a', 10, 10, 30, 20), [], '9:16')
      .filter((g) => g.axis === 'y')).toEqual([]);
  });

  it('centré sur un axe, la paire apparaît — et porte deux fois le même nombre', () => {
    const centreY = box('a', 10, 45, 30, 55);
    const gaps = computeGapBadges(centreY, [], '9:16');
    expect(gaps.map((g) => g.side).sort()).toEqual(['bottom', 'top']);
    expect(gaps[0].gapPx).toBe(gaps[1].gapPx);
  });

  it('les deux axes sont indépendants', () => {
    const centreLesDeux = box('a', 45, 45, 55, 55);
    expect(computeGapBadges(centreLesDeux, [], '9:16')).toHaveLength(4);
  });

  it('à égale distance de deux VOISINS aussi, pas seulement des bords', () => {
    // C'est la recette : une carte glissée entre deux autres.
    const carte = box('c', 10, 45, 30, 55, 'Carte');
    const haut = box('h', 10, 20, 30, 35, 'Haut');
    const bas = box('b', 10, 65, 30, 80, 'Bas');
    const gaps = computeGapBadges(carte, [haut, bas], '9:16');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].gapPx).toBe(gaps[1].gapPx);
    expect(gaps.map((g) => g.targetKey).sort()).toEqual(['b', 'h']);
  });

  it('un cran plus haut, tout disparaît', () => {
    const decalee = box('c', 10, 40, 30, 50, 'Carte');
    const haut = box('h', 10, 20, 30, 35, 'Haut');
    const bas = box('b', 10, 65, 30, 80, 'Bas');
    expect(computeGapBadges(decalee, [haut, bas], '9:16')).toEqual([]);
  });

  it('la tolérance laisse une marge atteignable à la souris', () => {
    // Sans tolérance, l'égalité serait un point unique — donc inatteignable.
    expect(EQUAL_GAP_TOLERANCE_PX).toBeGreaterThan(0);
    const presque = box('a', 10, 45, 30, 54.8, 'Presque');
    expect(computeGapBadges(presque, [], '9:16').length).toBe(2);
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

  it('et l on mesure bien de l une à l autre, dès qu il y a égalité', () => {
    // Carte du milieu à 45→55 : 10 % de vide au-dessus comme au-dessous.
    const f = cadre(
      noeud({ left: 0, top: 25, width: 10, height: 10 }, { 'data-guide-key': 'card:a', 'data-guide-label': 'A' }),
      noeud({ left: 0, top: 45, width: 10, height: 10 }, { 'data-guide-key': 'card:b', 'data-guide-label': 'B' }),
      noeud({ left: 0, top: 65, width: 10, height: 10 }, { 'data-guide-key': 'card:c', 'data-guide-label': 'C' }),
    );
    const boxes = collectGuideBoxes(f);
    const b = boxes.find((x) => x.key === 'card:b')!;
    const gaps = computeGapBadges(b, boxes.filter((x) => x.key !== 'card:b'), '9:16');
    expect(gaps.map((g) => g.targetKey).sort()).toEqual(['card:a', 'card:c']);
    expect(gaps[0].gapPct).toBeCloseTo(10);
    expect(gaps[0].gapPx).toBe(pctToFormatPx(10, 'y', '9:16'));
    expect(gaps[0].gapPx).toBe(gaps[1].gapPx);
  });
});

describe('Cause 2 — la comparaison qui rend la mesure persistante possible', () => {
  const g = (over: Partial<GapBadge> = {}): GapBadge => ({
    axis: 'y', side: 'top', midXPct: 50, midYPct: 20, gapPct: 40, gapPx: 768,
    target: 'frame', targetLabel: 'Cadre', equal: true, ...over,
  });

  it('deux séries identiques sont reconnues — sinon la boucle de rendu ne s arrête jamais', () => {
    expect(sameGaps([g()], [g()])).toBe(true);
    expect(sameGaps([], [])).toBe(true);
  });

  it('le moindre changement utile est vu', () => {
    expect(sameGaps([g()], [g({ gapPx: 769 })])).toBe(false);
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

  it('la mesure « au survol » a été retirée avec le reste du nuage', () => {
    // Elle affichait un écart NON égal vers le bloc survolé : le même bruit,
    // déclenché au passage de la souris. La règle ne montre plus qu'une
    // égalité, il n'y avait plus rien à désigner.
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('hoveredKey'), nom).toBe(false);
      expect(src.includes('pairWith'), nom).toBe(false);
    }
  });
});
