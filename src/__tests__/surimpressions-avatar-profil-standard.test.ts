/**
 * SURIMPRESSIONS DE L'AVATAR, PROFIL NON DYNAMIQUE.
 *
 * Avec l'avatar, l'Autopilote passe TOUJOURS ses textes en surimpression,
 * quel que soit le profil du thème. Rendu réel (thème « sommeil », profil
 * TUTORIAL_EDUCATION) avant correction : aucune mise en page — cartes en
 * bandeau de 2 % de haut au milieu de l'image (texte ≈ 10 px, contraste
 * mesuré < 3:1) et CTA à 92 %, dans la zone de description des réseaux.
 */
import { describe, it, expect } from 'vitest';
import { appliquerMiseEnPageSurimpression, miseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { PLATFORM_SAFE_ZONES } from '@/lib/constants/platforms';

const design = {
  title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL',
  subtitle: 'Et comment les corriger dès ce soir, sans médicament',
  ctaText: 'Réservez votre bilan sommeil gratuit sur afroboost.com',
  gradientEnd: '#EC4899',
};
// Cadre des cartes (`CARDS_FRAME`) : 30 %–78 % de la hauteur.
const carteHauteurImage = (b: { y: number; h: number }) => [0.30 + (b.y / 100) * 0.48, 0.30 + ((b.y + b.h) / 100) * 0.48];
// Bande de description la plus haute des réseaux (TikTok 22 %, YouTube 20 %…).
const BAS_UI = Math.max(...Object.values(PLATFORM_SAFE_ZONES).flatMap((p) => p.zones.filter((z) => z.bottom === '0%').map((z) => parseFloat(z.height)))) / 100;

describe.each(['TUTORIAL_EDUCATION', 'STANDARD', 'LIFESTYLE_BRAND', null])('profil %s (avatar en surimpression)', (profil) => {
  const d = appliquerMiseEnPageSurimpression({ ...design }, profil) as Record<string, any>;

  it('la mise en page est appliquée (positions, carte encadrée, panneau CTA)', () => {
    expect(d.titlePos).toEqual({ x: 8, y: 7 });
    expect(d.cardBoxes?.c0).toBeDefined();
    expect(d.cardBackground).toMatch(/^rgba\(0,0,0,0\.\d+\)$/);
    expect(d.ctaBackground).toMatch(/^rgba\(0,0,0,0\.\d+\)$/);
    expect(d.cardsTypography.scale).toBeGreaterThan(1);
  });

  it('carte au centre (règle éditoriale du profil), sous le visage, au-dessus de l’interface', () => {
    const [haut, bas] = carteHauteurImage(d.cardBoxes.c0);
    // Visage d'un avatar : tiers haut-milieu (≈ 17–39 % de la hauteur).
    expect(haut).toBeGreaterThan(0.42);
    expect(bas).toBeLessThan(1 - BAS_UI);
  });

  it('CTA hors de la zone de description des réseaux', () => {
    expect(d.ctaPos.y / 100).toBeLessThanOrEqual(1 - BAS_UI);
  });
});

it('Créer garde sa porte : hors profil dynamique, pas de surimpression', () => {
  expect(miseEnPageSurimpression('TUTORIAL_EDUCATION')).toBeNull();
  expect(miseEnPageSurimpression('CARDIO_DANCE')).not.toBeNull();
});
