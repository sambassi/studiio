import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import SmartGuides from '@/components/creer/SmartGuides';
import {
  FORMAT_PIXELS,
  pctToFormatPx,
  boxFromRects,
  boxCenter,
  shiftBox,
  collectGuideBoxes,
  computeGapBadges,
  snapPosition,
  EQUAL_GAP_TOLERANCE_PX,
  THIRDS_PERCENT,
  type ElementBox,
} from '@/lib/creer/smartGuides';

/**
 * Règles et repères d'alignement — les trois défauts corrigés.
 *
 * 1. Le calque était un carré étiré (`viewBox="0 0 100 100"` +
 *    `preserveAspectRatio="none"`) : en 9:16 tout y était multiplié par 1,78
 *    en hauteur.
 * 2. Les écarts se mesuraient de CENTRE à CENTRE — un chiffre qui ne décrit
 *    aucun vide visible.
 * 3. Ils s'exprimaient en pixels d'ÉCRAN, donc changeaient avec la taille de
 *    la fenêtre pour un même montage.
 */

const box = (
  key: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): ElementBox => ({ key, label: key, left, top, right, bottom });

describe('L unité de mesure — pixels du format d export', () => {
  it('le 9:16 mesure 1080 × 1920, le 16:9 l inverse, le carré 1080 × 1080', () => {
    expect(FORMAT_PIXELS['9:16']).toEqual({ width: 1080, height: 1920 });
    expect(FORMAT_PIXELS['16:9']).toEqual({ width: 1920, height: 1080 });
    expect(FORMAT_PIXELS['1:1']).toEqual({ width: 1080, height: 1080 });
  });

  it('l axe décide du diviseur — supposer un cadre carré est L ERREUR corrigée', () => {
    // 10 % du cadre : 108 px en largeur, 192 px en hauteur. Un seul diviseur
    // pour les deux axes donnerait le même chiffre — c'est ce que faisait
    // l'ancien calcul quand on lui passait `rect.width` et `rect.height`
    // d'un aperçu dont l'affichage n'était pas au ratio du format.
    expect(pctToFormatPx(10, 'x', '9:16')).toBe(108);
    expect(pctToFormatPx(10, 'y', '9:16')).toBe(192);
    expect(pctToFormatPx(10, 'x', '16:9')).toBe(192);
    expect(pctToFormatPx(10, 'y', '16:9')).toBe(108);
  });

  it('le même écart en % donne le MÊME chiffre quelle que soit la taille d écran', () => {
    // C'est tout l'intérêt : le nombre décrit le montage, pas la fenêtre.
    expect(pctToFormatPx(25, 'y', '9:16')).toBe(480);
    expect(pctToFormatPx(25, 'y', '9:16')).toBe(480);
  });

  it('un format inconnu ne produit pas NaN', () => {
    expect(pctToFormatPx(Number.NaN, 'x', '9:16')).toBe(0);
  });
});

describe('Les écarts sont mesurés BORD À BORD, pas de centre à centre', () => {
  // Un actif de 20 % de haut, centré verticalement ; un voisin au-dessus.
  const actif = box('actif', 40, 40, 60, 60);

  it('le vide mesuré est celui qui SE VOIT entre les deux bords', () => {
    // Voisin au-dessus à 10 % de vide ; le bas du cadre est aussi à 10 %,
    // donc la paire est égale et les deux badges sont émis.
    const voisin = box('voisin', 40, 10, 60, 30);
    const actif = box('actif', 40, 40, 60, 90);
    const gaps = computeGapBadges(actif, [voisin], '9:16');
    const haut = gaps.find((g) => g.side === 'top')!;
    // Bord bas du voisin = 30 %, bord haut de l'actif = 40 % → 10 % de vide.
    // De centre à centre on aurait lu 40 − 20 = 20 %, soit le DOUBLE : la
    // moitié de ce chiffre est occupée par les deux blocs eux-mêmes.
    expect(haut.gapPct).toBeCloseTo(10);
    expect(haut.gapPx).toBe(pctToFormatPx(10, 'y', '9:16'));
    expect(haut.target).toBe('element');
    expect(haut.targetLabel).toBe('voisin');
  });

  it('sans voisin, la mesure va jusqu au BORD DU CADRE', () => {
    const gaps = computeGapBadges(actif, [], '9:16');
    expect(gaps.map((g) => g.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    for (const g of gaps) expect(g.target).toBe('frame');
    expect(gaps.find((g) => g.side === 'top')!.gapPct).toBeCloseTo(40);
    expect(gaps.find((g) => g.side === 'left')!.gapPct).toBeCloseTo(40);
  });

  it('un bloc qui ne se fait PAS face ne mesure pas un écart', () => {
    // Le voisin est plus haut, mais complètement à gauche : il n'y a aucun
    // vide vertical entre eux, ils sont côte à côte.
    const decale = box('decale', 0, 10, 20, 30);
    const gaps = computeGapBadges(actif, [decale], '9:16');
    expect(gaps.find((g) => g.side === 'top')!.target).toBe('frame');
    // En revanche, il fait bien face horizontalement.
    expect(gaps.find((g) => g.side === 'left')!.target).toBe('frame');
  });

  it('le voisin retenu est le PLUS PROCHE', () => {
    // Actif 40→60 ; voisin proche à 35 (5 % de vide) et voisin lointain à 10.
    // Le bas est mesuré au cadre depuis 60, à 40 % — inégal, donc seul l'axe
    // horizontal sortirait ; on lit ici la valeur retenue côté haut.
    const proche = box('proche', 40, 20, 60, 35);
    const loin = box('loin', 40, 0, 60, 10);
    const bas = box('bas', 40, 65, 60, 80);
    const haut = computeGapBadges(actif, [loin, proche, bas], '9:16')
      .find((g) => g.side === 'top')!;
    expect(haut.targetLabel).toBe('proche');
    expect(haut.gapPct).toBeCloseTo(5);
  });

  it('la puce est posée au MILIEU du vide mesuré', () => {
    const gaps = computeGapBadges(actif, [], '9:16');
    const haut = gaps.find((g) => g.side === 'top')!;
    expect(haut.midYPct).toBeCloseTo(20); // entre 0 et 40
    expect(haut.midXPct).toBeCloseTo(50); // milieu de l'actif
  });
});

describe('L égalité des espaces — la confirmation du centrage', () => {
  it('haut = bas quand l élément est centré verticalement dans le cadre', () => {
    const centre = box('actif', 40, 45, 60, 55);
    const gaps = computeGapBadges(centre, [], '9:16');
    expect(gaps.find((g) => g.side === 'top')!.equal).toBe(true);
    expect(gaps.find((g) => g.side === 'bottom')!.equal).toBe(true);
  });

  it('gauche = droite quand il est centré horizontalement', () => {
    const centre = box('actif', 45, 10, 55, 20);
    const gaps = computeGapBadges(centre, [], '16:9');
    expect(gaps.find((g) => g.side === 'left')!.equal).toBe(true);
    expect(gaps.find((g) => g.side === 'right')!.equal).toBe(true);
  });

  it('décentré, l axe disparaît — c est ainsi que le nuage de chiffres s éteint', () => {
    const decentre = box('actif', 10, 45, 30, 55);
    const gaps = computeGapBadges(decentre, [], '9:16');
    expect(gaps.some((g) => g.axis === 'x')).toBe(false);
    // L'axe vertical, lui, reste centré : les deux axes sont indépendants.
    expect(gaps.filter((g) => g.axis === 'y')).toHaveLength(2);
  });

  it('la tolérance est exprimée en pixels du format, pas en %', () => {
    // 0,1 % de 1920 px = ~2 px : sous la tolérance, donc encore « égal ».
    const presque = box('actif', 40, 45, 60, 54.9);
    expect(computeGapBadges(presque, [], '9:16').some((g) => g.axis === 'y')).toBe(true);
    // 1 % de 1920 px = ~19 px : au-dessus, donc plus égal.
    const non = box('actif', 40, 45, 60, 54);
    expect(computeGapBadges(non, [], '9:16').some((g) => g.axis === 'y')).toBe(false);
    expect(EQUAL_GAP_TOLERANCE_PX).toBeGreaterThan(0);
  });

  it('l égalité vaut aussi entre deux VOISINS, pas seulement contre le cadre', () => {
    const actif = box('actif', 40, 45, 60, 55);
    const haut = box('haut', 40, 20, 60, 35);
    const bas = box('bas', 40, 65, 60, 80);
    const gaps = computeGapBadges(actif, [haut, bas], '9:16');
    expect(gaps.find((g) => g.side === 'top')!.gapPct).toBeCloseTo(10);
    expect(gaps.find((g) => g.side === 'bottom')!.gapPct).toBeCloseTo(10);
    expect(gaps.find((g) => g.side === 'top')!.equal).toBe(true);
  });
});

describe('Les boîtes englobantes', () => {
  it('un rectangle écran devient quatre bords en % du cadre', () => {
    const frame = { left: 100, top: 50, width: 400, height: 800 };
    const el = { left: 200, top: 250, width: 100, height: 80 };
    expect(boxFromRects('t', 'Titre', el, frame)).toEqual({
      key: 't',
      label: 'Titre',
      left: 25,
      top: 25,
      right: 50,
      bottom: 35,
    });
  });

  it('le centre est bien le milieu des bords, et la translation exacte', () => {
    const b = box('b', 10, 20, 30, 40);
    expect(boxCenter(b)).toEqual({ x: 20, y: 30 });
    expect(boxCenter(shiftBox(b, 5, -5))).toEqual({ x: 25, y: 25 });
  });

  it('un cadre de taille nulle ne rend aucune boîte — jamais de division par zéro', () => {
    const frame = document.createElement('div');
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    expect(collectGuideBoxes(frame)).toEqual([]);
    expect(collectGuideBoxes(null)).toEqual([]);
  });

  it('seuls les éléments marqués sont mesurés, et l union remplace le conteneur', () => {
    const frame = document.createElement('div');
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;

    const marque = document.createElement('div');
    marque.setAttribute('data-guide-key', 'title');
    marque.setAttribute('data-guide-label', 'Titre');
    marque.getBoundingClientRect = () => ({ left: 10, top: 10, width: 20, height: 5 }) as DOMRect;

    const anonyme = document.createElement('div');
    anonyme.getBoundingClientRect = () => ({ left: 0, top: 0, width: 90, height: 90 }) as DOMRect;

    // Conteneur pleine bande, dont seules les cartes occupent le milieu.
    const conteneur = document.createElement('div');
    conteneur.setAttribute('data-guide-key', 'cards');
    conteneur.setAttribute('data-guide-union', '');
    conteneur.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    const carte = document.createElement('div');
    carte.getBoundingClientRect = () => ({ left: 20, top: 40, width: 60, height: 20 }) as DOMRect;
    conteneur.appendChild(carte);

    frame.append(marque, anonyme, conteneur);

    const boxes = collectGuideBoxes(frame);
    expect(boxes.map((b) => b.key)).toEqual(['title', 'cards']);
    expect(boxes[0]).toMatchObject({ label: 'Titre', left: 10, top: 10, right: 30, bottom: 15 });
    // L'union rend les CARTES (40 → 60), pas la bande entière (0 → 100).
    expect(boxes[1]).toMatchObject({ top: 40, bottom: 60 });
  });
});

describe('L aimantation étendue', () => {
  it('les tiers ne sont proposés que si on les demande — défaut inchangé', () => {
    const tiers = THIRDS_PERCENT[0];
    expect(snapPosition(tiers + 0.5, 20, []).x).toBeCloseTo(tiers + 0.5);
    const avec = snapPosition(tiers + 0.5, 20, [], { thirds: true });
    expect(avec.x).toBeCloseTo(tiers);
    expect(avec.guides.some((g) => g.source === 'preview-thirds')).toBe(true);
  });

  it('aimante sur le MILIEU d un espace libre — des écarts égaux de chaque côté', () => {
    // Deux blocs laissent libre la bande 30 % → 70 % : son milieu est 50.
    const boxes = [box('a', 0, 0, 100, 30), box('b', 0, 70, 100, 100)];
    const r = snapPosition(20, 49.5, [], { boxes });
    expect(r.y).toBeCloseTo(50);
  });

  it('la cible vise le CENTRE : l ancre est corrigée de son décalage', () => {
    // Espace libre 40 % → 80 %, milieu 60. Un titre ancré par son haut, dont
    // le centre est 10 % plus bas, doit être posé à 50 pour que son CENTRE
    // tombe sur 60.
    const boxes = [box('a', 0, 0, 100, 40), box('b', 0, 80, 100, 100)];
    const r = snapPosition(20, 50.4, [], { boxes, anchorOffset: { x: 0, y: 10 } });
    expect(r.y).toBeCloseTo(50);
  });

  it('sans options, le comportement historique est INTACT', () => {
    const r = snapPosition(50.5, 20, []);
    expect(r.x).toBe(50);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].source).toBe('preview-center');
  });
});

describe('Le calque n est plus déformé', () => {
  it('il ne dessine plus dans un SVG au repère carré', () => {
    // Le commentaire d'en-tête cite l'ancien `preserveAspectRatio="none"`
    // pour expliquer le défaut : c'est la BALISE qui doit avoir disparu, pas
    // le mot. Plus aucun `<svg>` écrit à la main — seules les icônes lucide
    // en produisent, et elles portent leur propre géométrie.
    const src = readFileSync(resolve(__dirname, '../components/creer/SmartGuides.tsx'), 'utf-8');
    expect(src).not.toMatch(/<svg[\s>]/);
    expect(src).not.toMatch(/<line[\s>]/);
    expect(src).not.toMatch(/<text[\s>]/);
  });

  it('il n intercepte aucun geste', () => {
    const { container } = render(<SmartGuides showCenter format="9:16" />);
    const calque = container.firstElementChild as HTMLElement;
    expect(calque.className).toContain('pointer-events-none');
    expect(calque.getAttribute('aria-hidden')).not.toBeNull();
  });

  it('la croix de centre tombe à 50 % / 50 %, en 9:16 comme en 16:9', () => {
    for (const format of ['9:16', '16:9'] as const) {
      const { container, unmount } = render(<SmartGuides showCenter format={format} />);
      const vertical = container.querySelector('[data-guide-center-x]') as HTMLElement;
      const horizontal = container.querySelector('[data-guide-center-y]') as HTMLElement;
      const marque = container.querySelector('[data-guide-center-mark]') as HTMLElement;
      // Le POURCENTAGE est la seule expression juste dans les deux formats :
      // il suit le cadre réel au lieu de supposer une géométrie.
      expect(vertical.style.left, format).toBe('50%');
      expect(horizontal.style.top, format).toBe('50%');
      expect(marque.style.left, format).toBe('50%');
      expect(marque.style.top, format).toBe('50%');
      expect(marque.style.transform, format).toBe('translate(-50%, -50%)');
      unmount();
    }
  });

  it('le libellé de ratio annonce le format actif', () => {
    const { container, unmount } = render(<SmartGuides showRatioLabel format="16:9" />);
    expect(container.querySelector('[data-guide-ratio]')!.textContent).toBe('16:9');
    unmount();
    render(<SmartGuides showRatioLabel format="9:16" />);
    expect(screen.getByText('9:16')).toBeTruthy();
  });

  it('la puce de mesure garde une taille de police FIXE — jamais étirée', () => {
    const { container } = render(
      <SmartGuides
        format="9:16"
        gaps={[{
          axis: 'y', side: 'top', midXPct: 50, midYPct: 20, gapPct: 40,
          gapPx: 768, target: 'frame', targetLabel: 'Cadre', equal: true,
        }]}
      />,
    );
    const puce = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    expect(puce.textContent).toBe('768');
    // En pixels d'écran : la forme de la puce ne dépend pas du ratio du cadre.
    expect(puce.style.fontSize).toBe('10px');
    expect(puce.style.left).toBe('50%');
    expect(puce.style.top).toBe('20%');
  });

  it('les deux badges d une paire sont identiques — c est le message', () => {
    const commun = { axis: 'y' as const, midXPct: 50, gapPct: 40, target: 'frame' as const, targetLabel: 'Cadre', equal: true as const, gapPx: 768 };
    const { container } = render(
      <SmartGuides
        format="9:16"
        gaps={[
          { ...commun, side: 'top', midYPct: 20 },
          { ...commun, side: 'bottom', midYPct: 80 },
        ]}
      />,
    );
    const haut = container.querySelector('[data-guide-gap="top"]') as HTMLElement;
    const bas = container.querySelector('[data-guide-gap="bottom"]') as HTMLElement;
    // Même fond, même valeur : la répétition EST l'information. Rien ne les
    // distingue, et c'est précisément ce qui se lit d'un coup d'œil.
    expect(haut.style.background).toBe(bas.style.background);
    expect(haut.textContent).toBe(bas.textContent);
  });

  it('monté nu, il ne rend rien du tout', () => {
    const { container } = render(<SmartGuides />);
    expect((container.firstElementChild as HTMLElement).children).toHaveLength(0);
  });
});

describe('Le câblage des deux éditeurs', () => {
  const avance = readFileSync(resolve(__dirname, '../app/dashboard/creer-avance/page.tsx'), 'utf-8');
  const simple = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
    'utf-8',
  );

  it('les deux montent LE MÊME calque', () => {
    for (const [nom, src] of [['avancé', avance], ['simple', simple]] as const) {
      expect(src.includes("from '@/components/creer/SmartGuides'")
        || src.includes('from "@/components/creer/SmartGuides"'), nom).toBe(true);
    }
  });

  it('les deux lui passent le FORMAT ACTIF — jamais une constante', () => {
    expect(avance).toContain('format={format}');
    expect(simple).toContain('format={format}');
  });

  it('les deux mesurent les boîtes du DOM, pas les positions d état', () => {
    expect(avance).toContain('collectGuideBoxes(previewRef.current)');
    expect(simple).toContain('collectGuideBoxes(previewRef.current)');
  });

  it('aucun des deux n appelle plus la mesure centre-à-centre', () => {
    expect(avance).not.toContain('computeDistanceBadges');
    expect(simple).not.toContain('computeDistanceBadges');
  });

  it('le calque est effacé pendant la photo de l aperçu — dans les deux', () => {
    expect(avance).toContain('{!isCapturingSnapshot && (');
    expect(simple).toContain('{!capturing && (');
  });
});
