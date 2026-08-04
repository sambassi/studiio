import React from 'react';
import { fontStack } from '@/lib/fonts/catalog';
import {
  FONT_RATIO, TEXT_LAYOUT, GAP_RATIO, leadingTrim, letterSpacingPx,
  type DesignFormat,
} from '@/lib/creer/designSpec';

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
}

export default function SequenceCta({
  text,
  subText,
  typography,
  format,
  containerWidth,
}: {
  text: string;
  subText?: string;
  typography: CtaTypography;
  format: DesignFormat;
  containerWidth: number;
}) {
  const vw = containerWidth;
  const weight = typography.bold ? 900 : 400;
  const style = typography.italic ? 'italic' : 'normal';
  const mainSize = vw * FONT_RATIO[format].cta * typography.scale;
  const subSize = vw * FONT_RATIO[format].ctaSub * typography.scale;

  return (
    <>
      <div
        style={{
          textTransform: 'uppercase',
          fontFamily: fontStack(typography.font),
          fontSize: mainSize,
          fontWeight: weight,
          fontStyle: style,
          letterSpacing: letterSpacingPx(typography.letterSpacing, vw),
          color: typography.color,
          lineHeight: typography.lineHeight,
          ...leadingTrim(mainSize, typography.lineHeight),
          textShadow: `0 0 ${vw * 0.02}px ${typography.color}66`,
        }}
      >
        {text}
      </div>
      {subText && (
        <div
          style={{
            textTransform: 'uppercase',
            fontFamily: fontStack(typography.font),
            fontSize: subSize,
            fontWeight: weight,
            fontStyle: style,
            letterSpacing: letterSpacingPx(typography.letterSpacing, vw),
            color: typography.subColor,
            lineHeight: typography.lineHeight,
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
