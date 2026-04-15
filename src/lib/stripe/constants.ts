// Pricing tiers — 2026 revision
// Free / Starter 19€ / Pro 49€ (flagship) / Enterprise 149€
// Annual = 2 months free (~ -17%)

export const STRIPE_PLANS = {
  free: {
    name: 'Gratuit',
    price: 0,
    priceFr: '0€',
    yearlyPrice: 0,
    yearlyPriceFr: '0€',
    credits: 10,
    watermark: true,
    maxSocials: 1,
    features: [
      '10 crédits/mois (~1 vidéo)',
      'Toutes les fonctionnalités',
      'Watermark « Studiio » sur l\'export',
      '1 réseau social connecté',
      'Support communautaire',
    ],
  },
  starter: {
    name: 'Starter',
    price: 1900,
    priceFr: '19€',
    yearlyPrice: 1583,
    yearlyPriceFr: '15,83€',
    yearlyTotal: 19000,
    yearlyTotalFr: '190€',
    credits: 150,
    watermark: false,
    maxSocials: 3,
    features: [
      '150 crédits/mois (~15 vidéos)',
      'Pas de watermark',
      '3 réseaux sociaux',
      'Calendrier IA 7 jours',
      'Support email',
    ],
  },
  pro: {
    name: 'Pro',
    price: 4900,
    priceFr: '49€',
    yearlyPrice: 4083,
    yearlyPriceFr: '40,83€',
    yearlyTotal: 49000,
    yearlyTotalFr: '490€',
    credits: 600,
    watermark: false,
    maxSocials: Infinity,
    popular: true,
    features: [
      '600 crédits/mois (~60 vidéos)',
      'Réseaux sociaux illimités',
      'Calendrier IA 30 jours',
      'Voix off IA multi-langues',
      'Détection clips auto',
      'Batch x10',
      'Support prioritaire < 24h',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    price: 14900,
    priceFr: '149€',
    yearlyPrice: 12417,
    yearlyPriceFr: '124,17€',
    yearlyTotal: 149000,
    yearlyTotalFr: '1490€',
    credits: 2500,
    watermark: false,
    maxSocials: Infinity,
    features: [
      '2 500 crédits/mois',
      '5 sièges utilisateurs',
      'Accès API',
      'Custom branding',
      'Analytics avancés',
      'Account manager dédié',
      'Support 24/7',
    ],
  },
};

export const CREDIT_PACKAGES = {
  small: { name: '50 crédits', amount: 50, price: 900, priceFr: '9€', unitPrice: '0,18€/crédit' },
  medium: { name: '200 crédits', amount: 200, price: 2900, priceFr: '29€', unitPrice: '0,15€/crédit', popular: true },
  large: { name: '500 crédits', amount: 500, price: 5900, priceFr: '59€', unitPrice: '0,12€/crédit' },
  xlarge: { name: '2 000 crédits', amount: 2000, price: 17900, priceFr: '179€', unitPrice: '0,09€/crédit' },
};

export const RENDER_COSTS = { reel: 10, tv: 15 };
export const FREE_CREDITS = 10;

export function hasWatermark(plan: string | null | undefined): boolean {
  if (!plan || plan === 'free') return true;
  return false;
}
