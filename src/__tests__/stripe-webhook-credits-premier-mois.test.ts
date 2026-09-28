import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/stripe/webhook — credits du premier mois d'abonnement.
 *
 * Ce que ces tests protegent : un nouvel abonne payant ne recevait AUCUN
 * credit le premier mois. `checkout.session.completed` (mode subscription)
 * ne met a jour que `plan` + `subscriptions`, et `invoice.payment_succeeded`
 * ne creditait que `billing_reason === 'subscription_cycle'` — la premiere
 * facture (`subscription_create`) etait ignoree.
 *
 * Stripe est entierement simule : `getWebhookEvent` renvoie l'evenement
 * fourni par le test, aucune signature ni appel reseau.
 */

// ── Faux Stripe ──────────────────────────────────────────────────────
let nextEvent: any = null;
vi.mock('@/lib/stripe/client', () => ({
  getWebhookEvent: vi.fn(async () => nextEvent),
}));

vi.mock('@/lib/email/notifications', () => ({
  sendPaymentReceiptDirect: vi.fn(),
  notifyAdminSale: vi.fn(),
}));

// ── Fausse base (PostgREST) avec etat ────────────────────────────────
interface Db {
  users: Record<string, { credits: number; plan?: string }>;
  subscriptions: Array<{ user_id: string; plan: string; stripe_subscription_id: string }>;
  plans: Array<{ key: string; credits: number }>;
  credit_transactions: Array<{ user_id: string; amount: number; type: string }>;
  stripe_events: Array<{ event_id: string }>;
}
let db: Db;

function makeQuery(table: keyof Db) {
  const filters: Array<[string, unknown]> = [];
  let pendingUpdate: Record<string, unknown> | null = null;

  const rowsOf = (): any[] => {
    if (table === 'users') return Object.entries(db.users).map(([id, u]) => ({ id, ...u }));
    return db[table] as any[];
  };
  const match = (r: any) => filters.every(([k, v]) => r[k] === v);
  const applyUpdate = () => {
    if (!pendingUpdate) return;
    if (table === 'users') {
      for (const [id, u] of Object.entries(db.users)) {
        if (match({ id, ...u })) Object.assign(u, pendingUpdate);
      }
    } else {
      for (const r of db[table] as any[]) if (match(r)) Object.assign(r, pendingUpdate);
    }
  };

  const api: any = {
    select: () => api,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    update: (patch: Record<string, unknown>) => { pendingUpdate = patch; return api; },
    insert: async (row: any) => { (db[table] as any[]).push(row); return { data: null, error: null }; },
    upsert: async (row: any) => { (db[table] as any[]).push(row); return { data: null, error: null }; },
    single: async () => {
      const found = rowsOf().find(match) ?? null;
      return { data: found, error: found ? null : { message: 'not found' } };
    },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
      applyUpdate();
      return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: keyof Db) => makeQuery(t) },
  supabase: { from: (t: keyof Db) => makeQuery(t) },
}));

const { POST } = await import('@/app/api/stripe/webhook/route');

const USER = 'user-1';
const SUB = 'sub_123';
let eventSeq = 0;

function send(type: string, object: any) {
  nextEvent = { id: `evt_${++eventSeq}`, type, data: { object } };
  const req = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=fake' },
    body: '{}',
  });
  return POST(req as any);
}

const invoice = (billing_reason: string, extra: any = {}) => ({
  id: `in_${billing_reason}`,
  subscription: SUB,
  billing_reason,
  ...extra,
});

const checkoutSubscription = () => ({
  id: 'cs_1',
  mode: 'subscription',
  subscription: SUB,
  customer: 'cus_1',
  metadata: { userId: USER, plan: 'pro', billingCycle: 'monthly' },
});

beforeEach(() => {
  db = {
    users: { [USER]: { credits: 10, plan: 'free' } },
    subscriptions: [],
    plans: [{ key: 'pro', credits: 600 }, { key: 'starter', credits: 150 }],
    credit_transactions: [],
    stripe_events: [],
  };
});

describe('webhook Stripe — premier mois (subscription_create)', () => {
  it('credite le quota du plan UNE seule fois pour checkout + premiere facture', async () => {
    await send('checkout.session.completed', checkoutSubscription());
    // Le checkout seul ne credite pas.
    expect(db.users[USER].credits).toBe(10);
    expect(db.credit_transactions).toHaveLength(0);

    await send('invoice.payment_succeeded', invoice('subscription_create'));

    // AJOUT au solde : les 10 credits gratuits de depart sont conserves.
    expect(db.users[USER].credits).toBe(10 + 600);
    expect(db.credit_transactions).toEqual([
      expect.objectContaining({ user_id: USER, amount: 600, type: 'subscription' }),
    ]);
  });

  it("credite aussi si la facture arrive AVANT checkout.session.completed (metadonnees de l'abonnement)", async () => {
    await send('invoice.payment_succeeded', invoice('subscription_create', {
      subscription_details: { metadata: { userId: USER, plan: 'pro' } },
    }));
    await send('checkout.session.completed', checkoutSubscription());

    expect(db.users[USER].credits).toBe(610);
    expect(db.credit_transactions).toHaveLength(1);
  });

  it('un evenement rejoue (meme event.id) ne credite pas deux fois', async () => {
    await send('checkout.session.completed', checkoutSubscription());
    await send('invoice.payment_succeeded', invoice('subscription_create'));
    // Meme evenement renvoye par Stripe : stripe_events le connait deja.
    const res = await POST(new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}',
    }) as any);

    expect(await res.json()).toMatchObject({ idempotent: true });
    expect(db.users[USER].credits).toBe(610);
    expect(db.credit_transactions).toHaveLength(1);
  });

  it('repli STRIPE_PLANS quand la table plans ne connait pas le plan', async () => {
    db.plans = [];
    await send('checkout.session.completed', checkoutSubscription());
    await send('invoice.payment_succeeded', invoice('subscription_create'));
    const { STRIPE_PLANS } = await import('@/lib/stripe/constants');
    const expected = (STRIPE_PLANS as any).pro.credits;
    expect(db.users[USER].credits).toBe(10 + expected);
  });

  it("sans utilisateur resolu, ne credite personne", async () => {
    await send('invoice.payment_succeeded', invoice('subscription_create'));
    expect(db.users[USER].credits).toBe(10);
    expect(db.credit_transactions).toHaveLength(0);
  });
});

describe('webhook Stripe — renouvellement (subscription_cycle) inchange', () => {
  it('REMPLACE le solde par le quota du plan (comportement historique)', async () => {
    db.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB });
    db.users[USER].credits = 42;

    await send('invoice.payment_succeeded', invoice('subscription_cycle'));

    expect(db.users[USER].credits).toBe(600);
    expect(db.credit_transactions).toEqual([
      expect.objectContaining({ user_id: USER, amount: 600, type: 'subscription' }),
    ]);
  });
});

describe('webhook Stripe — autres billing_reason ignores', () => {
  it.each(['subscription_update', 'manual', 'subscription_threshold', 'upcoming', undefined])(
    'billing_reason=%s ne credite pas',
    async (reason) => {
      db.subscriptions.push({ user_id: USER, plan: 'pro', stripe_subscription_id: SUB });
      await send('invoice.payment_succeeded', invoice(reason as any, {
        subscription_details: { metadata: { userId: USER, plan: 'pro' } },
      }));
      expect(db.users[USER].credits).toBe(10);
      expect(db.credit_transactions).toHaveLength(0);
    },
  );
});
