'use client';

/**
 * PLATEAU DE SURIMPRESSION — UN texte (titre, carte ou CTA) sur un cadre
 * vidéo TRANSPARENT, à la taille du montage.
 *
 * Mêmes composants que la composition Remotion (`SequenceTitle`,
 * `SequenceCards`, `SequenceCta`) et même mise en page partagée
 * (`surimpressions-mise-en-page.ts`) : Créer photographie ce plateau, le
 * compositeur pose la photo sur le rush exactement comme l'Autopilote pose
 * les images fixes du rendu hybride.
 */
import React from 'react';
import SequenceTitle, { titleFrameStyle, type TitleTypography, type SubtitleTypography } from '@/components/creer/SequenceTitle';
import SequenceCards, { type CardsTypography } from '@/components/creer/SequenceCards';
import SequenceCta, { ctaFrameStyle, type CtaTypography } from '@/components/creer/SequenceCta';
import { eclaircir, ajusterAccroche, ajusterCta, type MiseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO, TEXT_LAYOUT } from '@/lib/creer/designSpec';
import type { DesignFormat } from '@/lib/creer/designSpec';

export type ElementSurimpression = 'titre' | 'cta' | { carte: number };

export interface PlateauSurimpressionProps {
  element: ElementSurimpression;
  miseEnPage: MiseEnPageSurimpression;
  format: DesignFormat;
  largeur: number;
  hauteur: number;
  titre: { title: string; subtitle?: string; typography: TitleTypography; subtitleTypography: SubtitleTypography };
  cartes: {
    cards: Array<{ icon?: string; title?: string; value?: string }>;
    cardStyle?: string;
    typography?: CardsTypography;
    valueColor: string;
  };
  cta: { text: string; subText?: string; typography: CtaTypography };
}

export const PlateauSurimpression = React.forwardRef<HTMLDivElement, PlateauSurimpressionProps>(function PlateauSurimpression(p, ref) {
  const m = p.miseEnPage;
  const e = p.element;
  const carte = typeof e === 'object' ? p.cartes.cards[e.carte] : null;
  // Accroche bornée en hauteur (#502) — la MÊME règle que l'Autopilote.
  const accroche = ajusterAccroche({
    titre: p.titre.title, sousTitre: p.titre.subtitle ?? null,
    echelleTitre: (p.titre.typography.scale ?? 1) * m.titleScale,
    echelleSousTitre: (p.titre.subtitleTypography.scale ?? 1) * m.subtitleScale,
    largeur: p.largeur, hauteur: p.hauteur,
    ratioTitre: FONT_RATIO[p.format].title, ratioSousTitre: FONT_RATIO[p.format].subtitle,
    partLargeur: TEXT_LAYOUT.titleWidth / 100, interligneTitre: p.titre.typography.lineHeight,
  });
  return (
    <div ref={ref} style={{ position: 'relative', width: p.largeur, height: p.hauteur, background: 'transparent', overflow: 'hidden' }}>
      {e === 'titre' && (
        <div style={titleFrameStyle(m.titlePos)}>
          <SequenceTitle
            title={p.titre.title}
            subtitle={p.titre.subtitle}
            typography={{ ...p.titre.typography, scale: accroche.echelleTitre }}
            subtitleTypography={{ ...p.titre.subtitleTypography, scale: accroche.echelleSousTitre }}
            format={p.format}
            containerWidth={p.largeur}
          />
        </div>
      )}
      {carte && (
        <SequenceCards
          cards={[{ id: 'c0', icon: carte.icon ?? 'Sparkles', title: carte.title ?? '', value: carte.value }]}
          cardBoxes={{ c0: m.carte }}
          containerWidth={p.largeur}
          landscape={p.format !== '9:16'}
          valueColor={eclaircir(p.cartes.valueColor, m.valeurEclaircie) ?? p.cartes.valueColor}
          cardStyle={p.cartes.cardStyle}
          typography={{ ...(p.cartes.typography ?? {}), scale: (p.cartes.typography?.scale ?? 1) * m.carteScale }}
          fond={m.carteFond}
        />
      )}
      {e === 'cta' && (
        <div style={ctaFrameStyle(m.ctaPos)}>
          <SequenceCta
            text={p.cta.text}
            subText={p.cta.subText}
            typography={{
              ...p.cta.typography,
              // #504 : le mot le plus long (URL) tient entier — jamais coupé.
              scale: ajusterCta({
                texte: p.cta.text, sousTexte: p.cta.subText ?? null, echelle: (p.cta.typography.scale ?? 1) * m.ctaScale, largeur: p.largeur,
                ratioTexte: FONT_RATIO[p.format].cta, ratioSousTexte: FONT_RATIO[p.format].ctaSub, panneau: true,
              }),
              // Sur le panneau sombre : la ligne d'action éclaircie (contraste, #502).
              subColor: eclaircir(p.cta.typography.subColor, m.ctaActionEclaircie) ?? p.cta.typography.subColor,
            }}
            format={p.format}
            containerWidth={p.largeur}
            fond={m.ctaFond}
          />
        </div>
      )}
    </div>
  );
});
