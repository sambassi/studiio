import { STRIPE_PLANS } from '@/lib/stripe/constants';

/**
 * Plan choisi sur la landing, transporté par `?plan=` jusqu'à la facturation.
 *
 * Le paramètre vient de l'URL : il n'est JAMAIS recopié tel quel dans une
 * redirection. Il est ramené à une clé connue (liste fermée) ou rejeté, ce qui
 * interdit toute redirection ouverte ou injection dans le `callbackUrl`.
 *
 * Seuls les plans payants sont retenus : « free » ne mène à aucun paiement.
 */
export const PLANS_PAYANTS = ['starter', 'pro', 'enterprise'] as const;
export type PlanPayant = (typeof PLANS_PAYANTS)[number];
export type CycleFacturation = 'monthly' | 'yearly';

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

/**
 * Ramène `?plan=` à une clé de plan payant, ou `null`.
 * La landing construit le slug depuis le NOM affiché du plan : on accepte la
 * clé (`pro`) comme le slug du nom (`Pro`), rien d'autre.
 */
export function normaliserPlan(brut: string | null | undefined): PlanPayant | null {
  if (typeof brut !== 'string' || brut.length === 0 || brut.length > 40) return null;
  const s = slug(brut);
  for (const cle of PLANS_PAYANTS) {
    if (s === cle || s === slug(STRIPE_PLANS[cle].name)) return cle;
  }
  return null;
}

export function normaliserFacturation(brut: string | null | undefined): CycleFacturation {
  return brut === 'yearly' ? 'yearly' : 'monthly';
}

/**
 * Destination après inscription ou connexion : la page de facturation avec le
 * plan présélectionné si le plan est connu, sinon le tableau de bord.
 * L'URL est TOUJOURS relative et construite depuis la liste fermée.
 */
export function destinationApresConnexion(
  planBrut: string | null | undefined,
  facturationBrute: string | null | undefined,
): string {
  const plan = normaliserPlan(planBrut);
  if (!plan) return '/dashboard';
  return `/dashboard/billing?plan=${plan}&billing=${normaliserFacturation(facturationBrute)}`;
}

/** Résumé public d'un plan, lu dans les constantes (aucun secret, aucun appel réseau). */
export function resumePlan(plan: PlanPayant) {
  const p = STRIPE_PLANS[plan];
  return {
    cle: plan,
    nom: p.name,
    credits: p.credits,
    prixMensuelCentimes: p.price,
    prixAnnuelMensuelCentimes: p.yearlyPrice,
    features: [...p.features],
  };
}

/** Même format que la landing et `PricingCards` : « 19 », « 15,83 ». */
export function centimesEnFrancs(centimes: number): string {
  if (!centimes) return '0';
  const francs = centimes / 100;
  return francs % 1 === 0 ? String(francs) : francs.toFixed(2).replace('.', ',');
}
