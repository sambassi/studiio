/**
 * Traitement métier des événements Stripe — appelé par
 * `/api/stripe/webhook` APRÈS la réclamation de l'événement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMPTE PARTAGÉ : D'ABORD SAVOIR SI L'OBJET EST À STUDIIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le compte Stripe Afroboosteur sert aussi à d'autres sites. Leurs
 * factures, sessions et abonnements arrivent sur ce même endpoint. Un objet
 * est à Studiio s'il porte `metadata.app = 'studiio'`, OU si son prix est
 * un prix Studiio connu, OU si son abonnement a une ligne `subscriptions`.
 * Sinon il est IGNORÉ (200) avant toute exception : un 500 en boucle ferait
 * désactiver l'endpoint par Stripe. Seul un objet Studiio non résolu lève.
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
 * d'événements qui le décrivent. Une facture à montant NUL ne crédite
 * jamais (proratas, crédit client après un passage annuel → mensuel), et
 * `subscription_update` ne crédite pas : il déclenche une alerte admin.
 *
 * Le premier paiement est décrit DEUX fois : `checkout.session.completed`
 * (qui porte `invoice`) et `invoice.payment_succeeded`. Les deux créditent
 * sous la MÊME référence `stripe:in:<in_…>` : le premier arrivé crédite.
 *
 * Renouvellement : le quota est AJOUTÉ (mode `ajouter`), jamais fixé — les
 * packs payés comptant restent. Annuel : 12 quotas par facture annuelle.
 *
 * Toute erreur LÈVE : le webhook marque l'événement en échec et répond 500,
 * Stripe rejoue. Rien n'est marqué traité tant que tout n'a pas réussi.
 */
import { supabaseAdmin as db } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';
import { crediterIdempotent as crediterBase, ErreurCredit } from '@/lib/credits/crediter';
import { sendPaymentReceiptDirect, notifyAdminSale } from '@/lib/email/notifications';
import { sendEmailSilent } from '@/lib/email/resend';
import {
  planDepuisPrix, packDepuisPrix, creditsPourFacture, PLANS_PAYANTS, MARQUEUR_APP,
  type Cycle, type PlanPayant, type PlanKey,
} from '@/lib/stripe/prix';

/** Statuts qui ouvrent (ou conservent, pendant la relance) les droits du plan. */
const STATUTS_DROITS = new Set(['active', 'trialing', 'past_due']);
/** Raisons de facture qui créditent le quota du plan. */
const FACTURES_CREDITEES = new Set(['subscription_create', 'subscription_cycle']);
const RANG: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export const estUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const marque = (md: any) => md?.app === MARQUEUR_APP;

// ── Accès base / Stripe (les erreurs LÈVENT : Stripe rejouera) ───────────

async function ligneAbonnementEnBase(subId: string | undefined): Promise<{ user_id?: string; plan?: string } | null> {
  if (!subId) return null;
  const { data, error } = await db.from('subscriptions').select('user_id, plan').eq('stripe_subscription_id', subId);
  if (error) throw new ErreurTraitement(`lecture subscriptions : ${error.message}`);
  return (data ?? [])[0] ?? null;
}

async function utilisateurParClient(customerId: string | undefined): Promise<string | undefined> {
  if (!customerId) return undefined;
  const { data, error } = await db.from('users').select('id').eq('stripe_customer_id', customerId);
  if (error) {
    // Colonne absente (#472) : repli indisponible, pas une panne.
    console.warn('[webhook] users.stripe_customer_id illisible', error.message);
    return undefined;
  }
  return (data ?? []).length === 1 ? data![0].id : undefined;
}

/** Relit l'abonnement chez Stripe. Un échec LÈVE : jamais de statut supposé. */
async function recupererAbonnement(subId: string): Promise<any> {
  try {
    return await stripe.subscriptions.retrieve(subId);
  } catch (e: any) {
    throw new ErreurTraitement(`subscriptions.retrieve ${subId} : ${e?.message || 'erreur'}`);
  }
}

/**
 * Plan effectif d'un compte, recalculé depuis TOUTES ses lignes
 * `subscriptions` : le meilleur plan parmi les abonnements actifs, en essai
 * ou en relance (`past_due`) ; sinon `free` (unpaid, incomplete_expired,
 * paused, canceled…). Un événement tardif sur un ancien abonnement ne peut
 * donc ni rétrograder ni promouvoir à tort.
 */
async function recalculerPlan(userId: string): Promise<void> {
  const { data, error } = await db.from('subscriptions').select('plan, status').eq('user_id', userId);
  if (error) throw new ErreurTraitement(`lecture subscriptions : ${error.message}`);
  let plan: PlanKey = 'free';
  for (const l of data ?? []) {
    if (STATUTS_DROITS.has(l.status) && estPlanPayant(l.plan) && (RANG[l.plan] ?? 0) > (RANG[plan] ?? 0)) plan = l.plan;
  }
  const { error: e2 } = await db.from('users').update({ plan }).eq('id', userId);
  if (e2) throw new ErreurTraitement(`users.plan : ${e2.message}`);
}

async function ecrireAbonnement(userId: string, plan: PlanPayant, sub: any): Promise<void> {
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

/** Alerte admin, envoyée en dernier (idempotente par la réclamation de l'événement). */
function alerteAdmin(sujet: string, lignes: Record<string, unknown>): void {
  const to = process.env.ADMIN_EMAIL || 'admin@studiio.pro';
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const corps = Object.entries(lignes)
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('');
  void sendEmailSilent({
    to,
    subject: `[Studiio Stripe] ${sujet}`,
    html: `<p>${esc(sujet)}</p><table>${corps}</table><p>Aucune action automatique n'a été faite.</p>`,
  });
}

/**
 * Crédit idempotent. Une référence déjà créditée à un AUTRE compte
 * (`reference_autre_compte`) est une anomalie, pas une panne passagère :
 * la rejouer ne changerait rien. Alerte admin, et l'événement est clos.
 */
async function crediterIdempotent(p: Parameters<typeof crediterBase>[0]): Promise<void> {
  try {
    await crediterBase(p);
  } catch (e) {
    if (e instanceof ErreurCredit && e.motif === 'reference_autre_compte') {
      console.error('[webhook] reference deja creditee a un autre compte', p.reference, p.userId);
      alerteAdmin('Reference Stripe deja creditee a un autre compte', {
        reference: p.reference, userId: p.userId, montant: p.montant, type: p.type,
      });
      return;
    }
    throw e;
  }
}

// ── Checkout ─────────────────────────────────────────────────────────────

async function sessionEstStudiio(cs: any): Promise<boolean> {
  if (marque(cs.metadata)) return true;
  if (await ligneAbonnementEnBase(idDe(cs.subscription))) return true;
  let items: any[] = [];
  try {
    const res: any = await stripe.checkout.sessions.listLineItems(cs.id, { limit: 10 });
    items = res?.data ?? [];
  } catch (e: any) {
    throw new ErreurTraitement(`listLineItems ${cs.id} : ${e?.message || 'erreur'}`);
  }
  for (const it of items) {
    const pid = idDe(it?.price);
    if (await planDepuisPrix(pid) || await packDepuisPrix(pid)) return true;
  }
  return false;
}

/**
 * `checkout.session.completed` ET `checkout.session.async_payment_succeeded`.
 * Un paiement non encore encaissé ne crédite pas ; s'il est asynchrone, la
 * confirmation arrive par `async_payment_succeeded` et crédite sous la MÊME
 * référence.
 */
async function checkoutTermine(cs: any): Promise<void> {
  if (!(await sessionEstStudiio(cs))) {
    console.info('[webhook] session hors Studiio ignoree', cs.id);
    return;
  }
  const md = cs.metadata || {};
  const userId = md.userId;
  if (!estUuid(userId)) {
    console.warn('[webhook] session Studiio sans userId valide, ignoree', cs.id);
    return;
  }
  if (cs.payment_status !== 'paid') {
    console.info('[webhook] session non encaissee', cs.id, cs.payment_status);
    return;
  }

  if (cs.mode === 'payment') {
    const montant = Number.parseInt(String(md.creditAmount ?? ''), 10);
    if (!Number.isInteger(montant) || montant <= 0) {
      throw new ErreurTraitement(`pack sans creditAmount valide (${cs.id})`);
    }
    await crediterIdempotent({
      userId, montant, type: 'purchase',
      reference: referenceCheckout(cs.id),
      description: `pack ${md.packKey ?? '?'} (${cs.id})`,
    });
  } else if (cs.mode === 'subscription') {
    if (!estPlanPayant(md.plan)) throw new ErreurTraitement(`session ${cs.id} : plan absent`);
    const plan = md.plan;
    const subId = idDe(cs.subscription);
    if (!subId) throw new ErreurTraitement(`session ${cs.id} : abonnement absent`);
    const sub = await recupererAbonnement(subId);
    await ecrireAbonnement(userId, plan, sub);
    await recalculerPlan(userId);

    // Premier paiement : crédité ICI si la facture n'est pas encore passée.
    // Même référence que `invoice.payment_succeeded` → jamais deux fois.
    const invoiceId = idDe(cs.invoice);
    if (invoiceId && (cs.amount_total ?? 0) > 0) {
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
  } else {
    return;
  }

  // Reçu + alerte admin : paiement Studiio encaissé seulement, APRÈS toutes
  // les écritures. Seul un échec de `stripe_event_complete` après réussite
  // de tout le reste peut renvoyer un second reçu.
  if (cs.customer_details?.email) {
    const devise = String(cs.currency || 'chf').toUpperCase();
    const montantPaye = (cs.amount_total || 0) / 100;
    const credits = md.creditAmount ? parseInt(md.creditAmount, 10) || 0 : 0;
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
  }
}

// ── Facture payée ────────────────────────────────────────────────────────

async function facturePayee(inv: any): Promise<void> {
  const subId = abonnementDeFacture(inv);
  const meta = metadataAbonnementDeFacture(inv);
  const enBase = await ligneAbonnementEnBase(subId);
  const ligne = ligneAbonnement(inv);
  const depuisPrix = await planDepuisPrix(prixDeLigne(ligne));

  if (!marque(meta) && !enBase && !depuisPrix) {
    console.info('[webhook] facture hors Studiio ignoree', inv.id);
    return;
  }

  const raison = inv.billing_reason;
  if (raison === 'subscription_update') {
    // Changement de plan / de cycle (portail) : aucun crédit automatique.
    alerteAdmin('Changement d\'abonnement a traiter a la main', {
      facture: inv.id, abonnement: subId, client: idDe(inv.customer),
      montant: `${(inv.amount_paid ?? 0) / 100} ${String(inv.currency || 'chf').toUpperCase()}`,
      userId: meta.userId ?? enBase?.user_id,
    });
    return;
  }
  if (!FACTURES_CREDITEES.has(raison)) {
    console.info('[webhook] facture non creditee', inv.id, raison);
    return;
  }
  if (!(typeof inv.amount_paid === 'number' && inv.amount_paid > 0)) {
    // Prorata, crédit client, coupon à 100 % : rien d'encaissé, rien de crédité.
    console.info('[webhook] facture a montant nul, pas de credit', inv.id);
    return;
  }
  if (!inv.id) throw new ErreurTraitement('facture sans id');

  // Utilisateur : metadata (facture, puis abonnement relu chez Stripe),
  // ligne `subscriptions`, `users.stripe_customer_id` en dernier repli.
  let userId: string | undefined = meta.userId || enBase?.user_id;
  let sub: any = null;
  if (!userId && subId) {
    sub = await recupererAbonnement(subId);
    userId = sub?.metadata?.userId || undefined;
  }
  if (!userId) userId = await utilisateurParClient(idDe(inv.customer));
  if (!userId) throw new ErreurTraitement(`facture ${inv.id} : utilisateur introuvable`);
  if (!estUuid(userId)) {
    console.warn('[webhook] facture avec userId non Studiio, ignoree', inv.id);
    return;
  }

  // Plan et cycle : le PRIX facturé fait foi, les metadata en repli.
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
  const enBase = await ligneAbonnementEnBase(recu.id);
  const prixRecu = await planDepuisPrix(idDe(recu.items?.data?.[0]?.price));
  if (!marque(recu.metadata) && !enBase && !prixRecu) {
    console.info('[webhook] abonnement hors Studiio ignore', recu.id);
    return;
  }
  // L'état COURANT chez Stripe, jamais celui du message : un événement
  // ancien relivré après un plus récent ne réécrit pas un statut périmé.
  const sub = await recupererAbonnement(recu.id);
  const userId: string | undefined = sub.metadata?.userId || enBase?.user_id || await utilisateurParClient(idDe(sub.customer));
  const resolu = await planDepuisPrix(idDe(sub.items?.data?.[0]?.price));
  const plan = resolu?.plan ?? (estPlanPayant(sub.metadata?.plan) ? sub.metadata.plan : undefined);
  if (!userId || !plan) throw new ErreurTraitement(`abonnement ${sub.id} : utilisateur ou plan introuvable`);
  if (!estUuid(userId)) {
    console.warn('[webhook] abonnement avec userId non Studiio, ignore', sub.id);
    return;
  }
  await ecrireAbonnement(userId, plan, sub);
  await recalculerPlan(userId);
}

async function abonnementSupprime(sub: any): Promise<void> {
  const enBase = await ligneAbonnementEnBase(sub.id);
  const prixRecu = await planDepuisPrix(idDe(sub.items?.data?.[0]?.price));
  if (!marque(sub.metadata) && !enBase && !prixRecu) {
    console.info('[webhook] abonnement hors Studiio ignore', sub.id);
    return;
  }
  const { error } = await db.from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
  if (error) throw new ErreurTraitement(`subscriptions : ${error.message}`);

  const userId: string | undefined = sub.metadata?.userId || enBase?.user_id;
  // Plan recalculé depuis les abonnements restants. Les crédits déjà
  // accordés restent acquis : ils ont été payés.
  if (estUuid(userId)) await recalculerPlan(userId);
}

// ── Remboursements et litiges : alerte seulement, aucun débit automatique ──

async function chargeEstStudiio(charge: any): Promise<boolean> {
  if (marque(charge?.metadata)) return true;
  try {
    const piId = idDe(charge?.payment_intent);
    if (piId) {
      const pi: any = await stripe.paymentIntents.retrieve(piId);
      if (marque(pi?.metadata)) return true;
    }
    const invId = idDe(charge?.invoice);
    if (invId) {
      const inv: any = await stripe.invoices.retrieve(invId);
      if (marque(metadataAbonnementDeFacture(inv))) return true;
      if (await ligneAbonnementEnBase(abonnementDeFacture(inv))) return true;
      if (await planDepuisPrix(prixDeLigne(ligneAbonnement(inv)))) return true;
    }
  } catch (e: any) {
    if (e instanceof ErreurTraitement) throw e;
    throw new ErreurTraitement(`charge ${charge?.id} : ${e?.message || 'erreur'}`);
  }
  return false;
}

async function chargeRemboursee(charge: any): Promise<void> {
  if (!(await chargeEstStudiio(charge))) return;
  alerteAdmin('Remboursement Stripe (credits NON retires automatiquement)', {
    charge: charge.id, client: idDe(charge.customer),
    rembourse: `${(charge.amount_refunded ?? 0) / 100} ${String(charge.currency || 'chf').toUpperCase()}`,
  });
}

async function litigeOuvert(dispute: any): Promise<void> {
  const chargeId = idDe(dispute.charge);
  let charge: any = typeof dispute.charge === 'object' ? dispute.charge : null;
  if (!charge && chargeId) {
    try {
      charge = await stripe.charges.retrieve(chargeId);
    } catch (e: any) {
      throw new ErreurTraitement(`charges.retrieve ${chargeId} : ${e?.message || 'erreur'}`);
    }
  }
  if (!charge || !(await chargeEstStudiio(charge))) return;
  alerteAdmin('Litige Stripe ouvert (credits NON retires automatiquement)', {
    litige: dispute.id, charge: chargeId, raison: dispute.reason,
    montant: `${(dispute.amount ?? 0) / 100} ${String(dispute.currency || 'chf').toUpperCase()}`,
  });
}

/** Types réellement traités — les autres reçoivent 200 sans réclamation. */
export const EVENEMENTS_GERES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
]);

/** Vrai si l'événement a été traité, faux s'il n'est pas géré (ignoré). */
export async function traiterEvenementStripe(event: { id: string; type: string; data: { object: any } }): Promise<boolean> {
  const obj = event.data?.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
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
    case 'charge.refunded':
      await chargeRemboursee(obj);
      return true;
    case 'charge.dispute.created':
      await litigeOuvert(obj);
      return true;
    case 'invoice.payment_failed':
      console.error('[webhook] invoice.payment_failed', obj?.id);
      return true;
    default:
      return false;
  }
}
