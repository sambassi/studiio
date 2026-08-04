import React from 'react';
import { fontStack } from '@/lib/fonts/catalog';
import { revealText } from '@/lib/creer/textAnimation';
import {
  FONT_RATIO, TEXT_LAYOUT, GAP_RATIO, titleShadow, subtitleShadow,
  leadingTrim, letterSpacingPx, type DesignFormat,
} from '@/lib/creer/designSpec';

/**
 * Titre et sous-titre — composant PARTAGE par les deux moteurs de rendu.
 *
 * Meme methode que les cartes (Phase 2), et memes deux conditions :
 *
 * 1. **Presentation seule.** Les aides d'edition — curseur, lisere de
 *    glissement, `zIndex` — restent DEHORS, dans l'apercu qui enveloppe ce
 *    composant. Cote serveur il n'y a ni pointeur ni glissement : rien ne peut
 *    donc se graver dans la video.
 * 2. **Aucune classe Tailwind.** Le bundle Remotion n'a pas la feuille de
 *    l'application : `uppercase` n'y produirait rien et le titre sortirait en
 *    minuscules. Tout est en style en ligne.
 *
 * Le sous-titre n'a AUCUN reglage propre : `drawIntro` lui impose la police,
 * la graisse, l'italique et l'interligne du titre, et sa couleur a 80 %. Lui
 * donner des controles ferait promettre a l'apercu ce que la video ne rendrait
 * pas.
 */

export interface TitleTypography {
  font: string;
  color: string;
  scale: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
}

export interface SubtitleTypography {
  font: string | null;
  color: string | null;
  scale: number;
}

export default function SequenceTitle({
  title,
  subtitle,
  typography,
  subtitleTypography,
  format,
  containerWidth,
  reveal = 1,
}: {
  title: string;
  subtitle?: string;
  typography: TitleTypography;
  subtitleTypography: SubtitleTypography;
  format: DesignFormat;
  /** Largeur VIDEO — la meme des deux cotes. */
  containerWidth: number;
  /**
   * Part du texte deja ecrite, de 0 a 1 — la machine a ecrire.
   *
   * La troncature se fait AVANT la mise en lignes : le retour a la ligne suit
   * donc la frappe, comme une vraie saisie. C'est ce que fait `drawIntro`, et
   * le sous-titre s'ecrit avec le titre.
   *
   * Defaut 1 : le texte entier, soit le rendu d'aujourd'hui.
   */
  reveal?: number;
}) {
  const vw = containerWidth;
  const weight = typography.bold ? 900 : 400;
  const style = typography.italic ? 'italic' : 'normal';
  const titleSize = vw * FONT_RATIO[format].title * typography.scale;
  const subSize = vw * FONT_RATIO[format].subtitle * typography.scale * subtitleTypography.scale;
  const subFamily = subtitleTypography.font || typography.font;
  const subColor = subtitleTypography.color || `${typography.color}CC`;

  return (
    <>
      <div
        style={{
          // `uppercase` de Tailwind — inutilisable hors de l'application.
          textTransform: 'uppercase',
          fontFamily: fontStack(typography.font),
          fontSize: titleSize,
          fontWeight: weight,
          fontStyle: style,
          letterSpacing: letterSpacingPx(typography.letterSpacing, vw),
          color: typography.color,
          lineHeight: typography.lineHeight,
          ...leadingTrim(titleSize, typography.lineHeight),
          filter: titleShadow(vw),
        }}
      >
        {revealText(title, reveal)}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: fontStack(subFamily),
            fontSize: subSize,
            // Graisse, italique et interligne restent ceux du titre.
            fontWeight: weight,
            fontStyle: style,
            color: subColor,
            lineHeight: typography.lineHeight,
            ...leadingTrim(subSize, typography.lineHeight),
            // `mt1` du compositeur, mesure depuis le BAS des glyphes du titre —
            // d'ou le retrait du demi-interligne.
            marginTop: vw * GAP_RATIO - ((typography.lineHeight - 1) * subSize) / 2,
            filter: subtitleShadow(vw),
          }}
        >
          {revealText(subtitle, reveal)}
        </div>
      )}
    </>
  );
}

/** Cadre du bloc de titre — ancre au bord GAUCHE et au bord HAUT. */
export function titleFrameStyle(position: { x: number; y: number }): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${position.x}%`,
    top: `${position.y}%`,
    width: `${TEXT_LAYOUT.titleWidth}%`,
    textAlign: 'left',
  };
}
