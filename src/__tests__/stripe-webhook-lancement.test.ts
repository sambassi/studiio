import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nouvelleBase, clientFactice, type FausseBase } from './helpers/stripe-fausse-base';

/**
 * /api/stripe/webhook — lancement CHF.
 *
 * Ce que ces tests protègent :
 *   - le premier mois d'abonnement est crédité, UNE fois, quel que soit
 *     l'ordre checkout / facture ;
 *   - renouvellements mensuels et annuels (annuel = 12 quotas par facture) ;
 *   - un pack est crédité exactement une fois ;
 *   - l'idempotence : claim → traitement → complete, jamais « traité »
 *     avant la réussite ; rejeu, doublon d'événement, concurrence ;
 *   - sans socle d'idempotence (migration absente), rien n'est crédité.
 *
 * Stripe est entièrement simulé : aucune signature réelle, aucun réseau.
 */

let base: FausseBase;
let prochainEvenement: any = null;
const abonnementsStripe: Record<string, any> = {};
const lignesSession: Record<string, any[]> = {};
const objetsStripe: Record<string, any> = {};
const alertes: Array<{ subject: string; html: string }> = [];
const recus: any[] = [];

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: clientFactice(() => base),
  supabase: clientFactice(() => base),
}));

vi.mock('@/lib/stripe/client', () => ({
  getWebhookEvent: vi.fn(async (_b: Buffer, sig: string) => {
    if (sig === 'mauvaise') throw new Error('No signatures found matching the expected signature');
    return prochainEvenement;
  }),
  stripe: {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        if (!abonnementsStripe[id]) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return abonnementsStripe[id];
      }),
    },
    checkout: {
      sessions: {
        listLineItems: vi.fn(async (id: string) => ({ data: lignesSession[id] ?? [] })),
      },
    },
    paymentIntents: { retrieve: vi.fn(async (id: string) => objetsStripe[id] ?? { id, metadata: {} }) },
    invoices: { retrieve: vi.fn(async (id: string) => objetsStripe[id] ?? { id }) },
    charges: { retrieve: vi.fn(async (id: string) => objetsStripe[id] ?? { id, metadata: {} }) },
  },
}));

vi.mock('@/lib/email/notifications', () => ({
  sendPaymentReceiptDirect: vi.fn(async (_e: string, d: any) => { recus.push(d); }),
  notifyAdminSale: vi.fn(async () => {}),
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmailSilent: vi.fn(async (p: any) => { alertes.push(p); }),
}));

const { POST } = await import('@/app/api/stripe/webhook/route');

const USER = '11111111-2222-4333-8444-555555555555';
const SUB = 'sub_123';
const PRIX = {
  proMensuel: 'price_pro_m',
  proAnnuel: 'price_pro_y',
  starterMensuel: 'price_starter_m',
};
let seq = 0;

function requete(sig: string | null = 't=1,v1=fake') {
  const headers: Record<string, string> = {};
  if (sig) headers['stripe-signature'] = sig;
  return new Request('http://localhost/api/stripe/webhook', { method: 'POST', headers, body: '{}' }) as any;
}

async function envoyer(type: string, object: any, id = `evt_${++seq}`) {
  prochainEvenement = { id, type, data: { object } };
  const res = await POST(requete());
  return { res, id, corps: await res.json() };
}

const facture = (billing_reason: string, extra: any = {}) => ({
  id: extra.id ?? `in_${billing_reason}`,
  subscription: SUB,
  customer: 'cus_1',
  billing_reason,
  amount_paid: 4900,
  currency: 'chf',
  lines: { data: [{ type: 'subscription', price: { id: extra.prix ?? PRIX.proMensuel, recurring: { interval: extra.intervalle ?? 'month' } } }] },
  ...extra,
});

const checkoutAbonnement = (extra: any = {}) => ({
  id: 'cs_sub_1',
  mode: 'subscription',
  payment_status: 'paid',
  subscription: SUB,
  customer: 'cus_1',
  invoice: 'in_subscription_create',
  amount_total: 4900,
  currency: 'chf',
  metadata: { app: 'studiio', userId: USER, plan: 'pro', billingCycle: 'monthly' },
  ...extra,
});

const checkoutPack = (extra: any = {}) => ({
  id: 'cs_pack_1',
  mode: 'payment',
  payment_status: 'paid',
  customer: 'cus_1',
  amount_total: 2900,
  currency: 'chf',
  customer_details: { email: 'client@test.ch', name: 'Client' },
  metadata: { app: 'studiio', userId: USER, packKey: 'medium', creditAmount: '200' },
  ...extra,
});

const solde = () => base.tables.users.find((u) => u.id === USER)!.credits;
const journal = () => base.tables.credit_transactions.filter((t) => t.user_id === USER);
const statutEvenement = (id: string) => base.tables.stripe_events.find((e) => e.event_id === id)?.status;

beforeEach(() => {
  base = nouvelleBase();
  base.tables.users.push({ id: USER, credits: 10, plan: 'free', stripe_customer_id: 'cus_1' });
  base.tables.plans.push(
    { key: 'starter', credits: 150 },
    { key: 'pro', credits: 600 },
    { key: 'enterprise', credits: 2500 },
  );
  for (const o of [abonnementsStripe, lignesSession, objetsStripe]) for (const k of Object.keys(o)) delete o[k];
  alertes.length = 0;
  recus.length = 0;
  abonnementsStripe[SUB] = {
    id: SUB, status: 'active', customer: 'cus_1',
    metadata: { app: 'studiio', userId: USER, plan: 'pro', billingCycle: 'monthly' },
    items: { data: [{ price: { id: PRIX.proMensuel }, current_period_end: 1_900_000_000 }] },
  };
  process.env.STRIPE_PRICE_ID_PRO_MONTHLY = PRIX.proMensuel;
  process.env.STRIPE_PRICE_ID_PRO_YEARLY = PRIX.proAnnuel;
  process.env.STRIPE_PRICE_ID_STARTER_MONTHLY = PRIX.starterMensuel;
});

afterEach(() => {
  delete process.env.STRIPE_PRICE_ID_PRO_MONTHLY;
  delete process.env.STRIPE_PRICE_ID_PRO_YEARLY;
  delete process.env.STRIPE_PRICE_ID_STARTER_MONTHLY;
});

describe('signature et événements non gérés', () => {
  it('signature absente → 400, rien réclamé', async () => {
    const res = await POST(requete(null));
    expect(res.status).toBe(400);
    expect(base.appelsRpc).toHaveLength(0);
  });

  it('signature invalide → 400', async () => {
    prochainEvenement = { id: 'evt_x', type: 'invoice.payment_succeeded', data: { object: facture('subscription_create') } };
    const res = await POST(requete('mauvaise'));
    expect(res.status).toBe(400);
    expect(solde()).toBe(10);
  });

  it('type non géré → 200 sans réclamation', async () => {
    const { res, corps } = await envoyer('customer.created', { id: 'cus_1' });
    expect(res.status).toBe(200);
    expect(corps).toMatchObject({ ignored: true });
    expect(base.appelsRpc).toHaveLength(0);
  });
});

describe('socle d\'idempotence', () => {
  it('RPC absente (migration non appliquée) → 500 et AUCUN crédit', async () => {
    base.rpcAbsentes = true;
    const { res } = await envoyer('checkout.session.completed', checkoutPack());
    expect(res.status).toBe(500);
    expect(solde()).toBe(10);
    expect(journal()).toHaveLength(0);
  });

  it('in_progress → 503 (Stripe rejoue), rien traité', async () => {
    base.reclamationForcee = 'in_progress';
    const { res } = await envoyer('checkout.session.completed', checkoutPack());
    expect(res.status).toBe(503);
    expect(solde()).toBe(10);
  });

  it('already_processed → 200 idempotent, rien traité', async () => {
    base.reclamationForcee = 'already_processed';
    const { res, corps } = await envoyer('checkout.session.completed', checkoutPack());
    expect(res.status).toBe(200);
    expect(corps).toMatchObject({ idempotent: true });
    expect(solde()).toBe(10);
  });

  it('le même événement rejoué ne crédite pas deux fois', async () => {
    const { id } = await envoyer('checkout.session.completed', checkoutPack());
    expect(statutEvenement(id)).toBe('processed');
    const { res, corps } = await envoyer('checkout.session.completed', checkoutPack(), id);
    expect(res.status).toBe(200);
    expect(corps).toMatchObject({ idempotent: true });
    expect(solde()).toBe(210);
    expect(journal()).toHaveLength(1);
  });

  it('échec du traitement → fail + 500, jamais « processed » ; le rejeu réussit', async () => {
    base.pannes['users:update'] = { message: 'connexion perdue' };
    const { res, id } = await envoyer('checkout.session.completed', checkoutAbonnement());
    expect(res.status).toBe(500);
    expect(statutEvenement(id)).toBe('failed');
    expect(solde()).toBe(10);

    delete base.pannes['users:update'];
    const rejeu = await envoyer('checkout.session.completed', checkoutAbonnement(), id);
    expect(rejeu.res.status).toBe(200);
    expect(statutEvenement(id)).toBe('processed');
    expect(solde()).toBe(610);
  });

  it('échec du crédit (RPC) → fail + 500, rejeu crédite une fois', async () => {
    base.pannes['rpc:crediter_credits_stripe'] = { message: 'timeout' };
    const { res, id } = await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_cyc' }));
    expect(res.status).toBe(500);
    expect(journal()).toHaveLength(0);

    expect(statutEvenement(id)).toBe('failed');
    delete base.pannes['rpc:crediter_credits_stripe'];
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_cyc' }), id);
    expect(solde()).toBe(610);
    expect(journal()).toHaveLength(1);
  });

  it('crediter_credits_stripe absente (migration #471 non appliquée) → 500 et aucun crédit', async () => {
    base.pannes['rpc:crediter_credits_stripe'] = { code: 'PGRST202', message: 'Could not find the function in the schema cache' };
    const { res } = await envoyer('checkout.session.completed', checkoutPack());
    expect(res.status).toBe(500);
    expect(solde()).toBe(10);
  });
});

describe('premier mois d\'abonnement', () => {
  it('checkout puis facture subscription_create → +600 une seule fois (solde conservé)', async () => {
    await envoyer('checkout.session.completed', checkoutAbonnement());
    await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    expect(solde()).toBe(10 + 600);
    expect(journal()).toEqual([
      expect.objectContaining({ amount: 600, type: 'subscription', reference_id: 'stripe:in:in_subscription_create' }),
    ]);
    expect(base.tables.users[0].plan).toBe('pro');
    expect(base.tables.subscriptions[0]).toMatchObject({
      user_id: USER, plan: 'pro', status: 'active', stripe_subscription_id: SUB,
      current_period_end: new Date(1_900_000_000 * 1000).toISOString(),
    });
  });

  it('facture AVANT checkout (metadata de l\'abonnement) → crédité une fois', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_create', {
      subscription_details: { metadata: { userId: USER, plan: 'pro' } },
    }));
    await envoyer('checkout.session.completed', checkoutAbonnement());
    expect(solde()).toBe(610);
    expect(journal()).toHaveLength(1);
  });

  it('facture AVANT checkout sans metadata → metadata de l\'abonnement relues chez Stripe', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    expect(solde()).toBe(610);
  });

  it('dernier repli : users.stripe_customer_id', async () => {
    abonnementsStripe[SUB].metadata = { app: 'studiio' };
    await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    expect(solde()).toBe(610);
  });

  it('facture sans utilisateur résolu → 500 (Stripe rejoue), puis checkout crédite, puis rejeu sans doublon', async () => {
    base.tables.users[0].stripe_customer_id = null;
    abonnementsStripe[SUB].metadata = { app: 'studiio' };
    const premier = await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    expect(premier.res.status).toBe(500);
    expect(solde()).toBe(10);

    await envoyer('checkout.session.completed', checkoutAbonnement());
    expect(solde()).toBe(610);

    const rejeu = await envoyer('invoice.payment_succeeded', facture('subscription_create'), premier.id);
    expect(rejeu.res.status).toBe(200);
    expect(solde()).toBe(610);
    expect(journal()).toHaveLength(1);
  });

  it('checkout et facture en CONCURRENCE → crédité une fois', async () => {
    const e1 = { id: 'evt_a', type: 'checkout.session.completed', data: { object: checkoutAbonnement() } };
    const e2 = { id: 'evt_b', type: 'invoice.payment_succeeded', data: { object: facture('subscription_create') } };
    const { getWebhookEvent } = await import('@/lib/stripe/client');
    (getWebhookEvent as any).mockImplementationOnce(async () => e1).mockImplementationOnce(async () => e2);
    const [r1, r2] = await Promise.all([POST(requete()), POST(requete())]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(solde()).toBe(610);
    expect(journal()).toHaveLength(1);
  });

  it('checkout non payé → pas de crédit par le checkout', async () => {
    await envoyer('checkout.session.completed', checkoutAbonnement({ payment_status: 'unpaid' }));
    expect(solde()).toBe(10);
  });

  it('même facture décrite par deux événements distincts → une fois', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    await envoyer('invoice.payment_succeeded', facture('subscription_create'));
    expect(solde()).toBe(610);
  });
});

describe('renouvellements', () => {
  beforeEach(() => {
    base.tables.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB, status: 'active' });
  });

  it('mensuel : le quota est AJOUTÉ (les packs achetés restent)', async () => {
    base.tables.users[0].credits = 250;
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_m2' }));
    expect(solde()).toBe(850);
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_m3' }));
    expect(solde()).toBe(1450);
    expect(journal().map((t) => t.reference_id)).toEqual(['stripe:in:in_m2', 'stripe:in:in_m3']);
  });

  it('annuel : 12 quotas mensuels par facture annuelle (création puis renouvellement)', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_create', { id: 'in_y1', prix: PRIX.proAnnuel, intervalle: 'year' }));
    expect(solde()).toBe(10 + 600 * 12);
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_y2', prix: PRIX.proAnnuel, intervalle: 'year' }));
    expect(solde()).toBe(10 + 600 * 24);
  });

  it('checkout annuel crédite 12 quotas sous la référence de la facture', async () => {
    await envoyer('checkout.session.completed', checkoutAbonnement({ metadata: { userId: USER, plan: 'pro', billingCycle: 'yearly' } }));
    await envoyer('invoice.payment_succeeded', facture('subscription_create', { prix: PRIX.proAnnuel, intervalle: 'year' }));
    expect(solde()).toBe(10 + 7200);
    expect(journal()).toHaveLength(1);
  });

  it('le plan vient du PRIX facturé, pas de la ligne en base', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_s', prix: PRIX.starterMensuel }));
    expect(solde()).toBe(160);
  });

  it.each(['subscription_update', 'manual', 'subscription_threshold', undefined])(
    'billing_reason=%s ne crédite pas', async (raison) => {
      const { res } = await envoyer('invoice.payment_succeeded', facture(raison as any, { id: `in_${raison}` }));
      expect(res.status).toBe(200);
      expect(solde()).toBe(10);
    },
  );

  it('lecteur tolérant : parent.subscription_details (API récentes)', async () => {
    const inv = facture('subscription_cycle', { id: 'in_new' });
    delete inv.subscription;
    inv.parent = { subscription_details: { subscription: SUB, metadata: { userId: USER } } };
    await envoyer('invoice.payment_succeeded', inv);
    expect(solde()).toBe(610);
  });
});

describe('packs', () => {
  it('checkout payé → +200 exactement une fois, même rejoué sous un autre event.id', async () => {
    await envoyer('checkout.session.completed', checkoutPack());
    await envoyer('checkout.session.completed', checkoutPack());
    expect(solde()).toBe(210);
    expect(journal()).toEqual([
      expect.objectContaining({ amount: 200, type: 'purchase', reference_id: 'stripe:cs:cs_pack_1' }),
    ]);
  });

  it('checkout non encaissé → rien', async () => {
    await envoyer('checkout.session.completed', checkoutPack({ payment_status: 'unpaid' }));
    expect(solde()).toBe(10);
  });

  it('creditAmount invalide → 500 (visible), rien crédité', async () => {
    const { res } = await envoyer('checkout.session.completed', checkoutPack({ metadata: { app: 'studiio', userId: USER, creditAmount: 'abc' } }));
    expect(res.status).toBe(500);
    expect(solde()).toBe(10);
  });

  it('le crédit passe par crediter_credits_stripe en mode ajouter, jamais par une écriture directe', async () => {
    await envoyer('checkout.session.completed', checkoutPack());
    const appel = base.appelsRpc.find((c) => c.nom === 'crediter_credits_stripe');
    expect(appel?.args).toEqual({
      p_user_id: USER, p_montant: 200, p_type: 'purchase', p_reference: 'stripe:cs:cs_pack_1',
      p_description: expect.any(String), p_mode: 'ajouter',
    });
  });

  it('refus de la base (utilisateur inconnu) → 500 visible', async () => {
    const { res, id } = await envoyer('checkout.session.completed', checkoutPack({ metadata: { app: 'studiio', userId: '99999999-2222-4333-8444-555555555555', creditAmount: '200' } }));
    expect(res.status).toBe(500);
    expect(base.tables.stripe_events.find((e) => e.event_id === id)?.last_error).toMatch(/utilisateur_inconnu/);
  });
});

describe('abonnement mis à jour / supprimé', () => {
  it('subscription.updated incomplete AVANT checkout → ligne écrite, plan NON promu', async () => {
    abonnementsStripe[SUB].status = 'incomplete';
    await envoyer('customer.subscription.updated', { ...abonnementsStripe[SUB] });
    expect(base.tables.users[0].plan).toBe('free');
    expect(base.tables.subscriptions[0]).toMatchObject({ status: 'incomplete', plan: 'pro' });
  });

  it('subscription.updated active → plan promu, fin de période lue sur l\'item', async () => {
    await envoyer('customer.subscription.updated', { ...abonnementsStripe[SUB], status: 'active' });
    expect(base.tables.users[0].plan).toBe('pro');
    expect(base.tables.subscriptions[0].current_period_end).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });

  it('événement périmé (payload active) alors que Stripe dit canceled → état courant retenu', async () => {
    const perime = { ...abonnementsStripe[SUB], status: 'active' };
    abonnementsStripe[SUB].status = 'canceled';
    await envoyer('customer.subscription.updated', perime);
    expect(base.tables.users[0].plan).toBe('free');
    expect(base.tables.subscriptions[0].status).toBe('canceled');
  });

  it('suppression tardive d\'un ancien abonnement → le nouvel abonnement actif garde le plan', async () => {
    base.tables.subscriptions.push(
      { user_id: USER, plan: 'pro', stripe_subscription_id: 'sub_old', status: 'active' },
      { user_id: USER, plan: 'pro', stripe_subscription_id: 'sub_new', status: 'active' },
    );
    base.tables.users[0].plan = 'pro';
    await envoyer('customer.subscription.deleted', { id: 'sub_old', metadata: { userId: USER } });
    expect(base.tables.users[0].plan).toBe('pro');
    expect(base.tables.subscriptions.find((s) => s.stripe_subscription_id === 'sub_old')!.status).toBe('canceled');
  });

  it('écriture subscriptions en échec → 500', async () => {
    base.pannes['subscriptions:upsert'] = { message: 'violates check constraint' };
    const { res } = await envoyer('customer.subscription.updated', { ...abonnementsStripe[SUB], status: 'active' });
    expect(res.status).toBe(500);
  });

  it('subscription.deleted → plan free, crédits conservés', async () => {
    base.tables.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB, status: 'active' });
    base.tables.users[0].plan = 'pro';
    base.tables.users[0].credits = 400;
    await envoyer('customer.subscription.deleted', { id: SUB, metadata: {} });
    expect(base.tables.users[0]).toMatchObject({ plan: 'free', credits: 400 });
    expect(base.tables.subscriptions[0].status).toBe('canceled');
  });
});

// ── Revue adversariale #475 ─────────────────────────────────────────────

const AUTRE_SITE_PRIX = 'price_afroboost_echelonne';

describe('B1 — compte Stripe partagé : les objets d\'autres sites sont ignorés (200)', () => {
  it('facture d\'un autre site (sans marqueur, prix inconnu, pas de ligne) → 200, traitée, rien crédité, aucun appel Stripe', async () => {
    const { res, id } = await envoyer('invoice.payment_succeeded', facture('subscription_cycle', {
      id: 'in_afro', subscription: 'sub_afro', customer: 'cus_afro', prix: AUTRE_SITE_PRIX,
    }));
    expect(res.status).toBe(200);
    expect(statutEvenement(id)).toBe('processed');
    expect(journal()).toHaveLength(0);
    const { stripe } = await import('@/lib/stripe/client') as any;
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalledWith('sub_afro');
  });

  it('checkout d\'un autre site (sans marqueur ni prix connu) → 200, aucun reçu', async () => {
    lignesSession.cs_afro = [{ price: { id: AUTRE_SITE_PRIX } }];
    const { res, id } = await envoyer('checkout.session.completed', {
      id: 'cs_afro', mode: 'payment', payment_status: 'paid', amount_total: 5000,
      customer_details: { email: 'x@afroboost.ch' }, metadata: { userId: 'afro-42', creditAmount: '999' },
    });
    expect(res.status).toBe(200);
    expect(statutEvenement(id)).toBe('processed');
    expect(solde()).toBe(10);
    expect(recus).toHaveLength(0);
  });

  it('session Studiio créée AVANT le marqueur : reconnue par son prix de pack', async () => {
    process.env.STRIPE_PRICE_ID_PACK_MEDIUM = 'price_pack_m';
    lignesSession.cs_legacy = [{ price: { id: 'price_pack_m' } }];
    await envoyer('checkout.session.completed', checkoutPack({ id: 'cs_legacy', metadata: { userId: USER, packKey: 'medium', creditAmount: '200' } }));
    expect(solde()).toBe(210);
    delete process.env.STRIPE_PRICE_ID_PACK_MEDIUM;
  });

  it('userId Studiio qui n\'est pas un UUID → ignoré, 200', async () => {
    const { res } = await envoyer('checkout.session.completed', checkoutPack({ metadata: { app: 'studiio', userId: 'pas-un-uuid', creditAmount: '200' } }));
    expect(res.status).toBe(200);
    expect(journal()).toHaveLength(0);
  });

  it('abonnement d\'un autre site mis à jour / supprimé → 200, aucune écriture', async () => {
    const afro = { id: 'sub_afro', status: 'active', customer: 'cus_afro', metadata: {}, items: { data: [{ price: { id: AUTRE_SITE_PRIX } }] } };
    expect((await envoyer('customer.subscription.updated', afro)).res.status).toBe(200);
    expect((await envoyer('customer.subscription.deleted', afro)).res.status).toBe(200);
    expect(base.tables.subscriptions).toHaveLength(0);
    expect(base.tables.users[0].plan).toBe('free');
  });

  it('remboursement d\'un autre site → aucune alerte', async () => {
    await envoyer('charge.refunded', { id: 'ch_afro', payment_intent: 'pi_afro', metadata: {} });
    expect(alertes).toHaveLength(0);
  });
});

describe('I1 — portail : montant nul et subscription_update ne créditent jamais', () => {
  beforeEach(() => {
    base.tables.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB, status: 'active' });
  });

  it('facture de renouvellement à 0 (crédit client après annuel → mensuel) → aucun crédit', async () => {
    await envoyer('invoice.payment_succeeded', facture('subscription_cycle', { id: 'in_zero', amount_paid: 0 }));
    expect(solde()).toBe(10);
  });

  it('checkout à 0 → pas de crédit par le checkout', async () => {
    await envoyer('checkout.session.completed', checkoutAbonnement({ amount_total: 0 }));
    expect(solde()).toBe(10);
  });

  it('subscription_update → aucun crédit, UNE alerte admin, pas renvoyée au rejeu', async () => {
    const { id } = await envoyer('invoice.payment_succeeded', facture('subscription_update', { id: 'in_upd', amount_paid: 29000 }));
    expect(solde()).toBe(10);
    expect(alertes).toHaveLength(1);
    expect(alertes[0].subject).toMatch(/Changement d'abonnement/);
    await envoyer('invoice.payment_succeeded', facture('subscription_update', { id: 'in_upd', amount_paid: 29000 }), id);
    expect(alertes).toHaveLength(1);
  });
});

describe('I5 — reçus seulement pour un paiement Studiio encaissé', () => {
  it('pack payé → un reçu ; pack non encaissé → aucun', async () => {
    await envoyer('checkout.session.completed', checkoutPack({ id: 'cs_unpaid', payment_status: 'unpaid' }));
    expect(recus).toHaveLength(0);
    await envoyer('checkout.session.completed', checkoutPack());
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatchObject({ currency: 'CHF', creditsAmount: 200 });
  });
});

describe('M8 — paiement asynchrone', () => {
  it('completed non encaissé puis async_payment_succeeded → crédité une fois (même référence)', async () => {
    await envoyer('checkout.session.completed', checkoutPack({ payment_status: 'unpaid' }));
    expect(solde()).toBe(10);
    await envoyer('checkout.session.async_payment_succeeded', checkoutPack());
    await envoyer('checkout.session.completed', checkoutPack());
    expect(solde()).toBe(210);
    expect(journal()).toHaveLength(1);
  });
});

describe('I6 — remboursements et litiges : alerte, aucun débit', () => {
  it('charge.refunded d\'un pack Studiio (marqueur sur le PaymentIntent) → alerte, solde intact', async () => {
    base.tables.users[0].credits = 210;
    objetsStripe.pi_1 = { id: 'pi_1', metadata: { app: 'studiio', userId: USER } };
    await envoyer('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 2900, currency: 'chf', metadata: {} });
    expect(alertes).toHaveLength(1);
    expect(alertes[0].subject).toMatch(/Remboursement/);
    expect(solde()).toBe(210);
  });

  it('charge.dispute.created sur une facture d\'abonnement Studiio → alerte', async () => {
    objetsStripe.ch_2 = { id: 'ch_2', invoice: 'in_x', metadata: {} };
    objetsStripe.in_x = facture('subscription_cycle', { id: 'in_x', subscription: 'sub_x', subscription_details: { metadata: { app: 'studiio' } } });
    await envoyer('charge.dispute.created', { id: 'dp_1', charge: 'ch_2', amount: 4900, currency: 'chf', reason: 'fraudulent' });
    expect(alertes).toHaveLength(1);
    expect(alertes[0].subject).toMatch(/Litige/);
  });
});

describe('reference_autre_compte (#471 6a21cfc)', () => {
  it('référence déjà créditée à un autre compte → 200, événement clos, alerte admin, rien crédité', async () => {
    base.tables.credit_transactions.push({ user_id: '99999999-0000-4000-8000-000000000000', amount: 200, type: 'purchase', reference_id: 'stripe:cs:cs_pack_1' });
    const { res, id } = await envoyer('checkout.session.completed', checkoutPack());
    expect(res.status).toBe(200);
    expect(statutEvenement(id)).toBe('processed');
    expect(solde()).toBe(10);
    expect(alertes.some((a) => /autre compte/.test(a.subject))).toBe(true);
  });
});

describe('M1 / M2 / M3 — état d\'abonnement', () => {
  it('M1 : subscriptions.retrieve en échec → 500 (rejeu), pas de statut supposé', async () => {
    const recu = { ...abonnementsStripe[SUB] };
    delete abonnementsStripe[SUB];
    const { res } = await envoyer('customer.subscription.updated', recu);
    expect(res.status).toBe(500);
    expect(base.tables.users[0].plan).toBe('free');
  });

  it('M1 : checkout dont l\'abonnement est illisible → 500, pas de plan « active » supposé', async () => {
    delete abonnementsStripe[SUB];
    const { res } = await envoyer('checkout.session.completed', checkoutAbonnement());
    expect(res.status).toBe(500);
    expect(base.tables.users[0].plan).toBe('free');
  });

  it.each([
    ['unpaid', 'free'], ['incomplete_expired', 'free'], ['paused', 'free'], ['past_due', 'pro'], ['active', 'pro'],
  ])('M2 : statut %s → plan %s', async (statut, plan) => {
    base.tables.users[0].plan = 'pro';
    abonnementsStripe[SUB].status = statut;
    await envoyer('customer.subscription.updated', { ...abonnementsStripe[SUB] });
    expect(base.tables.users[0].plan).toBe(plan);
  });

  it('M3 : suppression → plan recalculé depuis l\'abonnement actif restant (starter)', async () => {
    base.tables.subscriptions.push(
      { user_id: USER, plan: 'pro', stripe_subscription_id: SUB, status: 'active' },
      { user_id: USER, plan: 'starter', stripe_subscription_id: 'sub_s', status: 'active' },
    );
    base.tables.users[0].plan = 'pro';
    await envoyer('customer.subscription.deleted', { id: SUB, metadata: { app: 'studiio', userId: USER } });
    expect(base.tables.users[0].plan).toBe('starter');
  });

  it('M3 : lecture des abonnements restants en échec → 500', async () => {
    base.tables.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB, status: 'active' });
    base.pannes['subscriptions:select'] = { message: 'connexion perdue' };
    const { res } = await envoyer('customer.subscription.deleted', { id: SUB, metadata: { app: 'studiio', userId: USER } });
    expect(res.status).toBe(500);
  });
});

describe('M5 — la fausse base colle au SQL de #471', () => {
  it('fail ne rétrograde pas un processed ; complete inconnu lève ; bail borné', async () => {
    const { supabaseAdmin } = await import('@/lib/db/supabase') as any;
    const { id } = await envoyer('checkout.session.completed', checkoutPack());
    await supabaseAdmin.rpc('stripe_event_fail', { p_event_id: id, p_error: 'tardif' });
    expect(statutEvenement(id)).toBe('processed');
    expect((await supabaseAdmin.rpc('stripe_event_complete', { p_event_id: 'evt_inconnu' })).error?.code).toBe('P0002');
    expect((await supabaseAdmin.rpc('stripe_event_claim', { p_event_id: 'e', p_type: 't', p_lease_seconds: 0 })).error?.code).toBe('22023');
  });
});
