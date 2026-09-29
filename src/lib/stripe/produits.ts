/**
 * Produits Stripe de Studiio sur le compte Afroboosteur (CHF).
 *
 * Identifiants NON secrets, fixés par l'utilisateur. Ils servent à la
 * synchronisation admin (`/api/admin/pricing/sync-stripe`) pour retrouver
 * les prix actifs de chaque offre. Si `stripe_product_id` est renseigné en
 * base, il prime sur cette table.
 */
export const PRODUITS_STRIPE_PLANS = {
  starter: 'prod_VLezeEJ6uMn9Vh',
  pro: 'prod_VLezRDxwaE68aY',
  enterprise: 'prod_VLf0F1E9Grlo90',
} as const;

export const PRODUITS_STRIPE_PACKS = {
  small: 'prod_VLf3qwEqAXZvib',   // 50 crédits
  medium: 'prod_VLfNf3G0ghsVoG',  // 200 crédits
  large: 'prod_VLfNrpJ8UK0saJ',   // 500 crédits
  xlarge: 'prod_VLfO0RN4SciK62',  // 2 000 crédits
} as const;
