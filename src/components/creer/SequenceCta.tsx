import React from 'react';
import { fontStack } from '@/lib/fonts/catalog';
import { revealText } from '@/lib/creer/textAnimation';
import {
  FONT_RATIO, TEXT_LAYOUT, GAP_RATIO, leadingTrim, letterSpacingPx,
  type DesignFormat,
} from '@/lib/creer/designSpec';
import {
  cssTextTransform, cssTextDecoration, DEFAULT_TEXT_CASE,
  DECORATION_THICKNESS_RATIO, UNDERLINE_OFFSET_RATIO,
  type TextCase, type TextAlign,
} from '@/lib/creer/textFormat';
import { eclaircirPourContraste, PASTILLE_CSS } from '@/lib/creer/contraste';

/**
 * Appel a l'action — composant PARTAGE par les deux moteurs de rendu.
 *
 * Memes regles que `SequenceTitle` : presentation seule, aucune classe
 * Tailwind, mesures depuis `designSpec`.
 *
 * Le bloc est ancre par le BAS : `drawCTA` calcule `curY = ctaPosY - blockH`,
 * donc `y` designe le bas du bloc et non son haut. C'est ce que reproduit
 * `translate(-50%, -100%)` dans le cadre.
 */

export interface CtaTypography {
  font: string;
  color: string;
  subColor: string;
  scale: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
  /**
   * Casse, alignement et decoration — tous optionnels.
   *
   * ⚠️ LE REPLI DE LA CASSE EST `'uppercase'` : le CTA etait ecrit en
   * capitales EN DUR des deux cotes. Retomber sur `'none'` mettrait tous les
   * montages existants en minuscules.
   */
  textCase?: TextCase;
  align?: TextAlign;
  underline?: boolean;
  strike?: boolean;
  /** Petite ligne sur pastille (Créer, `contraste.ts`). Absent : inchangé. */
  sousPastille?: boolean;
}

export default function SequenceCta({
  text,
  subText,
  typography,
  format,
  containerWidth,
  reveal = 1,
  fond = null,
  sousPastille = false,
}: {
  text: string;
  subText?: string;
  typography: CtaTypography;
  format: DesignFormat;
  containerWidth: number;
  /**
   * Part du texte deja ecrite, de 0 a 1 — la machine a ecrire.
   *
   * L'appel principal ET le sous-texte s'ecrivent ensemble, a la MEME
   * proportion — la regle du titre et de son sous-titre (`SequenceTitle`,
   * `drawIntro`), reprise par `drawCTA`. Les deux finissent donc ensemble ;
   * laisser le sous-texte entier faisait apparaitre le CTA d'un bloc.
   */
  reveal?: number;
  /**
   * #502 — panneau sombre derrière le CTA posé SUR la vidéo (surimpression) :
   * lisible quel que soit le plan. `null` = le CTA d'avant, sans panneau.
   */
  fond?: string | null;
  /**
   * Petite ligne sur une pastille sombre, teinte eclaircie jusqu'a 4,5:1 —
   * la MEME regle que `drawCTA` (`design.ctaSousPastille`). Absent : inchange.
   */
  sousPastille?: boolean;
}) {
  const vw = containerWidth;
  const pastille = sousPastille || !!typography.sousPastille;
  const weight = typography.bold ? 900 : 400;
  const style = typography.italic ? 'italic' : 'normal';
  const mainSize = vw * FONT_RATIO[format].cta * typography.scale;
  const subSize = vw * FONT_RATIO[format].ctaSub * typography.scale;
  const casse = cssTextTransform(typography.textCase ?? DEFAULT_TEXT_CASE);
  const align = typography.align ?? 'center';
  const trait = cssTextDecoration(typography.underline, typography.strike);
  // Memes ratios que le compositeur canvas — voir `textFormat.ts`.
  const decoration = (size: number) => ({
    textDecorationThickness: Math.max(1, size * DECORATION_THICKNESS_RATIO),
    textUnderlineOffset: size * UNDERLINE_OFFSET_RATIO,
  });

  const contenu = (
    <>
      <div
        style={{
          // `text-transform` agit AVANT la mise en lignes : le navigateur
          // coupe donc comme le compositeur canvas, qui transforme la chaine
          // avant `wrapText`. Le texte du DOM reste intact.
          textTransform: casse,
          fontFamily: fontStack(typography.font),
          fontSize: mainSize,
          fontWeight: weight,
          fontStyle: style,
          letterSpacing: letterSpacingPx(typography.letterSpacing, vw),
          color: typography.color,
          lineHeight: typography.lineHeight,
          textAlign: align,
          textDecoration: trait,
          ...decoration(mainSize),
          ...leadingTrim(mainSize, typography.lineHeight),
          textShadow: `0 0 ${vw * 0.02}px ${typography.color}66`,
        }}
      >
        {revealText(text, reveal)}
      </div>
      {subText && (
        <div
          style={{
            textTransform: casse,
            fontFamily: fontStack(typography.font),
            fontSize: subSize,
            fontWeight: weight,
            fontStyle: style,
            letterSpacing: letterSpacingPx(typography.letterSpacing, vw),
            color: pastille ? eclaircirPourContraste(typography.subColor) : typography.subColor,
            lineHeight: typography.lineHeight,
            textAlign: align,
            textDecoration: trait,
            ...decoration(subSize),
            ...leadingTrim(subSize, typography.lineHeight),
            // #504 : retour à la ligne par MOTS — une URL n'est jamais coupée.
            overflowWrap: 'normal',
            wordBreak: 'keep-all',
            marginTop: vw * GAP_RATIO - ((typography.lineHeight - 1) * subSize) / 2,
          }}
        >
          {pastille ? (
            // Pastille EN LIGNE : son rembourrage vertical ne change pas la
            // hauteur de ligne, donc ni le bloc ni son ancrage ne bougent.
            <span style={{ backgroundColor: PASTILLE_CSS, padding: '0.22em 0.45em', borderRadius: '0.3em', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
              {revealText(subText, reveal)}
            </span>
          ) : revealText(subText, reveal)}
        </div>
      )}
    </>
  );
  if (!fond) return contenu;
  return (
    <div data-cta-fond style={{ backgroundColor: fond, padding: `${vw * 0.03}px ${vw * 0.04}px`, borderRadius: vw * 0.03 }}>
      {contenu}
    </div>
  );
}

/** Cadre du bloc CTA — ancre par le BAS, centre horizontalement. */
export function ctaFrameStyle(position: { x: number; y: number }, largeur: number = TEXT_LAYOUT.ctaWidth): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: 'translate(-50%, -100%)',
    width: `${largeur}%`,
    textAlign: 'center',
  };
}
