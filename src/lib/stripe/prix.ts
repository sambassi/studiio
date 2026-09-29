/**
 * Résolution des prix Stripe — une seule source de vérité pour le checkout,
 * les packs et le webhook.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRIORITÉ : VARIABLES D'ENVIRONNEMENT, PUIS BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le lancement se fait sur un compte Stripe NEUF (Afroboosteur, CHF). Les
 * identifiants de prix de ce compte ne sont posés que dans les variables
 * `STRIPE_PRICE_ID_*` (Coolify). Les colonnes `plans.stripe_price_id`,
 * `plans.stripe_yearly_price_id` et `credit_packs.stripe_price_id` peuvent
 * encore contenir des identifiants de l'ancien compte (EUR) : lues en
 * premier, elles prendraient le dessus en silence.
 *
 * La base reste un REPLI, pour l'éditeur de tarifs de l'administration
 * (`/api/admin/pricing/update-*`) quand aucune variable n'est posée.
 *
 * Aucun `price_data` n'est jamais fabriqué à la volée : sans identifiant, le
 * checkout échoue avec un message explicite. Un prix faux est pire qu'une
 * erreur.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS } from '@/lib/stripe/constants';

export type PlanPayant = 'starter' | 'pro' | 'enterprise';
export type PlanKey = PlanPayant | 'free';
export type Cycle = 'monthly' | 'yearly';

export const PLANS_PAYANTS: readonly PlanPayant[] = ['starter', 'pro', 'enterprise'];
export const DEVISE = 'chf';

export function envPrixPlan(plan: PlanPayant, cycle: Cycle): string | undefined {
  const v = process.env[`STRIPE_PRICE_ID_${plan.toUpperCase()}_${cycle.toUpperCase()}`];
  return v && v.trim() ? v.trim() : undefined;
}

export function envPrixPack(pack: string): string | undefined {
  const v = process.env[`STRIPE_PRICE_ID_PACK_${String(pack).toUpperCase()}`];
  return v && v.trim() ? v.trim() : undefined;
}

/** Identifiant de prix d'un abonnement, ou `undefined` s'il n'est configuré nulle part. */
export async function prixPlan(plan: PlanPayant, cycle: Cycle): Promise<string | undefined> {
  const env = envPrixPlan(plan, cycle);
  if (env) return env;
  try {
    const { data } = await supabaseAdmin
      .from('plans').select('stripe_price_id, stripe_yearly_price_id').eq('key', plan).single();
    const id = cycle === 'yearly' ? data?.stripe_yearly_price_id : data?.stripe_price_id;
    return id || undefined;
  } catch {
    return undefined;
  }
}

/** Identifiant de prix d'un pack, ou `undefined` s'il n'est configuré nulle part. */
export async function prixPack(pack: string): Promise<string | undefined> {
  const env = envPrixPack(pack);
  if (env) return env;
  try {
    const { data } = await supabaseAdmin
      .from('credit_packs').select('stripe_price_id').eq('key', pack).single();
    return data?.stripe_price_id || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Plan et cycle d'un identifiant de prix — variables d'abord, base ensuite.
 * `null` si le prix n'appartient à aucun plan connu.
 */
export async function planDepuisPrix(priceId: string | null | undefined): Promise<{ plan: PlanPayant; cycle: Cycle } | null> {
  if (!priceId) return null;
  for (const plan of PLANS_PAYANTS) {
    for (const cycle of ['monthly', 'yearly'] as const) {
      if (envPrixPlan(plan, cycle) === priceId) return { plan, cycle };
    }
  }
  try {
    const { data: m } = await supabaseAdmin.from('plans').select('key').eq('stripe_price_id', priceId).single();
    if (m?.key && PLANS_PAYANTS.includes(m.key)) return { plan: m.key as PlanPayant, cycle: 'monthly' };
    const { data: y } = await supabaseAdmin.from('plans').select('key').eq('stripe_yearly_price_id', priceId).single();
    if (y?.key && PLANS_PAYANTS.includes(y.key)) return { plan: y.key as PlanPayant, cycle: 'yearly' };
  } catch {}
  return null;
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
 * Vérifie un prix auprès de Stripe avant d'ouvrir un checkout : actif, en
 * CHF, et du bon type. Un identifiant périmé (ancien compte, EUR) produit
 * une erreur lisible au lieu d'un paiement dans la mauvaise devise.
 */
export async function verifierPrix(
  stripe: { prices: { retrieve: (id: string) => Promise<any> } },
  priceId: string,
  attendu: { recurrent: 'month' | 'year' | null },
): Promise<void> {
  let prix: any;
  try {
    prix = await stripe.prices.retrieve(priceId);
  } catch (e: any) {
    throw new ErreurPrix(`prix Stripe introuvable (${priceId}) : ${e?.message || 'erreur'}`);
  }
  if (!prix?.active) throw new ErreurPrix(`prix Stripe inactif (${priceId})`);
  if (String(prix.currency || '').toLowerCase() !== DEVISE) {
    throw new ErreurPrix(`prix Stripe en ${String(prix.currency || '?').toUpperCase()} au lieu de CHF (${priceId})`);
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
