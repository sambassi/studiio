/**
 * Plateau de Créer (photo des surimpressions) : la police choisie (Anton…)
 * entre dans les ajustements comme dans l'Autopilote — aperçu = rendu.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';
import { appliquerMiseEnPageSurimpression, miseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO, VIDEO_SIZE } from '@/lib/creer/designSpec';

type Props = React.ComponentProps<typeof PlateauSurimpression>;
const TITRE = 'TRANSFORMATION EXTRAORDINAIRE PERSONNELLE';
const CTA = 'RÉSERVEZ VOTRE BILAN GRATUITEMENT';
const SOUS = 'AFROBOOST.COM/RESERVATION';

describe.each(['9:16', '16:9', '1:1'] as const)('PlateauSurimpression %s : parité Autopilote avec Anton', (format) => {
  const { w: W, h: H } = VIDEO_SIZE[format];
  const design = { format, title: TITRE, titleScale: 1.6, titleFont: 'Anton', ctaText: CTA, ctaSubText: SOUS, ctaScale: 1.4, ctaFont: 'Anton' };
  const auto = appliquerMiseEnPageSurimpression(design as never, 'CARDIO_DANCE', { format }) as { titleScale: number; ctaScale: number };
  const m = miseEnPageSurimpression('CARDIO_DANCE', { format })!;
  const base = (font: string) => ({
    miseEnPage: m, format, largeur: W, hauteur: H,
    titre: { title: TITRE, typography: { font, color: '#FFFFFF', scale: 1.6, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 }, subtitleTypography: { font: null, color: null, scale: 1 } },
    cartes: { cards: [], valueColor: '#EC4899' },
    cta: { text: CTA, subText: SOUS, typography: { font, color: '#FFFFFF', subColor: '#EC4899', scale: 1.4, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } },
  });
  it('titre et CTA : même échelle que l\'Autopilote', () => {
    const titre = renderToStaticMarkup(<PlateauSurimpression {...(base('Anton') as unknown as Props)} element="titre" />);
    const cta = renderToStaticMarkup(<PlateauSurimpression {...(base('Anton') as unknown as Props)} element="cta" />);
    const px = (r: string) => Number(/font-size:([\d.]+)px/.exec(r)![1]);
    expect(px(titre)).toBeCloseTo(W * FONT_RATIO[format].title * auto.titleScale, 6);
    expect(px(cta)).toBeCloseTo(W * FONT_RATIO[format].cta * auto.ctaScale, 6);
  });
  it('la police compte : Anton (étroite) n\'est pas réduite comme Inter', () => {
    const anton = renderToStaticMarkup(<PlateauSurimpression {...(base('Anton') as unknown as Props)} element="titre" />);
    const inter = renderToStaticMarkup(<PlateauSurimpression {...(base('Inter') as unknown as Props)} element="titre" />);
    const [pa, pi] = [anton, inter].map((h) => Number(/font-size:([\d.]+)px/.exec(h)![1]));
    // Même nombre de lignes : à un pas de réduction près (× 0,95) ; colonne
    // étroite du 16:9 (mot le plus long limitant) : Anton nettement plus grand.
    expect(pa).toBeGreaterThanOrEqual(pi * 0.95);
    if (format === '16:9') expect(pa).toBeGreaterThan(pi * 1.2);
  });
});
