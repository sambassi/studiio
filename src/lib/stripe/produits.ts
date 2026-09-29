/**
 * Produits Stripe de Studiio, par environnement (TEST / LIVE).
 *
 * Les constantes ci-dessous sont les produits LIVE du compte Afroboosteur
 * (CHF), identifiants NON secrets. Elles ne servent QUE si la clé secrète
 * est une clé live : sur staging (clé test), un id live n'existe pas et ne
 * doit jamais finir en base.
 *
 * Ordre de résolution d'un produit (cf. `lib/stripe/synchro`) :
 *   1. `stripe_product_id` en base (`plans` / `credit_packs`) — vérifié chez
 *      Stripe : son `livemode` doit correspondre au mode de la clé, sinon
 *      erreur (jamais remplacé en silence) ;
 *   2. variable serveur `STRIPE_PRODUCT_ID_<OFFRE>` ;
 *   3. constante LIVE ci-dessous, uniquement avec une clé live.
 * En mode test sans 1 ni 2 → erreur explicite par produit.
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

export type ModeStripe = 'test' | 'live';

/**
 * Mode de la clé secrète, déduit de son seul préfixe. La clé n'est jamais
 * incluse dans un message : l'erreur ne dit que ce qui est attendu.
 */
export function modeStripe(cle: string | undefined = process.env.STRIPE_SECRET_KEY): ModeStripe {
  const c = (cle ?? '').trim();
  if (/^(sk|rk)_test_/.test(c)) return 'test';
  if (/^(sk|rk)_live_/.test(c)) return 'live';
  throw new Error('STRIPE_SECRET_KEY absente ou de format inconnu (attendu sk_test_/rk_test_ ou sk_live_/rk_live_)');
}

/** Nom de la variable serveur d'un produit : STRIPE_PRODUCT_ID_PRO, STRIPE_PRODUCT_ID_PACK_SMALL… */
export function nomVariableProduit(table: 'plans' | 'credit_packs', key: string): string {
  return `STRIPE_PRODUCT_ID_${table === 'credit_packs' ? 'PACK_' : ''}${String(key).toUpperCase()}`;
}

export type SourceProduit = 'base' | 'variable' | 'constante';

/**
 * Produit à utiliser pour une offre, SANS appel Stripe (la cohérence du
 * `livemode` est vérifiée ensuite par l'appelant). `null` = rien d'utilisable
 * dans ce mode : l'erreur à afficher est dans `erreur`.
 */
export function resoudreProduit(
  table: 'plans' | 'credit_packs',
  key: string,
  valeurBase: string | null | undefined,
  mode: ModeStripe,
): { id: string; source: SourceProduit } | { id: null; erreur: string } {
  if (valeurBase && String(valeurBase).trim()) return { id: String(valeurBase).trim(), source: 'base' };
  const nom = nomVariableProduit(table, key);
  const v = process.env[nom];
  if (v && v.trim()) return { id: v.trim(), source: 'variable' };
  if (mode === 'live') {
    const constantes: Record<string, string> = table === 'plans' ? PRODUITS_STRIPE_PLANS : PRODUITS_STRIPE_PACKS;
    const id = constantes[key];
    if (id) return { id, source: 'constante' };
  }
  return {
    id: null,
    erreur: `aucun produit Stripe ${mode.toUpperCase()} configuré — configurez ${nom}`
      + (mode === 'test' ? ' (les produits LIVE codés en dur ne servent jamais avec une clé test)' : ''),
  };
}
