export const STRIPE_PLANS = {
  starter: {
    name: 'Starter',
    price: 2999,
    priceFr: '29,99€',
    yearlyPrice: 2499,
    yearlyPriceFr: '24,99€',
    credits: 300,
    features: [
      '300 crédits/mois',
      'Vidéos illimitées',
      'Formats Reel + TV',
      'Calendrier éditorial',
      'Publication Instagram',
      'Support email',
    ],
  },
  pro: {
    name: 'Pro',
    price: 7999,
    priceFr: '79,99€',
    yearlyPrice: 6699,
    yearlyPriceFr: '66,99€',
    credits: 1000,
    features: [
      '1 000 crédits/mois',
      'Vidéos illimitées',
      'Tous les formats + Batch x10',
      'Calendrier IA + Agent autonome',
      'Publication multi-réseaux',
      'Voix off IA',
      'Objectifs personnalisés',
      'Support prioritaire 24h',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    price: 29999,
    priceFr: '299,99€',
    yearlyPrice: 24999,
    yearlyPriceFr: '249,99€',
    credits: 5000,
    features: [
      '5 000 crédits/mois',
      'Utilisateurs illimités',
      'Accès API',
      'Batch illimité',
      'Marque blanche',
      'Analytics avancés',
      'Account manager dédié',
      'Support 24/7',
    ],
  },
};

export const CREDIT_PACKAGES = {
  small: {
    name: '50 crédits',
    amount: 50,
    price: 999,
    priceFr: '9,99€',
  },
  medium: {
    name: '150 crédits',
    amount: 150,
    price: 1999,
    priceFr: '19,99€',
  },
  large: {
    name: '500 crédits',
    amount: 500,
    price: 4999,
    priceFr: '49,99€',
  },
};

export const RUTERG_COSTS = {
  reel: 10,
  tv: 15,
};

export const FREE_CREDITS = 10;
