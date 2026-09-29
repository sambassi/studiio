/**
 * Résolution des prix Stripe — une seule source de vérité pour le checkout,
 * les packs, le webhook et l'administration.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA BASE FAIT AUTORITÉ, LES VARIABLES EN REPLI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les tarifs restent modifiables depuis l'administration
 * (`/api/admin/pricing/update-*`, `/api/admin/pricing/sync-stripe`) : les
 * colonnes `plans.stripe_price_id`, `plans.stripe_yearly_price_id`,
 * `credit_packs.stripe_price_id` et les montants/crédits de ces tables
 * passent EN PREMIER. Les variables `STRIPE_PRICE_ID_*` ne servent que si la
 * base n'a rien ; les constantes CHF (`STRIPE_PLANS`, `CREDIT_PACKAGES`) ne
 * servent que si la base est indisponible.
 *
 * Garde-fou : avant chaque checkout, le prix est relu chez Stripe et doit
 * être actif, en CHF, du bon intervalle et au MONTANT enregistré en base. Un
 * identifiant périmé (ancien compte, EUR) ou désaligné produit une erreur
 * lisible (503), jamais un paiement faux. Aucun `price_data` à la volée.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS, CREDIT_PACKAGES } from '@/lib/stripe/constants';
import { modeStripe } from '@/lib/stripe/produits';

export type PlanPayant = 'starter' | 'pro' | 'enterprise';
export type PlanKey = PlanPayant | 'free';
export type Cycle = 'monthly' | 'yearly';

export const PLANS_PAYANTS: readonly PlanPayant[] = ['starter', 'pro', 'enterprise'];
export const DEVISE = 'chf';
/** Marqueur posé sur toute session / tout abonnement créé par Studiio. */
export const MARQUEUR_APP = 'studiio';
export type PackKey = keyof typeof CREDIT_PACKAGES;
export const PACKS: readonly PackKey[] = Object.keys(CREDIT_PACKAGES) as PackKey[];

export function envPrixPlan(plan: PlanPayant, cycle: Cycle): string | undefined {
  const v = process.env[`STRIPE_PRICE_ID_${plan.toUpperCase()}_${cycle.toUpperCase()}`];
  return v && v.trim() ? v.trim() : undefined;
}

export function envPrixPack(pack: string): string | undefined {
  const v = process.env[`STRIPE_PRICE_ID_PACK_${String(pack).toUpperCase()}`];
  return v && v.trim() ? v.trim() : undefined;
}

/** Identifiant de prix d'un abonnement : base, puis variable ; `undefined` sinon. */
export async function prixPlan(plan: PlanPayant, cycle: Cycle): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin
      .from('plans').select('stripe_price_id, stripe_yearly_price_id').eq('key', plan).single();
    const id = cycle === 'yearly' ? data?.stripe_yearly_price_id : data?.stripe_price_id;
    if (id) return id;
  } catch {}
  return envPrixPlan(plan, cycle);
}

/** Identifiant de prix d'un pack : base, puis variable ; `undefined` sinon. */
export async function prixPack(pack: string): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin
      .from('credit_packs').select('stripe_price_id').eq('key', pack).single();
    if (data?.stripe_price_id) return data.stripe_price_id;
  } catch {}
  return envPrixPack(pack);
}

/**
 * Plan et cycle d'un identifiant de prix — base d'abord, variables ensuite.
 * `null` si le prix n'appartient à aucun plan payant connu.
 */
export async function planDepuisPrix(priceId: string | null | undefined): Promise<{ plan: PlanPayant; cycle: Cycle } | null> {
  if (!priceId) return null;
  try {
    const { data: m } = await supabaseAdmin.from('plans').select('key').eq('stripe_price_id', priceId).single();
    if (m?.key && PLANS_PAYANTS.includes(m.key)) return { plan: m.key as PlanPayant, cycle: 'monthly' };
    const { data: y } = await supabaseAdmin.from('plans').select('key').eq('stripe_yearly_price_id', priceId).single();
    if (y?.key && PLANS_PAYANTS.includes(y.key)) return { plan: y.key as PlanPayant, cycle: 'yearly' };
  } catch {}
  for (const plan of PLANS_PAYANTS) {
    for (const cycle of ['monthly', 'yearly'] as const) {
      if (envPrixPlan(plan, cycle) === priceId) return { plan, cycle };
    }
  }
  return null;
}

/** Pack d'un identifiant de prix — base d'abord, variables ensuite. */
export async function packDepuisPrix(priceId: string | null | undefined): Promise<PackKey | null> {
  if (!priceId) return null;
  try {
    const { data } = await supabaseAdmin.from('credit_packs').select('key').eq('stripe_price_id', priceId).single();
    if (data?.key && (PACKS as readonly string[]).includes(data.key)) return data.key as PackKey;
  } catch {}
  for (const pack of PACKS) if (envPrixPack(pack) === priceId) return pack;
  return null;
}

export interface OffrePlan { price_cents: number; yearly_price_cents: number; credits: number }
export interface OffrePack { price_cents: number; amount: number }

/** Offre d'un plan : base (éditée par l'admin), constantes CHF en repli. */
export async function offrePlan(plan: PlanPayant): Promise<OffrePlan> {
  const c = STRIPE_PLANS[plan];
  const repli: OffrePlan = { price_cents: c.price, yearly_price_cents: c.yearlyPrice, credits: c.credits };
  try {
    const { data } = await supabaseAdmin
      .from('plans').select('price_cents, yearly_price_cents, credits').eq('key', plan).single();
    if (data) {
      return {
        price_cents: typeof data.price_cents === 'number' ? data.price_cents : repli.price_cents,
        yearly_price_cents: typeof data.yearly_price_cents === 'number' ? data.yearly_price_cents : repli.yearly_price_cents,
        credits: typeof data.credits === 'number' ? data.credits : repli.credits,
      };
    }
  } catch {}
  return repli;
}

/** Offre d'un pack : base (éditée par l'admin), constantes CHF en repli. */
export async function offrePack(pack: PackKey): Promise<OffrePack> {
  const c = CREDIT_PACKAGES[pack];
  const repli: OffrePack = { price_cents: c.price, amount: c.amount };
  try {
    const { data } = await supabaseAdmin.from('credit_packs').select('price_cents, amount').eq('key', pack).single();
    if (data) {
      return {
        price_cents: typeof data.price_cents === 'number' ? data.price_cents : repli.price_cents,
        amount: typeof data.amount === 'number' ? data.amount : repli.amount,
      };
    }
  } catch {}
  return repli;
}

/**
 * Montant attendu chez Stripe pour un plan.
 *
 * Mensuel : `price_cents`, au centime. Annuel : la base stocke un
 * équivalent MENSUEL (`yearly_price_cents`, affiché « /mois ») ; le prix
 * Stripe est le total annuel. L'équivalent mensuel étant arrondi au centime
 * (190 / 12 = 15,83), on tolère l'écart d'arrondi : un demi-franc.
 */
export function montantAttenduPlan(offre: OffrePlan, cycle: Cycle): { montant: number; tolerance: number } {
  return cycle === 'yearly'
    ? { montant: offre.yearly_price_cents * 12, tolerance: 50 }
    : { montant: offre.price_cents, tolerance: 0 };
}

/**
 * Quota MENSUEL de crédits d'un plan : table `plans` (ce que la page de
 * tarifs affiche), repli sur `STRIPE_PLANS`. Le même nombre sert à
 * l'affichage et au crédit — un client ne doit pas lire 600 et recevoir 1000.
 */
export async function creditsMensuelsPlan(plan: PlanKey): Promise<number> {
  let mensuel = (STRIPE_PLANS as any)[plan]?.credits ?? 0;
  try {
    const { data } = await supabaseAdmin.from('plans').select('credits').eq('key', plan).single();
    if (typeof data?.credits === 'number' && data.credits > 0) mensuel = data.credits;
  } catch {}
  return mensuel;
}

/**
 * Crédits accordés par UNE facture d'abonnement payée.
 *
 * Règle annuelle : une facture annuelle couvre douze mois, elle crédite
 * douze quotas mensuels, en une fois. Stripe n'émet qu'une facture par an
 * pour un prix annuel : créditer « chaque mois » exigerait un planificateur
 * propre à Studiio, sans événement Stripe pour l'adosser — donc sans
 * référence idempotente naturelle. La facture, elle, en a une (`in_…`).
 */
export async function creditsPourFacture(plan: PlanKey, cycle: Cycle): Promise<number> {
  const mensuel = await creditsMensuelsPlan(plan);
  return cycle === 'yearly' ? mensuel * 12 : mensuel;
}

/**
 * Vérifie un prix auprès de Stripe avant d'ouvrir un checkout : du mode
 * (TEST/LIVE) de la clé, actif, en CHF, au montant enregistré en base, et du
 * bon type.
 */
export async function verifierPrix(
  stripe: { prices: { retrieve: (id: string) => Promise<any> } },
  priceId: string,
  attendu: { recurrent: 'month' | 'year' | null; montant: number; tolerance?: number },
): Promise<void> {
  let prix: any;
  try {
    prix = await stripe.prices.retrieve(priceId);
  } catch (e: any) {
    throw new ErreurPrix(`prix Stripe introuvable (${priceId}) : ${e?.message || 'erreur'}`);
  }
  let mode;
  try { mode = modeStripe(); } catch (e: any) { throw new ErreurPrix(e.message); }
  if (prix?.livemode !== (mode === 'live')) {
    throw new ErreurPrix(`prix Stripe ${prix?.livemode ? 'LIVE' : 'TEST'} alors que la clé est en mode ${mode} (${priceId})`);
  }
  if (!prix?.active) throw new ErreurPrix(`prix Stripe inactif (${priceId})`);
  if (String(prix.currency || '').toLowerCase() !== DEVISE) {
    throw new ErreurPrix(`prix Stripe en ${String(prix.currency || '?').toUpperCase()} au lieu de CHF (${priceId})`);
  }
  if (typeof prix.unit_amount !== 'number'
      || Math.abs(prix.unit_amount - attendu.montant) > (attendu.tolerance ?? 0)) {
    throw new ErreurPrix(`prix Stripe à ${prix.unit_amount} centimes au lieu de ${attendu.montant} (${priceId})`);
  }
  const intervalle = prix.recurring?.interval ?? null;
  if (attendu.recurrent === null && intervalle) {
    throw new ErreurPrix(`prix Stripe récurrent pour un paiement unique (${priceId})`);
  }
  if (attendu.recurrent && intervalle !== attendu.recurrent) {
    throw new ErreurPrix(`prix Stripe à intervalle « ${intervalle ?? 'aucun'} » au lieu de « ${attendu.recurrent} » (${priceId})`);
  }
}

export class ErreurPrix extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurPrix';
  }
}
