/**
 * Traitement métier des événements Stripe — appelé par
 * `/api/stripe/webhook` APRÈS la réclamation de l'événement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUI CRÉDITE QUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   Pack (checkout `mode=payment`)   → `stripe:cs:<cs_…>`
 *   Facture d'abonnement payée       → `stripe:in:<in_…>`
 *     - `subscription_create` (premier mois / première année)
 *     - `subscription_cycle`  (renouvellement)
 *
 * La référence est la clé de l'index unique `(user_id, reference_id)` :
 * chaque paiement Stripe crédite une fois, quel que soit le nombre
 * d'événements qui le décrivent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ORDRE DES ÉVÉNEMENTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Stripe ne garantit aucun ordre. Le premier paiement d'un abonnement est
 * décrit DEUX fois : `checkout.session.completed` (qui porte `invoice`) et
 * `invoice.payment_succeeded` (`subscription_create`). Les deux créditent
 * sous la MÊME référence `stripe:in:<in_…>` : le premier arrivé
 * crédite, le second ne fait rien. Aucun des deux n'a besoin que l'autre
 * soit passé avant lui.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RENOUVELLEMENT : AJOUT, PLUS REMPLACEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'ancien code REMPLAÇAIT le solde par le quota du plan à chaque
 * renouvellement : les packs achetés (payés comptant) disparaissaient, et
 * le journal (`+600`) ne correspondait plus au mouvement réel du solde. Le
 * quota est désormais AJOUTÉ, comme au premier mois et comme un pack.
 *
 * Toute erreur LÈVE : le webhook marque l'événement en échec et répond 500,
 * Stripe rejoue. Rien n'est marqué traité tant que tout n'a pas réussi.
 */
import { supabaseAdmin as db } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';
import { crediterIdempotent } from '@/lib/credits/crediter';
import { sendPaymentReceiptDirect, notifyAdminSale } from '@/lib/email/notifications';
import {
  planDepuisPrix, creditsPourFacture, PLANS_PAYANTS,
  type Cycle, type PlanPayant,
} from '@/lib/stripe/prix';

/** Statuts d'abonnement qui ouvrent les droits du plan. */
const STATUTS_ACTIFS = new Set(['active', 'trialing']);
/** Raisons de facture qui créditent le quota du plan. */
const FACTURES_CREDITEES = new Set(['subscription_create', 'subscription_cycle']);

export const referenceFacture = (invoiceId: string) => `stripe:in:${invoiceId}`;
export const referenceCheckout = (sessionId: string) => `stripe:cs:${sessionId}`;

export class ErreurTraitement extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurTraitement';
  }
}

// ── Lecteurs tolérants (API 2023-10-16 d'abord, formes récentes en repli) ──

const idDe = (v: any): string | undefined =>
  typeof v === 'string' ? v : (v && typeof v.id === 'string' ? v.id : undefined);

export function abonnementDeFacture(inv: any): string | undefined {
  return idDe(inv?.subscription) ?? idDe(inv?.parent?.subscription_details?.subscription);
}

function metadataAbonnementDeFacture(inv: any): Record<string, string> {
  return inv?.subscription_details?.metadata
    ?? inv?.parent?.subscription_details?.metadata
    ?? {};
}

function ligneAbonnement(inv: any): any {
  const lignes: any[] = inv?.lines?.data ?? [];
  return lignes.find((l) => l?.type === 'subscription' || l?.price?.recurring || l?.pricing?.price_details) ?? lignes[0];
}

function prixDeLigne(l: any): string | undefined {
  return idDe(l?.price) ?? l?.pricing?.price_details?.price ?? undefined;
}

function cycleDeLigne(l: any): Cycle | undefined {
  const iv = l?.price?.recurring?.interval;
  if (iv === 'year') return 'yearly';
  if (iv === 'month') return 'monthly';
  return undefined;
}

export function finDePeriode(sub: any): string | null {
  const s = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null;
}

const estPlanPayant = (p: unknown): p is PlanPayant =>
  typeof p === 'string' && (PLANS_PAYANTS as readonly string[]).includes(p);
const estCycle = (c: unknown): c is Cycle => c === 'monthly' || c === 'yearly';

// ── Résolution de l'utilisateur ─────────────────────────────────────────

async function ligneAbonnementEnBase(subId: string | undefined): Promise<{ user_id?: string; plan?: string } | null> {
  if (!subId) return null;
  try {
    const { data } = await db.from('subscriptions').select('user_id, plan').eq('stripe_subscription_id', subId).single();
    return data ?? null;
  } catch {
    return null;
  }
}

async function utilisateurParClient(customerId: string | undefined): Promise<string | undefined> {
  if (!customerId) return undefined;
  try {
    const { data } = await db.from('users').select('id').eq('stripe_customer_id', customerId).single();
    return data?.id || undefined;
  } catch {
    return undefined;
  }
}

async function recupererAbonnement(subId: string | undefined): Promise<any | null> {
  if (!subId) return null;
  try {
    return await stripe.subscriptions.retrieve(subId);
  } catch (e: any) {
    console.warn('[webhook] subscriptions.retrieve', subId, e?.message);
    return null;
  }
}

// ── Checkout ─────────────────────────────────────────────────────────────

async function checkoutTermine(cs: any): Promise<void> {
  const md = cs.metadata || {};
  const userId: string | undefined = md.userId;

  if (cs.mode === 'payment') {
    if (!userId) {
      console.warn('[webhook] checkout paiement sans userId (hors Studiio ?)', cs.id);
    } else if (cs.payment_status !== 'paid') {
      // Moyens de paiement asynchrones : non activés (carte seule). Sans
      // paiement encaissé, rien n'est crédité.
      console.warn('[webhook] checkout paiement non encaisse', cs.id, cs.payment_status);
    } else {
      const montant = Number.parseInt(String(md.creditAmount ?? ''), 10);
      if (!Number.isInteger(montant) || montant <= 0) {
        throw new ErreurTraitement(`pack sans creditAmount valide (${cs.id})`);
      }
      await crediterIdempotent({
        userId, montant, type: 'purchase',
        reference: referenceCheckout(cs.id),
        description: `pack ${md.packKey ?? '?'} (${cs.id})`,
      });
    }
  } else if (cs.mode === 'subscription' && userId && estPlanPayant(md.plan)) {
    const plan = md.plan;
    const subId = idDe(cs.subscription);
    const sub = await recupererAbonnement(subId);
    const statut = sub?.status ?? 'active';

    if (STATUTS_ACTIFS.has(statut)) {
      const { error } = await db.from('users').update({ plan }).eq('id', userId);
      if (error) throw new ErreurTraitement(`users.plan : ${error.message}`);
    }
    if (subId) {
      const ligne: Record<string, unknown> = {
        user_id: userId, plan, status: statut,
        stripe_subscription_id: subId,
        stripe_customer_id: idDe(cs.customer) ?? null,
        updated_at: new Date().toISOString(),
      };
      const fin = finDePeriode(sub);
      if (fin) ligne.current_period_end = fin;
      const { error } = await db.from('subscriptions').upsert(ligne, { onConflict: 'stripe_subscription_id' });
      if (error) throw new ErreurTraitement(`subscriptions : ${error.message}`);
    }

    // Premier paiement : crédité ICI si la facture n'est pas encore passée.
    // Même référence que `invoice.payment_succeeded` → jamais deux fois.
    const invoiceId = idDe(cs.invoice);
    if (invoiceId && cs.payment_status === 'paid') {
      const cycle: Cycle = estCycle(md.billingCycle) ? md.billingCycle : 'monthly';
      const montant = await creditsPourFacture(plan, cycle);
      if (montant > 0) {
        await crediterIdempotent({
          userId, montant, type: 'subscription',
          reference: referenceFacture(invoiceId),
          description: `abonnement ${plan} ${cycle} (${invoiceId})`,
        });
      }
    }
  }

  // Reçu + alerte admin : hors chemin critique, jamais attendus, envoyés
  // APRÈS toutes les écritures. Un événement n'est rejoué qu'après un échec
  // (écriture ou clôture) : seul un échec de `stripe_event_complete`, après
  // réussite de tout le reste, peut renvoyer un second reçu.
  if (cs.customer_details?.email) {
    const devise = String(cs.currency || 'chf').toUpperCase();
    const montantPaye = (cs.amount_total || 0) / 100;
    const credits = md.creditAmount ? parseInt(md.creditAmount, 10) || 0 : 0;
    try {
      void sendPaymentReceiptDirect(cs.customer_details.email, {
        orderId: cs.id,
        amount: montantPaye,
        date: new Date((cs.created || Date.now() / 1000) * 1000).toISOString(),
        creditsAmount: credits,
        planName: md.plan || 'Plan',
        currency: devise,
        customerName: cs.customer_details?.name || 'Utilisateur',
      }).catch(() => {});
      void notifyAdminSale({
        customerName: cs.customer_details?.name || 'Client',
        customerEmail: cs.customer_details.email,
        planName: md.plan || 'Plan',
        amount: montantPaye,
        timestamp: new Date().toISOString(),
        currency: devise,
        creditsAmount: credits,
      }).catch(() => {});
    } catch (e: any) {
      console.warn('[webhook] notification', e?.message);
    }
  }
}

// ── Facture payée ────────────────────────────────────────────────────────

async function facturePayee(inv: any): Promise<void> {
  const raison = inv.billing_reason;
  if (!FACTURES_CREDITEES.has(raison)) {
    // subscription_update (changement de plan en cours de période), manual…
    console.info('[webhook] facture non creditee', inv.id, raison);
    return;
  }
  if (!inv.id) throw new ErreurTraitement('facture sans id');

  const subId = abonnementDeFacture(inv);
  const meta = metadataAbonnementDeFacture(inv);
  const enBase = await ligneAbonnementEnBase(subId);
  const ligne = ligneAbonnement(inv);

  // Utilisateur : metadata de l'abonnement (facture, puis abonnement chez
  // Stripe), ligne `subscriptions`, et `users.stripe_customer_id` en tout
  // dernier repli (colonne sans migration historique, cf. #472).
  let userId: string | undefined = meta.userId || enBase?.user_id;
  let sub: any = null;
  if (!userId) {
    sub = await recupererAbonnement(subId);
    userId = sub?.metadata?.userId || undefined;
  }
  if (!userId) userId = await utilisateurParClient(idDe(inv.customer));
  if (!userId) {
    // Levée volontaire : l'événement passe en échec, Stripe rejoue — le
    // checkout ou la ligne `subscriptions` l'auront résolu d'ici là.
    throw new ErreurTraitement(`facture ${inv.id} : utilisateur introuvable`);
  }

  // Plan et cycle : le PRIX facturé fait foi, les metadata en repli.
  const depuisPrix = await planDepuisPrix(prixDeLigne(ligne));
  const plan = depuisPrix?.plan
    ?? (estPlanPayant(meta.plan) ? meta.plan : undefined)
    ?? (estPlanPayant(enBase?.plan) ? enBase!.plan as PlanPayant : undefined)
    ?? (estPlanPayant(sub?.metadata?.plan) ? sub.metadata.plan : undefined);
  const cycle: Cycle = depuisPrix?.cycle
    ?? cycleDeLigne(ligne)
    ?? (estCycle(meta.billingCycle) ? meta.billingCycle : 'monthly');
  if (!plan) throw new ErreurTraitement(`facture ${inv.id} : plan introuvable`);

  const montant = await creditsPourFacture(plan, cycle);
  if (montant <= 0) throw new ErreurTraitement(`facture ${inv.id} : quota nul pour ${plan}`);

  await crediterIdempotent({
    userId, montant, type: 'subscription',
    reference: referenceFacture(inv.id),
    description: `abonnement ${plan} ${cycle} ${raison} (${inv.id})`,
  });
}

// ── Abonnement ───────────────────────────────────────────────────────────

async function abonnementMisAJour(recu: any): Promise<void> {
  // L'état COURANT chez Stripe, pas celui du message : un événement ancien
  // relivré après un plus récent ne doit pas réécrire un statut périmé.
  const sub = (await recupererAbonnement(recu.id)) ?? recu;
  const enBase = await ligneAbonnementEnBase(sub.id);
  const userId: string | undefined = sub.metadata?.userId || enBase?.user_id || await utilisateurParClient(idDe(sub.customer));
  const item = sub.items?.data?.[0];
  const resolu = await planDepuisPrix(idDe(item?.price));
  const plan = resolu?.plan ?? (estPlanPayant(sub.metadata?.plan) ? sub.metadata.plan : undefined);
  if (!userId || !plan) {
    console.warn('[webhook] subscription.updated non resolu', sub.id, { user: !!userId, plan });
    return;
  }
  // Le plan n'ouvre ses droits que si l'abonnement est actif : un
  // `incomplete` ou `past_due` ne promeut personne.
  if (STATUTS_ACTIFS.has(sub.status)) {
    const { error } = await db.from('users').update({ plan }).eq('id', userId);
    if (error) throw new ErreurTraitement(`users.plan : ${error.message}`);
  }
  const ligne: Record<string, unknown> = {
    user_id: userId, plan, status: sub.status,
    stripe_subscription_id: sub.id,
    stripe_customer_id: idDe(sub.customer) ?? null,
    updated_at: new Date().toISOString(),
  };
  const fin = finDePeriode(sub);
  if (fin) ligne.current_period_end = fin;
  const { error } = await db.from('subscriptions').upsert(ligne, { onConflict: 'stripe_subscription_id' });
  if (error) throw new ErreurTraitement(`subscriptions : ${error.message}`);
}

async function abonnementSupprime(sub: any): Promise<void> {
  const enBase = await ligneAbonnementEnBase(sub.id);
  const userId: string | undefined = sub.metadata?.userId || enBase?.user_id;
  if (userId) {
    // Un autre abonnement actif du même compte garde ses droits : la
    // suppression tardive d'un ancien abonnement ne rétrograde personne.
    const { data: autres } = await db.from('subscriptions').select('stripe_subscription_id, status').eq('user_id', userId);
    const autreActif = (autres ?? []).some((a: any) => a.stripe_subscription_id !== sub.id && STATUTS_ACTIFS.has(a.status));
    if (!autreActif) {
      const { error } = await db.from('users').update({ plan: 'free' }).eq('id', userId);
      if (error) throw new ErreurTraitement(`users.plan : ${error.message}`);
    }
  }
  const { error } = await db.from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
  if (error) throw new ErreurTraitement(`subscriptions : ${error.message}`);
  // Les crédits déjà accordés restent acquis : ils ont été payés.
}

/** Types réellement traités — les autres reçoivent 200 sans réclamation. */
export const EVENEMENTS_GERES = new Set([
  'checkout.session.completed',
  'invoice.payment_succeeded',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

/** Vrai si l'événement a été traité, faux s'il n'est pas géré (ignoré). */
export async function traiterEvenementStripe(event: { id: string; type: string; data: { object: any } }): Promise<boolean> {
  const obj = event.data?.object;
  switch (event.type) {
    case 'checkout.session.completed':
      await checkoutTermine(obj);
      return true;
    case 'invoice.payment_succeeded':
      await facturePayee(obj);
      return true;
    case 'customer.subscription.updated':
      await abonnementMisAJour(obj);
      return true;
    case 'customer.subscription.deleted':
      await abonnementSupprime(obj);
      return true;
    case 'invoice.payment_failed':
      console.error('[webhook] invoice.payment_failed', obj?.id);
      return true;
    default:
      return false;
  }
}
