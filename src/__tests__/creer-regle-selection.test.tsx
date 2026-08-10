import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import SmartGuides from '@/components/creer/SmartGuides';
import { computeGapBadges, type ElementBox, type GapBadge } from '@/lib/creer/smartGuides';

/**
 * La règle se lit À LA SÉLECTION, et elle se LIT.
 *
 * Le calcul était juste depuis la #335 et se déclenchait déjà au clic. Ce qui
 * manquait tenait à l'affichage :
 *
 *   - la pastille avait un texte QUASI-NOIR (`#0A0A0F`) sur fond magenta :
 *     sur un aperçu coloré, « 64 px » se lisait comme une tache, au point que
 *     l'utilisateur concluait que la mesure n'existait pas ;
 *   - rien ne disait CE QU'ELLE RELIAIT : un chiffre flottant se lit comme
 *     une étiquette collée au bloc, pas comme le vide entre deux blocs ;
 *   - le repère du vrai milieu du format dépendait d'un réglage à cocher
 *     À L'AVANCE, donc absent au seul moment où il sert ;
 *   - et les écarts étaient vidés au relâchement, dans l'éditeur avancé.
 */

const gap = (over: Partial<GapBadge> = {}): GapBadge => ({
  axis: 'y', side: 'top', midXPct: 50, midYPct: 20, gapPct: 40, gapPx: 768,
  target: 'frame', targetLabel: 'Cadre', sourceLabel: 'Titre',
  equal: false, aligned: true, ...over,
});

const box = (key: string, left: number, top: number, right: number, bottom: number, label = key): ElementBox =>
  ({ key, label, left, top, right, bottom });

describe('La règle est BLANCHE et lisible', () => {
  it('le chiffre est blanc sur fond sombre — plus jamais un texte quasi-noir', () => {
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(puce.style.color).toBe('rgb(255, 255, 255)');
    // Le fond doit être sombre ET semi-opaque : c'est ce qui garantit le
    // contraste aussi bien sur une photo claire que sur un dégradé foncé.
    expect(puce.style.background).toMatch(/rgba\(10, 10, 15/);
  });

  it('le trait de mesure est blanc, épais et halé — lisible sur tout fond', () => {
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const traits = Array.from(container.querySelectorAll('div')).filter(
      (d) => (d as HTMLElement).style.borderLeft?.includes('2px'),
    ) as HTMLElement[];
    expect(traits.length).toBeGreaterThan(0);
    expect(traits[0].style.borderLeft).toContain('rgb(255, 255, 255)');
    // Le halo sombre : sans lui, un trait blanc disparaît sur un fond clair.
    expect(traits[0].style.boxShadow).toMatch(/rgba\(0, ?0, ?0/);
  });

  it('aucune couleur ne porte seule l information — le « = » double le vert', () => {
    const { container } = render(<SmartGuides format="9:16" gaps={[gap({ equal: true })]} />);
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(puce.querySelector('[aria-label="même espace"]')).not.toBeNull();
    expect(puce.style.color).toBe('rgb(255, 255, 255)');
  });
});

describe('Un pied à coulisse, pas une étiquette flottante', () => {
  it('deux repères d extrémité se posent sur les bords mesurés', () => {
    // ⚠️ C'EST CE QUI LÈVE L'AMBIGUÏTÉ. Le vide mesuré va de 0 % à 40 % : les
    // ticks tombent exactement à ces deux bords, donc on voit CE QUI est
    // mesuré, au lieu de deviner à quel bloc l'étiquette appartient.
    const { container } = render(<SmartGuides format="9:16" gaps={[gap()]} />);
    const ticks = (Array.from(container.querySelectorAll('div')) as HTMLElement[])
      .filter((d) => d.style.width === '9px' && d.style.borderTop.includes('2px'));
    expect(ticks).toHaveLength(2);
    expect(ticks.map((t) => t.style.top).sort()).toEqual(['0%', '40%']);
  });

  it('la pastille nomme les DEUX extrémités', () => {
    const { container } = render(
      <SmartGuides format="9:16" gaps={[gap({ sourceLabel: 'Hydrate-toi', targetLabel: 'Banane' })]} />,
    );
    const paire = container.querySelector('[data-guide-pair]') as HTMLElement;
    expect(paire.textContent).toContain('Hydrate-toi');
    expect(paire.textContent).toContain('Banane');
    // Le sens de la mesure est porté par une icône lucide, jamais un emoji.
    expect(paire.querySelector('svg')).not.toBeNull();
  });

  it('le moteur transmet le nom du bloc mesuré', () => {
    // Sans `sourceLabel`, la pastille ne pourrait nommer qu'une extrémité.
    const actif = box('a', 40, 40, 60, 50, 'Hydrate-toi');
    const voisin = box('b', 40, 60, 60, 70, 'Banane');
    const bas = computeGapBadges(actif, [voisin], '9:16').find((g) => g.side === 'bottom')!;
    expect(bas.sourceLabel).toBe('Hydrate-toi');
    expect(bas.targetLabel).toBe('Banane');
  });

  it('une pastille au ras du bord reste dans le cadre', () => {
    // Le calque est `overflow: hidden` : sans bornage, la moitié de la
    // pastille d'un écart minuscule serait rognée — donc illisible.
    const { container } = render(
      <SmartGuides format="9:16" gaps={[gap({ midYPct: 1, gapPct: 2 })]} />,
    );
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(parseFloat(puce.style.top)).toBeGreaterThanOrEqual(6);
  });
});

describe('Le milieu du format, visible pendant la manipulation', () => {
  it('à égale distance des deux bords, la ligne devient pleine et se nomme', () => {
    const centre = box('a', 45, 45, 55, 55);
    const gaps = computeGapBadges(centre, [], '9:16');
    const { container } = render(<SmartGuides format="9:16" showCenter gaps={gaps} />);
    expect((container.querySelector('[data-guide-center-x]') as HTMLElement)
      .getAttribute('data-guide-centered')).toBe('true');
    expect((container.querySelector('[data-guide-center-y]') as HTMLElement)
      .getAttribute('data-guide-centered')).toBe('true');
    expect(container.querySelector('[data-guide-centered-label]')!.textContent).toBe('Milieu');
  });

  it('centré sur un seul axe, le libellé le dit', () => {
    // Centré horizontalement, posé haut : « Centré X », pas « Milieu ».
    const gauche = { ...gap({ side: 'left', axis: 'x' as const, target: 'frame' as const, equal: true }) };
    const droite = { ...gap({ side: 'right', axis: 'x' as const, target: 'frame' as const, equal: true }) };
    const { container } = render(
      <SmartGuides format="9:16" showCenter gaps={[gauche, droite]} />,
    );
    expect(container.querySelector('[data-guide-centered-label]')!.textContent).toBe('Centré X');
  });

  it('une symétrie entre deux VOISINS n est pas un centrage dans le format', () => {
    // ⚠️ LA DISTINCTION QUI COMPTE. Être à égale distance de deux blocs ne
    // veut pas dire être au milieu du cadre : seule l'égalité mesurée contre
    // le CADRE le prouve.
    const egalEntreVoisins = [
      gap({ side: 'top', target: 'element', targetKey: 'x', equal: true }),
      gap({ side: 'bottom', target: 'element', targetKey: 'y', equal: true }),
    ];
    const { container } = render(
      <SmartGuides format="9:16" showCenter gaps={egalEntreVoisins} />,
    );
    expect((container.querySelector('[data-guide-center-y]') as HTMLElement)
      .getAttribute('data-guide-centered')).toBe('false');
    expect(container.querySelector('[data-guide-centered-label]')).toBeNull();
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

  it('les écarts ne sont plus vidés au relâchement', () => {
    // C'est ce vidage qui rendait la règle absente au moment même où on veut
    // la lire : une fois le bloc posé.
    expect(avance).not.toContain('setActiveGaps([]);\n            }}');
    for (const bornes of ['onMouseUp', 'onMouseLeave']) {
      const i = avance.indexOf(bornes);
      expect(i, bornes).toBeGreaterThan(0);
    }
    // Les LIGNES magnétiques, elles, meurent bien avec le geste.
    expect(avance).toContain('setActiveGuides([]);');
  });

  it('les deux éditeurs montrent le milieu dès qu un bloc est mesuré', () => {
    expect(avance).toContain('showCenter={showCenterGuides || activeGaps.length > 0}');
    expect(simple).toContain('showCenter={reperesCentre || gaps.length > 0}');
  });

  it('et le libellé de format avec', () => {
    expect(avance).toContain('showRatioLabel={showCenterGuides || showGridOverlay || activeGaps.length > 0}');
    expect(simple).toContain('showRatioLabel={reperesCentre || reperesGrille || gaps.length > 0}');
  });

  it('la mesure reste branchée sur la sélection, pas sur un second système', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes("closest('[data-guide-key]')"), nom).toBe(true);
      expect(src.includes('sameGaps('), nom).toBe(true);
    }
  });
});
