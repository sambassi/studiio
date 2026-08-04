import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import FreeElementsLayer, { freeElementSizePx, type FreeElement } from '@/components/creer/FreeElementsLayer';
import { freeElementRect } from '@/lib/video-composer';

/**
 * Elements libres en composant partagé — Phase 5.
 *
 * Même méthode que les cartes (Phase 2) et le titre / le CTA (Phase 4), mais
 * avec une contrainte que les précédents n'avaient pas : **l'export navigateur
 * lit le SVG dans le DOM de l'aperçu**, par
 * `document.querySelector('[data-free-element="<id>"] svg')`.
 *
 * Cet attribut n'est donc pas une commodité de test, c'est un contrat. Le
 * renommer ne casse aucune compilation : l'export perd simplement tous les
 * éléments, en silence, et personne ne s'en aperçoit avant de regarder une
 * vidéo. D'où les verrous ci-dessous, des deux côtés du contrat.
 */

const couche = readFileSync(resolve(__dirname, '../components/creer/FreeElementsLayer.tsx'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
const entree = readFileSync(resolve(__dirname, '../lib/render/creerSimple.ts'), 'utf-8');

const ELS: FreeElement[] = [
  { id: 'a', iconName: 'Flame', x: 25, y: 20, sizePct: 19.35, color: '#FFFFFF' },
  { id: 'b', iconName: 'Star', x: 50, y: 78, sizePct: 22, color: '#7C3AED' },
];

describe('Le contrat de l export navigateur', () => {
  it('`data-free-element` porte l identifiant, et le SVG en est enfant DIRECT', () => {
    const { container } = render(
      <FreeElementsLayer elements={ELS} containerWidth={1080} />,
    );
    for (const el of ELS) {
      const noeud = container.querySelector(`[data-free-element="${el.id}"]`);
      expect(noeud, el.id).not.toBeNull();
      // C'est exactement la requête que fait `rasterizeElements`.
      const svg = noeud!.querySelector('svg');
      expect(svg, `${el.id}/svg`).not.toBeNull();
      expect(svg!.parentElement).toBe(noeud);
    }
  });

  it('l aperçu rasterise bien depuis cet attribut', () => {
    // L'autre bout du contrat : si cette requête change de sélecteur, le
    // composant doit changer avec elle.
    expect(wizard).toContain('`[data-free-element="${el.id}"] svg`');
  });
});

describe('Les DEUX moteurs montent le MÊME composant', () => {
  it('l aperçu', () => {
    expect(wizard).toContain('<FreeElementsLayer');
    expect(wizard).toContain("from '@/components/creer/FreeElementsLayer'");
    // Plus de rendu local : c'était la source de divergence.
    expect(wizard).not.toContain('{(elements ?? []).map((el) => (');
  });

  it('la composition Remotion', () => {
    expect(composition).toContain('<FreeElementsLayer');
    // Import RELATIF : le bundler Remotion ignore l'alias `@/`.
    expect(composition).toContain("from '../src/components/creer/FreeElementsLayer'");
    // Et le champ n'est plus « accepté sans être rendu ».
    expect(composition).not.toContain('elements?: unknown[]');
  });

  it('l entrée de rendu serveur accepte les éléments', () => {
    expect(entree).toContain('elements?: FreeElement[]');
  });
});

describe('Sur TOUTES les séquences — comme le compositeur', () => {
  it('la couche est DANS la séquence, pas à côté', () => {
    // `drawFreeElements` est appelée a la fin de CHACUNE des quatre
    // sequences. Poser la couche hors du contenu la rendrait bien sur toute
    // la duree, mais sous un autre parent : une seule regression de z-index
    // separerait alors les deux moteurs.
    //
    // Depuis la Phase 6, ce contenu est la fonction `contenu(type)` que
    // chaque `TransitionSeries.Sequence` monte.
    const bloc = composition.slice(
      composition.indexOf('const contenu = (type: string'),
      composition.indexOf('const base = baseSequenceFrames('),
    );
    expect(bloc).toContain('<FreeElementsLayer');
    // Depuis la Phase 7, le contenu passe par `SequenceAnimee`, qui mesure
    // l'avancement de la sequence avant de l'appeler.
    expect(composition).toContain('rendu={(anim) => contenu(seq.type, anim)}');
  });

  it('sous le filigrane, comme sur le canvas', () => {
    // Le compositeur peint le texte de site APRÈS `drawFreeElements` : il
    // passe donc par-dessus. L'ordre du DOM doit dire la même chose.
    expect(composition.indexOf('<FreeElementsLayer'))
      .toBeLessThan(composition.indexOf('<Filigrane texte='));
  });
});

describe('La règle de taille est partagée avec le canvas', () => {
  it('`freeElementSizePx` et `freeElementRect` disent la même chose', () => {
    for (const el of [...ELS, { ...ELS[0], sizePct: 5 }, { ...ELS[0], sizePct: 60 }]) {
      const rect = freeElementRect(el, 1080, 1920)!;
      // Le canvas garde la valeur exacte, le DOM rend un entier de pixels.
      expect(freeElementSizePx(el.sizePct, 1080), String(el.sizePct))
        .toBe(Math.round(rect.size));
    }
  });

  it('le centre est bien le CENTRE, des deux côtés', () => {
    // Canvas : `x - size / 2`. DOM : `left: x%` plus `translate(-50%, -50%)`.
    const rect = freeElementRect(ELS[0], 1080, 1920)!;
    expect(rect.x).toBe(Math.round((25 / 100) * 1080 - rect.size / 2));
    expect(couche).toContain("transform: 'translate(-50%, -50%)'");
    expect(couche).toContain('left: `${el.x}%`');
  });

  it('la taille suit la LARGEUR de la composition, pas sa hauteur', () => {
    // Sinon un même élément changerait de taille en passant en 16:9.
    expect(freeElementSizePx(10, 1080)).toBe(108);
    expect(freeElementSizePx(10, 1920)).toBe(192);
  });
});

describe('Présentation seule — les aides d édition restent dehors', () => {
  it('sans `interaction`, aucune trace d édition', () => {
    const { container } = render(
      <FreeElementsLayer elements={ELS} containerWidth={1080} />,
    );
    const noeud = container.querySelector('[data-free-element="a"]') as HTMLElement;
    // Côté serveur il n'y a ni pointeur ni sélection : rien de tout cela ne
    // peut se graver dans la vidéo.
    expect(noeud.style.cursor).toBe('');
    expect(noeud.style.zIndex).toBe('');
    expect(noeud.style.outline).toBe('');
    expect(noeud.style.touchAction).toBe('');
    expect(noeud.getAttribute('title')).toBeNull();
    expect(container.querySelectorAll('[data-element-handle]')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('avec `interaction`, elles reviennent — et le chrome vient de l appelant', () => {
    const { container } = render(
      <FreeElementsLayer
        elements={ELS}
        containerWidth={1080}
        interaction={{
          onElementDragStart: () => {},
          selectedElementId: 'a',
          uiPx: (n) => n,
          renderChrome: (el) => <span data-element-handle="se">{el.id}</span>,
        }}
      />,
    );
    const noeud = container.querySelector('[data-free-element="a"]') as HTMLElement;
    expect(noeud.style.cursor).toBe('grab');
    expect(noeud.style.zIndex).toBe('4');
    expect(noeud.style.outline).toContain('solid');
    expect(container.querySelectorAll('[data-element-handle]')).toHaveLength(2);
  });

  it('la photo des cartes efface l anneau de sélection', () => {
    // Un liseré gravé dans la vidéo ne se rattrape pas.
    const { container } = render(
      <FreeElementsLayer
        elements={ELS}
        containerWidth={1080}
        interaction={{ onElementDragStart: () => {}, selectedElementId: 'a', capturing: true, uiPx: (n) => n }}
      />,
    );
    const noeud = container.querySelector('[data-free-element="a"]') as HTMLElement;
    expect(noeud.style.outline).toBe('');
  });
});

describe('Aucune classe Tailwind — la leçon de la Phase 2', () => {
  it('le composant n en utilise aucune', () => {
    // Le bundle Remotion n'a pas la feuille de l'application : une classe n'y
    // produirait rien, et les éléments sortiraient sans mise en forme.
    const code = couche.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/className="[^"]+"/);
  });
});

describe('Rétro-compatibilité', () => {
  it('sans élément, la couche ne rend rien', () => {
    const { container } = render(<FreeElementsLayer elements={[]} containerWidth={1080} />);
    expect(container.innerHTML).toBe('');
  });

  it('une liste absente ne fait pas échouer le rendu', () => {
    // Aucun montage antérieur à cette fonction n'a le champ.
    const { container } = render(
      <FreeElementsLayer elements={undefined as never} containerWidth={1080} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('la couleur et l icône de chaque élément lui sont propres', () => {
    const { container } = render(<FreeElementsLayer elements={ELS} containerWidth={1080} />);
    const svgA = container.querySelector('[data-free-element="a"] svg')!;
    const svgB = container.querySelector('[data-free-element="b"] svg')!;
    expect(svgA.getAttribute('width')).toBe('209');
    expect(svgB.getAttribute('width')).toBe('238');
    expect(svgA.getAttribute('stroke')).toBe('#FFFFFF');
    expect(svgB.getAttribute('stroke')).toBe('#7C3AED');
  });
});
