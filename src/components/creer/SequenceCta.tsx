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
}

export default function SequenceCta({
  text,
  subText,
  typography,
  format,
  containerWidth,
  reveal = 1,
}: {
  text: string;
  subText?: string;
  typography: CtaTypography;
  format: DesignFormat;
  containerWidth: number;
  /**
   * Part du texte deja ecrite, de 0 a 1 — la machine a ecrire.
   *
   * Le SOUS-TEXTE n'est PAS tronque : `drawCTA` n'applique `revealText` qu'a
   * l'appel principal. Le sous-texte est une mention courte (« lien en bio »)
   * qui, ecrite lettre a lettre sous un titre qui se tape deja, faisait deux
   * frappes concurrentes a l'ecran.
   */
  reveal?: number;
}) {
  const vw = containerWidth;
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

  return (
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
            color: typography.subColor,
            lineHeight: typography.lineHeight,
            textAlign: align,
            textDecoration: trait,
            ...decoration(subSize),
            ...leadingTrim(subSize, typography.lineHeight),
            marginTop: vw * GAP_RATIO - ((typography.lineHeight - 1) * subSize) / 2,
          }}
        >
          {subText}
        </div>
      )}
    </>
  );
}

/** Cadre du bloc CTA — ancre par le BAS, centre horizontalement. */
export function ctaFrameStyle(position: { x: number; y: number }): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: 'translate(-50%, -100%)',
    width: `${TEXT_LAYOUT.ctaWidth}%`,
    textAlign: 'center',
  };
}
