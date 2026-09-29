import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nouvelleBase, clientFactice, type FausseBase } from './helpers/stripe-fausse-base';

/**
 * Prix Stripe (lancement CHF, tarifs modifiables depuis l'admin) :
 *   - la BASE fait autorité : `plans.stripe_price_id`, `stripe_yearly_price_id`,
 *     `credit_packs.stripe_price_id` passent avant les variables
 *     `STRIPE_PRICE_ID_*`, qui ne servent que de repli ;
 *   - avant checkout, le prix Stripe doit être actif, en CHF, du bon
 *     intervalle et au montant ENREGISTRÉ EN BASE ;
 *   - crédits et prix doivent être > 0, sinon 503 ;
 *   - aucun prix configuré → 503, jamais de `price_data` ;
 *   - `/api/credits/purchase` (montant libre, jamais crédité) est retirée.
 */

let base: FausseBase;
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: clientFactice(() => base),
  supabase: clientFactice(() => base),
}));

const prixStripe: Record<string, any> = {};
const sessionsCreees: any[] = [];
const abonnementsClient: any[] = [];
vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    prices: {
      retrieve: vi.fn(async (id: string) => {
        if (!prixStripe[id]) throw new Error(`No such price: '${id}'`);
        return prixStripe[id];
      }),
    },
    customers: { retrieve: vi.fn(async (id: string) => ({ id })) },
    subscriptions: { list: vi.fn(async () => ({ data: abonnementsClient.splice(0) })) },
    checkout: {
      sessions: {
        create: vi.fn(async (p: any) => { sessionsCreees.push(p); return { url: 'https://checkout.test/s' }; }),
      },
    },
  },
  createCustomer: vi.fn(async () => ({ id: 'cus_new' })),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1', email: 'u@test.ch', name: 'U' } })),
}));

const prix = await import('@/lib/stripe/prix');
const { STRIPE_PLANS, CREDIT_PACKAGES, totalAnnuelCentimes } = await import('@/lib/stripe/constants');
const checkoutRoute = await import('@/app/api/stripe/create-checkout/route');
const packRoute = await import('@/app/api/credits/purchase-pack/route');
const purchaseRoute = await import('@/app/api/credits/purchase/route');

const post = (body: any) => new Request('http://localhost/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as any;

beforeEach(() => {
  // Préfixe seul : clé factice, jamais utilisée (Stripe est mocké).
  process.env.STRIPE_SECRET_KEY = 'sk_live_factice';
  base = nouvelleBase();
  base.tables.users.push({ id: 'user-1', credits: 10, stripe_customer_id: 'cus_1' });
  // Ligne en base, synchronisée depuis Stripe : 4900 / (49000 / 12 = 4083).
  base.tables.plans.push({
    key: 'pro', credits: 600, price_cents: 4900, yearly_price_cents: 4083,
    stripe_price_id: 'price_pro_m', stripe_yearly_price_id: 'price_pro_y',
  });
  base.tables.credit_packs.push({ key: 'medium', amount: 200, price_cents: 2900, stripe_price_id: 'price_pack_m' });
  for (const k of Object.keys(prixStripe)) delete prixStripe[k];
  sessionsCreees.length = 0;
  abonnementsClient.length = 0;
  prixStripe.price_pro_m = { livemode: true, id: 'price_pro_m', active: true, currency: 'chf', unit_amount: 4900, recurring: { interval: 'month' } };
  prixStripe.price_pro_y = { livemode: true, id: 'price_pro_y', active: true, currency: 'chf', unit_amount: 49000, recurring: { interval: 'year' } };
  prixStripe.price_pack_m = { livemode: true, id: 'price_pack_m', active: true, currency: 'chf', unit_amount: 2900, recurring: null };
  prixStripe.price_env = { livemode: true, id: 'price_env', active: true, currency: 'chf', unit_amount: 4900, recurring: { interval: 'month' } };
  prixStripe.price_ANCIEN_eur = { livemode: true, id: 'price_ANCIEN_eur', active: true, currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' } };
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('STRIPE_PRICE_ID_')) delete process.env[k];
});

describe('résolution des prix : la base fait autorité', () => {
  it('la base prime sur la variable d\'environnement', async () => {
    process.env.STRIPE_PRICE_ID_PRO_MONTHLY = 'price_env';
    process.env.STRIPE_PRICE_ID_PACK_MEDIUM = 'price_env_pack';
    expect(await prix.prixPlan('pro', 'monthly')).toBe('price_pro_m');
    expect(await prix.prixPlan('pro', 'yearly')).toBe('price_pro_y');
    expect(await prix.prixPack('medium')).toBe('price_pack_m');
  });

  it('variable en repli si la base n\'a rien ; undefined sinon', async () => {
    process.env.STRIPE_PRICE_ID_STARTER_MONTHLY = 'price_env_starter';
    expect(await prix.prixPlan('starter', 'monthly')).toBe('price_env_starter');
    expect(await prix.prixPlan('starter', 'yearly')).toBeUndefined();
    expect(await prix.prixPack('xlarge')).toBeUndefined();
  });

  it('planDepuisPrix / packDepuisPrix : base puis env, jamais un plan hors starter/pro/enterprise', async () => {
    process.env.STRIPE_PRICE_ID_ENTERPRISE_YEARLY = 'price_ent_y';
    expect(await prix.planDepuisPrix('price_pro_y')).toEqual({ plan: 'pro', cycle: 'yearly' });
    expect(await prix.planDepuisPrix('price_ent_y')).toEqual({ plan: 'enterprise', cycle: 'yearly' });
    base.tables.plans.push({ key: 'free', stripe_price_id: 'price_free' });
    expect(await prix.planDepuisPrix('price_free')).toBeNull();
    expect(await prix.planDepuisPrix(undefined)).toBeNull();
    expect(await prix.packDepuisPrix('price_pack_m')).toBe('medium');
  });

  it('offres : base d\'abord, constantes CHF en repli', async () => {
    base.tables.plans[0].credits = 700;
    expect(await prix.offrePlan('pro')).toEqual({ price_cents: 4900, yearly_price_cents: 4083, credits: 700 });
    expect(await prix.offrePlan('starter')).toEqual({ price_cents: 1900, yearly_price_cents: 1583, credits: 150 });
    expect(await prix.offrePack('xlarge')).toEqual({ price_cents: 17900, amount: 2000 });
    expect(await prix.creditsPourFacture('pro', 'yearly')).toBe(700 * 12);
  });

  it('verifierPrix refuse EUR, inactif, mauvais intervalle, récurrent pour un pack', async () => {
    const s = (await import('@/lib/stripe/client')).stripe as any;
    await expect(prix.verifierPrix(s, 'price_ANCIEN_eur', { recurrent: 'month', montant: 4900 })).rejects.toThrow(/EUR/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: 'year', montant: 4900 })).rejects.toThrow(/intervalle/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: null, montant: 4900 })).rejects.toThrow(/récurrent/);
    prixStripe.price_off = { livemode: true, active: false, currency: 'chf' };
    await expect(prix.verifierPrix(s, 'price_off', { recurrent: null, montant: 0 })).rejects.toThrow(/inactif/);
    await expect(prix.verifierPrix(s, 'absent', { recurrent: null, montant: 0 })).rejects.toThrow(/introuvable/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: 'month', montant: 4900 })).resolves.toBeUndefined();
  });

  it('montant attendu = BASE : mensuel au centime, annuel = équivalent mensuel × 12 à un demi-franc près', async () => {
    const s = (await import('@/lib/stripe/client')).stripe as any;
    const offre = await prix.offrePlan('pro');
    expect(prix.montantAttenduPlan(offre, 'monthly')).toEqual({ montant: 4900, tolerance: 0 });
    expect(prix.montantAttenduPlan(offre, 'yearly')).toEqual({ montant: 4083 * 12, tolerance: 50 });
    await expect(prix.verifierPrix(s, 'price_pro_y', { recurrent: 'year', ...prix.montantAttenduPlan(offre, 'yearly') })).resolves.toBeUndefined();
    prixStripe.price_pro_faux = { livemode: true, active: true, currency: 'chf', unit_amount: 7999, recurring: { interval: 'month' } };
    await expect(prix.verifierPrix(s, 'price_pro_faux', { recurrent: 'month', montant: 4900 })).rejects.toThrow(/7999 centimes au lieu de 4900/);
  });
});

describe('routes de checkout', () => {
  it('abonnement : prix de la BASE, vérifié, session avec marqueur et metadata', async () => {
    process.env.STRIPE_PRICE_ID_PRO_MONTHLY = 'price_env';
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(200);
    expect(sessionsCreees[0]).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_pro_m', quantity: 1 }],
      metadata: { app: 'studiio', userId: 'user-1', plan: 'pro', billingCycle: 'monthly' },
      subscription_data: { metadata: { app: 'studiio', userId: 'user-1', plan: 'pro', billingCycle: 'monthly' } },
    });
    expect(JSON.stringify(sessionsCreees[0])).not.toContain('price_data');
  });

  it('prix modifié par l\'admin en base (59 CHF) : un prix Stripe à 49 CHF est refusé (503)', async () => {
    base.tables.plans[0].price_cents = 5900;
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(503);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('abonnement : prix en base d\'un ancien compte EUR → 503, aucune session', async () => {
    base.tables.plans[0].stripe_price_id = 'price_ANCIEN_eur';
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(503);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('abonnement : rien de configuré → 503 explicite', async () => {
    const res = await checkoutRoute.POST(post({ plan: 'starter', billingCycle: 'yearly' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/prix non configuré/);
  });

  it('crédits du plan à 0 en base → 503 ; un écart avec les constantes n\'est PLUS bloquant', async () => {
    base.tables.plans[0].credits = 1000;
    expect((await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }))).status).toBe(200);
    base.tables.plans[0].credits = 0;
    expect((await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }))).status).toBe(503);
  });

  it('pack : prix et crédits de la BASE → session paiement unique avec marqueur', async () => {
    base.tables.credit_packs[0].amount = 250;
    const res = await packRoute.POST(post({ pack: 'medium' }));
    expect(res.status).toBe(200);
    expect(sessionsCreees[0]).toMatchObject({
      mode: 'payment',
      line_items: [{ price: 'price_pack_m', quantity: 1 }],
      metadata: { app: 'studiio', userId: 'user-1', packKey: 'medium', creditAmount: '250' },
      payment_intent_data: { metadata: { app: 'studiio', userId: 'user-1', packKey: 'medium', creditAmount: '250' } },
    });
  });

  it('pack : prix Stripe différent du prix en base → 503', async () => {
    base.tables.credit_packs[0].price_cents = 3500;
    const res = await packRoute.POST(post({ pack: 'medium' }));
    expect(res.status).toBe(503);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('pack : crédits à 0 en base → 503', async () => {
    base.tables.credit_packs[0].amount = 0;
    expect((await packRoute.POST(post({ pack: 'medium' }))).status).toBe(503);
  });

  it('I2 — déjà abonné (ligne active) → 409 renvoyant au portail, aucune session', async () => {
    base.tables.subscriptions.push({ user_id: 'user-1', status: 'past_due', plan: 'pro' });
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Gérer mon abonnement/);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('I2 — base en retard mais abonnement actif chez Stripe → 409', async () => {
    abonnementsClient.push({ id: 'sub_1', status: 'trialing' });
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'yearly' }));
    expect(res.status).toBe(409);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('I2 — ancien abonnement annulé → checkout annuel autorisé', async () => {
    base.tables.subscriptions.push({ user_id: 'user-1', status: 'canceled', plan: 'pro' });
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'yearly' }));
    expect(res.status).toBe(200);
    expect(sessionsCreees[0].line_items[0].price).toBe('price_pro_y');
  });

  it('/api/credits/purchase est retirée (410)', async () => {
    const res = await purchaseRoute.POST();
    expect(res.status).toBe(410);
    expect(sessionsCreees).toHaveLength(0);
  });
});

describe('libellés CHF (constantes de repli)', () => {
  it('aucun libellé affiché en euros', () => {
    const textes = JSON.stringify({ STRIPE_PLANS, CREDIT_PACKAGES });
    expect(textes).not.toMatch(/€|EUR/);
    expect(STRIPE_PLANS.starter.priceFr).toBe('19 CHF');
    expect(CREDIT_PACKAGES.xlarge.priceFr).toBe('179 CHF');
  });

  it('tarifs de lancement', () => {
    expect([STRIPE_PLANS.starter.price, STRIPE_PLANS.pro.price, STRIPE_PLANS.enterprise.price]).toEqual([1900, 4900, 14900]);
    expect([STRIPE_PLANS.starter.credits, STRIPE_PLANS.pro.credits, STRIPE_PLANS.enterprise.credits]).toEqual([150, 600, 2500]);
    expect(Object.values(CREDIT_PACKAGES).map((p) => [p.amount, p.price])).toEqual([[50, 900], [200, 2900], [500, 5900], [2000, 17900]]);
  });

  it('total annuel arrondi au franc : 190 / 490 / 1490 CHF', () => {
    expect(totalAnnuelCentimes(STRIPE_PLANS.starter.yearlyPrice)).toBe(19000);
    expect(totalAnnuelCentimes(STRIPE_PLANS.pro.yearlyPrice)).toBe(49000);
    expect(totalAnnuelCentimes(STRIPE_PLANS.enterprise.yearlyPrice)).toBe(149000);
    expect(totalAnnuelCentimes(0)).toBe(0);
  });
});
