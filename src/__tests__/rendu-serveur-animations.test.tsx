import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import TextAnimationLayer from '@/components/creer/TextAnimationLayer';
import SequenceTitle from '@/components/creer/SequenceTitle';
import SequenceCta from '@/components/creer/SequenceCta';
import { textAnimationState, INTRO_WINDOW, easeOut } from '@/lib/creer/textAnimation';

/**
 * Animations de texte au rendu serveur — Phase 7.
 *
 * ⚠️ LES RÈGLES EXISTAIENT DÉJÀ. `textAnimation.ts` — le type, les libellés,
 * la fenêtre de 22 %, l'adoucissement, `textAnimationState`, `revealText` —
 * est en place depuis le menu de l'éditeur, et le compositeur canvas s'en
 * sert. Cette phase ne les réinvente pas : elle les branche sur les
 * composants partagés et les pilote à l'image sous Remotion.
 *
 * Il n'y a donc qu'une seule table de vérité, et les tests ci-dessous
 * verrouillent les deux endroits où la traduction en CSS peut trahir le
 * canvas :
 *
 * 1. **L'échelle est prise au centre du CADRE**, pas au centre du texte —
 *    `applyTextAnimation` fait `translate(w/2, h/2)` → `scale` → retour. Un
 *    titre en haut à gauche se rapproche donc du centre en grandissant. C'est
 *    pour cela que l'enveloppe couvre tout le cadre.
 * 2. **L'état neutre ne doit RIEN produire** : ni nœud, ni style. C'est ce
 *    qui rend « Aucune » identique au pixel près au rendu d'avant.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
const couche = readFileSync(resolve(__dirname, '../components/creer/TextAnimationLayer.tsx'), 'utf-8');

const TYPO = {
  font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false,
  letterSpacing: 0, lineHeight: 1.1,
};

describe('L etat neutre ne produit RIEN', () => {
  it('« Aucune » : les enfants, sans enveloppe', () => {
    const { container } = render(
      <TextAnimationLayer style="none" progress={0}><span data-cible /></TextAnimationLayer>,
    );
    // Pas même un `div` : aucun contexte d'empilement créé, donc adopter
    // cette couche quelque part ne peut rien changer tant qu'aucune
    // animation n'est demandée.
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('une animation TERMINÉE aussi', () => {
    const { container } = render(
      <TextAnimationLayer style="pop" progress={1}><span data-cible /></TextAnimationLayer>,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('un style inconnu se comporte comme « Aucune »', () => {
    const { container } = render(
      <TextAnimationLayer style={'valse' as never} progress={0}><span data-cible /></TextAnimationLayer>,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('le même test que le compositeur décide de ne rien appliquer', () => {
    expect(composer).toContain('if (a.alpha === 1 && a.translateY === 0 && a.scale === 1) return;');
    expect(couche).toContain('if (a.alpha === 1 && a.translateY === 0 && a.scale === 1)');
  });
});

describe('La traduction en CSS dit ce que le canvas fait', () => {
  const rendre = (style: 'fade' | 'slide' | 'pop', progress: number) => {
    const { container } = render(
      <TextAnimationLayer style={style} progress={progress}><span /></TextAnimationLayer>,
    );
    return container.firstElementChild as HTMLElement;
  };

  it('le fondu ne touche QUE l opacité', () => {
    const el = rendre('fade', 0.02);
    const attendu = textAnimationState('fade', 0.02);
    expect(Number(el.style.opacity)).toBeCloseTo(attendu.alpha, 6);
    expect(el.style.transform).toBe('');
  });

  it('le glissement descend d une FRACTION de la hauteur', () => {
    // Le canvas : `ctx.translate(0, translateY * h)`. L'enveloppe couvrant le
    // cadre, un pourcentage CSS dit la même chose sans connaître la
    // résolution.
    const attendu = textAnimationState('slide', 0.02);
    expect(rendre('slide', 0.02).style.transform)
      .toBe(`translateY(${attendu.translateY * 100}%)`);
    // Vers le BAS : le texte monte vers sa place.
    expect(attendu.translateY).toBeGreaterThan(0);
  });

  it('le pop est mis à l échelle AU CENTRE DU CADRE', () => {
    // `translate(w/2, h/2)` → `scale` → `translate(-w/2, -h/2)` : autour de
    // l'origine, le texte partirait du coin haut-gauche.
    expect(composer).toContain('ctx.translate(w / 2, h / 2);');
    const el = rendre('pop', 0.02);
    expect(el.style.transform).toContain('scale(');
    expect(el.style.transformOrigin).toBe('center center');
    // L'enveloppe couvre bien tout le cadre — sans quoi « centre » ne
    // désignerait pas le même point.
    expect(el.style.position).toBe('absolute');
    for (const cote of ['top', 'left', 'right', 'bottom'] as const) {
      expect(el.style[cote], cote).toBe('0px');
    }
  });

  it('la machine à écrire ne bouge ni n efface le bloc', () => {
    // Elle n'agit que sur le TEXTE : l'enveloppe reste neutre, donc absente.
    const { container } = render(
      <TextAnimationLayer style="typewriter" progress={0.02}><span data-cible /></TextAnimationLayer>,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(textAnimationState('typewriter', 0.02).charRatio).toBeLessThan(1);
  });
});

describe('La machine à écrire, dans les composants partagés', () => {
  it('le titre ET le sous-titre s écrivent ensemble', () => {
    // `drawIntro` applique `revealText` aux deux.
    expect(composer).toContain('subtitle = subtitle ? revealText(subtitle, revealRatio) : subtitle;');
    const { container } = render(
      <SequenceTitle
        title="ROUTINE" subtitle="Trois gestes" typography={TYPO}
        subtitleTypography={{ font: null, color: null, scale: 1 }}
        format="9:16" containerWidth={1080} reveal={0.5}
      />,
    );
    // Chacun est tronque a la meme PROPORTION, pas au meme nombre de
    // lettres : « ROUTINE » (7) donne 4 caracteres, « Trois gestes » (12) en
    // donne 6. Les deux finissent donc ensemble, ce qui est le point.
    expect(container.textContent).toBe('ROUTTrois ');
  });

  it('le SOUS-TEXTE du CTA, lui, n est pas tronqué', () => {
    // `drawCTA` n'applique `revealText` qu'au texte principal : deux frappes
    // concurrentes à l'écran se gênaient.
    expect(composer).toContain('if (revealRatio < 1) ctaText = revealText(ctaText, revealRatio);');
    const { container } = render(
      <SequenceCta
        text="JE ME LANCE" subText="LIEN EN BIO"
        typography={{ ...TYPO, subColor: '#EC4899' }}
        format="9:16" containerWidth={1080} reveal={0.5}
      />,
    );
    expect(container.textContent).toContain('LIEN EN BIO');
    expect(container.textContent).not.toContain('JE ME LANCE');
  });

  it('sans `reveal`, le texte entier — le rendu d aujourd hui', () => {
    const { container } = render(
      <SequenceTitle
        title="ROUTINE" typography={TYPO}
        subtitleTypography={{ font: null, color: null, scale: 1 }}
        format="9:16" containerWidth={1080}
      />,
    );
    expect(container.textContent).toBe('ROUTINE');
  });

  it('une lettre est visible dès la première image utile', () => {
    // `revealText` arrondit au SUPÉRIEUR : un cadre vide ressemblerait à un
    // bug.
    const { container } = render(
      <SequenceTitle
        title="ROUTINE" typography={TYPO}
        subtitleTypography={{ font: null, color: null, scale: 1 }}
        format="9:16" containerWidth={1080} reveal={0.01}
      />,
    );
    expect(container.textContent).toBe('R');
  });
});

describe('La composition pilote l animation à l image', () => {
  it('elle mesure l avancement dans la séquence', () => {
    expect(composition).toContain('const frame = useCurrentFrame();');
    expect(composition).toContain('<SequenceAnimee');
  });

  it('l avancement part du début NOMINAL, pas de la première image', () => {
    // Depuis la Phase 6, une séquence autre que la première commence plus tôt
    // : ce préfixe porte la transition. Compter l'animation depuis là ferait
    // apparaître le texte pendant le raccord.
    expect(composition).toContain('Math.max(0, frame - prefixFrames) / baseFrames');
    expect(composition).toContain('prefixFrames={i === 0 ? 0 : tFrames}');
  });

  it('les trois blocs de texte sont enveloppés', () => {
    expect(composition.match(/<TextAnimationLayer/g)).toHaveLength(3);
  });

  it('le FOND ne l est jamais', () => {
    // Un fond en fondu laisserait voir le noir, un fond qui glisse
    // découvrirait une bande vide. Le compositeur le dit à l'identique.
    expect(composer).toContain('jamais\n * avant le fond');
    const avantTitre = composition.slice(0, composition.indexOf('<TextAnimationLayer'));
    expect(avantTitre).toContain('<Fond props={props} type={type} />');
  });

  it('les cartes ne reçoivent PAS la machine à écrire', () => {
    // Côté navigateur elles sont une PHOTO : une frappe lettre à lettre ne
    // peut rien dessus. Offrir l'effet ici ferait diverger les deux moteurs.
    const bloc = composition.slice(
      composition.indexOf("{type === 'cards' && ("),
      composition.indexOf("{type === 'cta' && ("),
    );
    expect(bloc).toContain('<TextAnimationLayer');
    expect(bloc).not.toContain('reveal=');
  });

  it('le titre et le CTA, si', () => {
    expect(composition.match(/reveal=\{anim\.reveal\}/g)).toHaveLength(2);
  });
});

describe('La fenêtre d apparition reste celle du menu', () => {
  it('22 % de la séquence', () => {
    expect(INTRO_WINDOW).toBe(0.22);
  });

  it('l animation est terminée avant le quart de la séquence', () => {
    // Sur une séquence de 3 s à 30 i/s, cela met le texte entier à l'image 20.
    expect(textAnimationState('fade', 0.22)).toEqual({ alpha: 1, translateY: 0, scale: 1, charRatio: 1 });
    expect(easeOut(1)).toBe(1);
  });
});
