/**
 * Entrées du gel des formats larges (16:9 / 1:1) — `zones-sures-916-gel-larges.json`
 * a été capturé avec ces entrées sur 0e8de3f, AVANT les zones sûres 9:16.
 * Ne pas modifier : le gel ne serait plus comparable.
 */
export const GEL_DESIGNS: Record<string, Record<string, unknown>> = {
  sommeil: { title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL', subtitle: 'Et comment les corriger dès ce soir, sans médicament', ctaText: 'Réservez votre bilan sommeil gratuit sur afroboost.com', gradientEnd: '#EC4899' },
  court: { title: 'GO', subtitle: null, ctaText: 'GO', ctaSubText: 'lien en bio', titleScale: 1.2, ctaScale: 0.9, gradientEnd: '#123456' },
  vide: {},
};

export const GEL_PROFILS = ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'STANDARD', 'TUTORIAL_EDUCATION', null];

const carte = (i: number, titre: string, valeur: string) => ({ id: `c${i}`, icon: 'Zap', title: titre, value: valeur, description: '' });

export const GEL_CARTES = {
  une: [carte(1, 'Énergie', '+60%')],
  cinq: [
    carte(1, 'Énergie', '+60%'), carte(2, 'Cerveau boosté', '+15%'), carte(3, 'Mitochondries', '×2'),
    carte(4, 'Calories brûlées par séance', '600'), carte(5, 'Sommeil', '8 h'),
  ],
};

export const GEL_GENERATED = {
  court: { title: 'GO', subtitle: '', cards: GEL_CARTES.une, cta: 'GO', ctaSub: 'LIEN EN BIO' },
  long: {
    title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL ET VOTRE ÉNERGIE',
    subtitle: 'Et comment les corriger dès ce soir, sans médicament',
    cards: GEL_CARTES.cinq,
    cta: 'Réservez votre bilan sommeil gratuit sur afroboost.com',
    ctaSub: 'LIEN EN BIO',
  },
};

export const GEL_TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
