import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import SmartGuides from '@/components/creer/SmartGuides';
import {
  computeGapBadges,
  computeAlignmentLines,
  mergeGuides,
  onePerAxis,
  sameGuides,
  sameBox,
  ALIGN_TOLERANCE_PX,
  type ElementBox,
  type GapBadge,
} from '@/lib/creer/smartGuides';

/**
 * La règle, façon Canva : magenta, épurée, en direct.
 *
 * L'étape précédente avait rendu la mesure lisible mais bavarde — sous chaque
 * chiffre, le nom des deux blocs (« APRÈS: PROTÉINES ↕ BANANE », « = Cadre »).
 * Quatre mesures autour d'un bloc, c'étaient quatre phrases posées sur
 * l'aperçu ; et le « = » d'un NOM se confondait avec le « = » d'une ÉGALITÉ.
 * Un instrument de mesure ne commente pas, il chiffre.
 */

const gap = (over: Partial<GapBadge> = {}): GapBadge => ({
  axis: 'y', side: 'top', midXPct: 50, midYPct: 20, gapPct: 40, gapPx: 768,
  target: 'frame', targetLabel: 'Cadre', equal: true, ...over,
});

const box = (key: string, left: number, top: number, right: number, bottom: number, label = key): ElementBox =>
  ({ key, label, left, top, right, bottom });

const MAGENTA_RGB = 'rgb(217, 28, 210)';

describe('Des badges magenta ÉPURÉS — le nombre, et rien d autre', () => {
  it('la pastille ne contient QUE le nombre', () => {
    const { container } = render(
      <SmartGuides format="9:16" gaps={[gap({ targetLabel: 'Banane', targetKey: 'b', target: 'element' })]} />,
    );
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(puce.textContent).toBe('768');
    expect(puce.textContent).not.toContain('Banane');
    // La cible reste disponible pour le diagnostic, jamais a l'ecran.
    expect(puce.getAttribute('data-guide-target')).toBe('b');
  });

  it('plus aucun libellé de noms n est rendu', () => {
    // ⚠️ LA RÉGRESSION À EMPÊCHER. C'est ce bloc qui encombrait l'aperçu.
    const { container } = render(
      <SmartGuides
        format="9:16"
        gaps={[
          gap({ targetLabel: 'Cadre' }),
          gap({ side: 'bottom', midYPct: 80, targetLabel: 'Banane', target: 'element', targetKey: 'b' }),
        ]}
      />,
    );
    expect(container.querySelector('[data-guide-pair]')).toBeNull();
    // Chaque pastille ne porte que des chiffres — aucune lettre, donc aucun
    // nom, quelle que soit la cible mesurée.
    for (const puce of Array.from(container.querySelectorAll('[data-guide-gap]'))) {
      expect(puce.textContent).toMatch(/^\d+$/);
    }
  });

  it('pastille magenta, texte blanc, ombre portée pour tenir sur fond clair', () => {
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(puce.style.background).toBe(MAGENTA_RGB);
    expect(puce.style.color).toBe('rgb(255, 255, 255)');
    expect(puce.style.boxShadow).toMatch(/rgba\(0, ?0, ?0/);
    // Arrondie, comme la pastille de Canva.
    expect(parseFloat(puce.style.borderRadius)).toBeGreaterThanOrEqual(8);
  });

  it('le trait de mesure est magenta, fin, et halé', () => {
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const traits = (Array.from(container.querySelectorAll('div')) as HTMLElement[])
      .filter((d) => d.style.borderLeft?.includes('1px') && d.style.borderLeft.includes(MAGENTA_RGB));
    expect(traits.length).toBeGreaterThan(0);
    expect(traits[0].style.boxShadow).toMatch(/rgba\(0, ?0, ?0/);
  });
});

describe('Le trait couvre EXACTEMENT le vide mesuré', () => {
  it('deux repères d extrémité se posent sur les bords mesurés', () => {
    // Le vide va de 0 % à 40 % : les ticks tombent exactement à ces deux
    // bords, donc on voit CE QUI est mesuré au lieu de le deviner.
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const ticks = (Array.from(container.querySelectorAll('div')) as HTMLElement[])
      .filter((d) => d.style.width === '8px' && d.style.borderTop.includes('1px'));
    expect(ticks).toHaveLength(2);
    expect(ticks.map((t) => t.style.top).sort()).toEqual(['0%', '40%']);
  });

  it('une pastille au ras du bord reste dans le cadre', () => {
    // Le calque est `overflow: hidden` : sans bornage, la moitié de la
    // pastille d'un écart minuscule serait rognée — donc illisible.
    const { container } = render(
      <SmartGuides format="9:16" gaps={[gap({ midYPct: 1, gapPct: 2 })]} />,
    );
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(parseFloat(puce.style.top)).toBeGreaterThanOrEqual(5);
  });
});

describe('Espacement ÉGAL — la signature Canva', () => {
  it('les deux côtés portent la MÊME valeur, et le disent', () => {
    const centre = box('a', 40, 45, 60, 55);
    const gaps = computeGapBadges(centre, [], '9:16');
    const haut = gaps.find((g) => g.side === 'top')!;
    const bas = gaps.find((g) => g.side === 'bottom')!;
    // C'est CELA que l'utilisateur lit : deux fois le même nombre.
    expect(haut.gapPx).toBe(bas.gapPx);
    expect(haut.equal && bas.equal).toBe(true);

    const { container } = render(<SmartGuides format="9:16" gaps={gaps} />);
    const puces = Array.from(container.querySelectorAll('[data-guide-gap]')) as HTMLElement[];
    const valeurs = puces
      .filter((p) => ['top', 'bottom'].includes(p.getAttribute('data-guide-gap')!))
      .map((p) => p.textContent);
    expect(valeurs[0]).toBe(valeurs[1]);
  });

  it('plus de signe « = » : il serait sur TOUS les badges, donc muet', () => {
    // Un badge n'existe désormais que dans une paire d'écarts égaux. Le signe
    // ne distinguerait plus rien ; ce qui parle, c'est le nombre répété.
    const { container } = render(
      <SmartGuides format="9:16" gaps={[gap(), gap({ side: 'bottom', midYPct: 80 })]} />,
    );
    expect(container.querySelector('[aria-label="même espace"]')).toBeNull();
    for (const p of Array.from(container.querySelectorAll('[data-guide-gap]'))) {
      expect(p.textContent).toMatch(/^\d+$/);
    }
  });
});

describe('Lignes d alignement — visibles le temps de la coïncidence', () => {
  const actif = box('a', 20, 10, 40, 20);

  it('bord contre bord d un voisin', () => {
    const voisin = box('b', 20, 60, 55, 70);
    const lignes = computeAlignmentLines(actif, [voisin], '9:16');
    expect(lignes.some((l) => l.axis === 'x' && l.source === 'element-edge' && l.pos === 20)).toBe(true);
  });

  it('centre contre centre d un voisin', () => {
    const voisin = box('b', 25, 60, 35, 70); // centre X = 30, comme l'actif
    const lignes = computeAlignmentLines(actif, [voisin], '9:16');
    expect(lignes.some((l) => l.axis === 'x' && l.source === 'element-center' && l.pos === 30)).toBe(true);
  });

  it('bord contre bord du CADRE, et centre contre milieu du format', () => {
    const auBord = box('a', 0, 40, 20, 60);
    const lignes = computeAlignmentLines(auBord, [], '9:16');
    expect(lignes.some((l) => l.axis === 'x' && l.source === 'frame-edge' && l.pos === 0)).toBe(true);
    expect(lignes.some((l) => l.axis === 'y' && l.source === 'preview-center' && l.pos === 50)).toBe(true);
  });

  it('rien ne s affiche quand rien ne coïncide', () => {
    const loin = box('b', 71, 61, 79, 69);
    expect(computeAlignmentLines(actif, [loin], '9:16')).toEqual([]);
  });

  it('la tolérance est en pixels du format, plus serrée que l aimantation', () => {
    // Une ligne d'alignement AFFIRME une coïncidence : l'afficher pour un
    // écart visible serait un mensonge découvert à l'export.
    expect(ALIGN_TOLERANCE_PX).toBeLessThan(6);
    const presque = box('b', 20.1, 60, 40, 70); // ~1 px de 1080
    expect(computeAlignmentLines(actif, [presque], '9:16').length).toBeGreaterThan(0);
    const trop = box('c', 22, 60, 40, 70); // ~21 px
    expect(computeAlignmentLines(box('a', 20, 10, 21, 20), [trop], '9:16')).toEqual([]);
  });

  it('aucune cible d aimantation n est ajoutée — le placement ne change pas', () => {
    // ⚠️ CE TEST GARDE UNE PROMESSE DE NON-RÉGRESSION. Les lignes de bords
    // sont VISUELLES ; les rendre magnétiques changerait la sensation du
    // déplacement, ce que ce lot ne doit pas toucher.
    const src = readFileSync(resolve(__dirname, '../lib/creer/smartGuides.ts'), 'utf-8');
    const debut = src.indexOf('export function snapPosition');
    const fin = src.indexOf('function equalGapCenters');
    expect(src.slice(debut, fin)).not.toContain('computeAlignmentLines');
  });

  it('les lignes superposées sont fusionnées, pas empilées', () => {
    // Aimanter sur un centre, c'est aussi s'y aligner : deux traits au même
    // endroit donneraient un trait deux fois plus opaque, donc une hiérarchie
    // visuelle fausse.
    const fusion = mergeGuides(
      [{ axis: 'x', pos: 50, source: 'preview-center' }],
      [{ axis: 'x', pos: 50, source: 'preview-center' }, { axis: 'y', pos: 25, source: 'element-edge' }],
    );
    expect(fusion).toHaveLength(2);
  });

  it('elles sont tracées en magenta', () => {
    const { container } = render(
      <SmartGuides format="9:16" guides={[{ axis: 'x', pos: 50, source: 'preview-center' }]} />,
    );
    const ligne = container.querySelector('[data-guide-line="preview-center"]') as HTMLElement;
    expect(ligne.style.borderLeft).toContain(MAGENTA_RGB);
  });
});

describe('Au plus UNE ligne par axe', () => {
  it('la cible aimantée l emporte sur les alignements simplement constatés', () => {
    // ⚠️ L'ORDRE PORTE LA PRIORITÉ. Les appelants passent d'abord la cible
    // réellement snappée : c'est elle qui doit rester quand plusieurs
    // coïncidences tombent sur le même axe.
    const retenu = onePerAxis(mergeGuides(
      [{ axis: 'x', pos: 50, source: 'preview-center' }],
      [{ axis: 'x', pos: 12, source: 'element-edge' }, { axis: 'x', pos: 30, source: 'element-edge' }],
    ));
    expect(retenu).toHaveLength(1);
    expect(retenu[0]).toMatchObject({ pos: 50, source: 'preview-center' });
  });

  it('un trait par voisin, c est un aperçu barré de traits', () => {
    // Cinq blocs alignés déclenchaient cinq coïncidences simultanées.
    const cinq = Array.from({ length: 5 }, (_, i) => ({
      axis: 'y' as const, pos: 10 + i, source: 'element-edge' as const,
    }));
    expect(onePerAxis(cinq)).toHaveLength(1);
  });

  it('les deux axes restent possibles en même temps', () => {
    const retenu = onePerAxis([
      { axis: 'x', pos: 50, source: 'preview-center' },
      { axis: 'y', pos: 25, source: 'frame-edge' },
      { axis: 'y', pos: 80, source: 'element-edge' },
    ]);
    expect(retenu.map((g) => g.axis)).toEqual(['x', 'y']);
    expect(retenu[1].pos).toBe(25);
  });

  it('les deux éditeurs appliquent la coupe', () => {
    for (const [nom, src] of [
      ['avancé', readFileSync(resolve(__dirname, '../app/dashboard/creer/page.tsx'), 'utf-8')],
      ['simple', readFileSync(resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'), 'utf-8')],
    ] as const) {
      expect(src.includes('onePerAxis(mergeGuides('), nom).toBe(true);
      expect(src.includes('onePerAxis(computeAlignmentLines('), nom).toBe(true);
    }
  });
});

describe('Cadre de sélection magenta', () => {
  it('le bloc actif est entouré, avec ses quatre coins', () => {
    const { container } = render(
      <SmartGuides format="9:16" selection={{ left: 10, top: 20, right: 40, bottom: 30 }} />,
    );
    const cadre = container.querySelector('[data-guide-selection]') as HTMLElement;
    expect(cadre.style.left).toBe('10%');
    expect(cadre.style.width).toBe('30%');
    expect(cadre.style.height).toBe('10%');
    expect(cadre.style.border).toContain(MAGENTA_RGB);
    expect(container.querySelectorAll('[data-guide-corner]')).toHaveLength(4);
  });

  it('rien de sélectionné, aucun cadre', () => {
    const { container } = render(<SmartGuides format="9:16" />);
    expect(container.querySelector('[data-guide-selection]')).toBeNull();
  });

  it('deux emprises identiques sont reconnues — sinon le rendu boucle', () => {
    const a = box('k', 1, 2, 3, 4);
    expect(sameBox(a, { ...a })).toBe(true);
    expect(sameBox(a, { ...a, left: 9 })).toBe(false);
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(a, null)).toBe(false);
    expect(sameGuides([{ axis: 'x', pos: 1, source: 'frame-edge' }], [{ axis: 'x', pos: 1, source: 'frame-edge' }])).toBe(true);
    expect(sameGuides([], [{ axis: 'x', pos: 1, source: 'frame-edge' }])).toBe(false);
  });
});

describe('Le milieu du format, visible pendant la manipulation', () => {
  it('à égale distance des deux bords, la ligne de centre devient pleine et magenta', () => {
    const centre = box('a', 45, 45, 55, 55);
    const gaps = computeGapBadges(centre, [], '9:16');
    const { container } = render(<SmartGuides format="9:16" showCenter gaps={gaps} />);
    const x = container.querySelector('[data-guide-center-x]') as HTMLElement;
    const y = container.querySelector('[data-guide-center-y]') as HTMLElement;
    expect(x.getAttribute('data-guide-centered')).toBe('true');
    expect(y.getAttribute('data-guide-centered')).toBe('true');
    expect(x.style.borderLeft).toContain(MAGENTA_RGB);
  });

  it('une symétrie entre deux VOISINS n est pas un centrage dans le format', () => {
    // ⚠️ LA DISTINCTION QUI COMPTE. Être à égale distance de deux blocs ne
    // veut pas dire être au milieu du cadre : seule l'égalité mesurée contre
    // le CADRE le prouve.
    const { container } = render(
      <SmartGuides
        format="9:16"
        showCenter
        gaps={[
          gap({ side: 'top', target: 'element', targetKey: 'x', equal: true }),
          gap({ side: 'bottom', target: 'element', targetKey: 'y', equal: true }),
        ]}
      />,
    );
    expect((container.querySelector('[data-guide-center-y]') as HTMLElement)
      .getAttribute('data-guide-centered')).toBe('false');
  });

  it('sans mesure, le repère de centre reste au choix de l utilisateur', () => {
    const { container } = render(<SmartGuides format="9:16" />);
    expect(container.querySelector('[data-guide-center-x]')).toBeNull();
  });
});

describe('Le câblage des deux éditeurs', () => {
  const avance = readFileSync(resolve(__dirname, '../app/dashboard/creer/page.tsx'), 'utf-8');
  const simple = readFileSync(
    resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
    'utf-8',
  );

  it('les mesures sont recalculées EN DIRECT pendant le glissement', () => {
    // Le gestionnaire de déplacement mesure la boîte APRÈS aimantation : le
    // DOM a un rendu de retard, mesurer ce qu'il affiche donnerait le chiffre
    // de la frame précédente.
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('const boiteActive = rend'), nom).toBe(true);
      expect(src.includes('computeGapBadges(boiteActive'), nom).toBe(true);
    }
  });

  it('et restent affichées à la sélection, sans glissement', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('sameGaps('), nom).toBe(true);
      expect(src.includes("closest('[data-guide-key]')"), nom).toBe(true);
    }
  });

  it('les deux éditeurs tracent les lignes d alignement et le cadre de sélection', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes('computeAlignmentLines('), nom).toBe(true);
      expect(src.includes('mergeGuides('), nom).toBe(true);
      expect(src.includes('selection={'), nom).toBe(true);
    }
  });

  it('les deux montrent le milieu dès qu un bloc est mesuré', () => {
    expect(avance).toContain('showCenter={showCenterGuides || activeGaps.length > 0}');
    expect(simple).toContain('showCenter={reperesCentre || gaps.length > 0}');
  });
});
