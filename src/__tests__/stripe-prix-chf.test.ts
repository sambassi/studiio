import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nouvelleBase, clientFactice, type FausseBase } from './helpers/stripe-fausse-base';

/**
 * Prix Stripe au lancement CHF :
 *   - les variables `STRIPE_PRICE_ID_*` priment sur la base (qui peut garder
 *     des identifiants de l'ancien compte EUR) ;
 *   - aucun prix configuré → erreur claire (503), jamais de `price_data` ;
 *   - un prix non CHF, inactif ou du mauvais type est refusé avant checkout ;
 *   - `/api/credits/purchase` (montant libre, jamais crédité) est retirée ;
 *   - libellés et total annuel en CHF.
 */

let base: FausseBase;
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: clientFactice(() => base),
  supabase: clientFactice(() => base),
}));

const prixStripe: Record<string, any> = {};
const sessionsCreees: any[] = [];
vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    prices: {
      retrieve: vi.fn(async (id: string) => {
        if (!prixStripe[id]) throw new Error(`No such price: '${id}'`);
        return prixStripe[id];
      }),
    },
    customers: { retrieve: vi.fn(async (id: string) => ({ id })) },
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
  base = nouvelleBase();
  base.tables.users.push({ id: 'user-1', credits: 10, stripe_customer_id: 'cus_1' });
  base.tables.plans.push({ key: 'pro', credits: 600, stripe_price_id: 'price_ANCIEN_eur', stripe_yearly_price_id: null });
  base.tables.credit_packs.push({ key: 'medium', amount: 200, stripe_price_id: 'price_ANCIEN_pack' });
  for (const k of Object.keys(prixStripe)) delete prixStripe[k];
  sessionsCreees.length = 0;
  prixStripe.price_pro_m = { id: 'price_pro_m', active: true, currency: 'chf', recurring: { interval: 'month' } };
  prixStripe.price_pack_m = { id: 'price_pack_m', active: true, currency: 'chf', recurring: null };
  prixStripe.price_ANCIEN_eur = { id: 'price_ANCIEN_eur', active: true, currency: 'eur', recurring: { interval: 'month' } };
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('STRIPE_PRICE_ID_')) delete process.env[k];
});

describe('résolution des prix', () => {
  it('la variable d\'environnement prime sur la base', async () => {
    process.env.STRIPE_PRICE_ID_PRO_MONTHLY = 'price_pro_m';
    expect(await prix.prixPlan('pro', 'monthly')).toBe('price_pro_m');
    process.env.STRIPE_PRICE_ID_PACK_MEDIUM = 'price_pack_m';
    expect(await prix.prixPack('medium')).toBe('price_pack_m');
  });

  it('base en repli, undefined si rien', async () => {
    expect(await prix.prixPlan('pro', 'monthly')).toBe('price_ANCIEN_eur');
    expect(await prix.prixPlan('pro', 'yearly')).toBeUndefined();
    expect(await prix.prixPlan('starter', 'monthly')).toBeUndefined();
  });

  it('planDepuisPrix : env puis base, jamais un plan hors starter/pro/enterprise', async () => {
    process.env.STRIPE_PRICE_ID_ENTERPRISE_YEARLY = 'price_ent_y';
    expect(await prix.planDepuisPrix('price_ent_y')).toEqual({ plan: 'enterprise', cycle: 'yearly' });
    expect(await prix.planDepuisPrix('price_ANCIEN_eur')).toEqual({ plan: 'pro', cycle: 'monthly' });
    base.tables.plans.push({ key: 'free', stripe_price_id: 'price_free' });
    expect(await prix.planDepuisPrix('price_free')).toBeNull();
    expect(await prix.planDepuisPrix('inconnu')).toBeNull();
    expect(await prix.planDepuisPrix(undefined)).toBeNull();
  });

  it('crédits : base (affichée) d\'abord, constantes en repli, ×12 en annuel', async () => {
    expect(await prix.creditsPourFacture('pro', 'monthly')).toBe(600);
    expect(await prix.creditsPourFacture('pro', 'yearly')).toBe(7200);
    expect(await prix.creditsPourFacture('enterprise', 'yearly')).toBe(STRIPE_PLANS.enterprise.credits * 12);
  });

  it('verifierPrix refuse EUR, inactif, mauvais intervalle, récurrent pour un pack', async () => {
    const s = (await import('@/lib/stripe/client')).stripe as any;
    await expect(prix.verifierPrix(s, 'price_ANCIEN_eur', { recurrent: 'month' })).rejects.toThrow(/EUR/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: 'year' })).rejects.toThrow(/intervalle/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: null })).rejects.toThrow(/récurrent/);
    prixStripe.price_off = { active: false, currency: 'chf' };
    await expect(prix.verifierPrix(s, 'price_off', { recurrent: null })).rejects.toThrow(/inactif/);
    await expect(prix.verifierPrix(s, 'absent', { recurrent: null })).rejects.toThrow(/introuvable/);
    await expect(prix.verifierPrix(s, 'price_pro_m', { recurrent: 'month' })).resolves.toBeUndefined();
  });
});

describe('routes de checkout', () => {
  it('abonnement : prix env CHF → session avec ce prix et les metadata', async () => {
    process.env.STRIPE_PRICE_ID_PRO_MONTHLY = 'price_pro_m';
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(200);
    expect(sessionsCreees[0]).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_pro_m', quantity: 1 }],
      metadata: { userId: 'user-1', plan: 'pro', billingCycle: 'monthly' },
      subscription_data: { metadata: { userId: 'user-1', plan: 'pro', billingCycle: 'monthly' } },
    });
    expect(JSON.stringify(sessionsCreees[0])).not.toContain('price_data');
  });

  it('abonnement : seul un ancien prix EUR en base → 503, aucune session', async () => {
    const res = await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(503);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('abonnement : rien de configuré → 503 explicite', async () => {
    const res = await checkoutRoute.POST(post({ plan: 'starter', billingCycle: 'yearly' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/prix non configuré/);
  });

  it('pack : prix env CHF → session paiement unique avec creditAmount', async () => {
    process.env.STRIPE_PRICE_ID_PACK_MEDIUM = 'price_pack_m';
    const res = await packRoute.POST(post({ pack: 'medium' }));
    expect(res.status).toBe(200);
    expect(sessionsCreees[0]).toMatchObject({
      mode: 'payment',
      line_items: [{ price: 'price_pack_m', quantity: 1 }],
      metadata: { userId: 'user-1', packKey: 'medium', creditAmount: '200' },
    });
  });

  it('pack : ancien prix inconnu du compte → 503, aucune session', async () => {
    const res = await packRoute.POST(post({ pack: 'medium' }));
    expect(res.status).toBe(503);
    expect(sessionsCreees).toHaveLength(0);
  });

  it('/api/credits/purchase est retirée (410)', async () => {
    const res = await purchaseRoute.POST();
    expect(res.status).toBe(410);
    expect(sessionsCreees).toHaveLength(0);
  });
});

describe('libellés CHF', () => {
  it('aucun libellé affiché en euros', () => {
    const textes = JSON.stringify({ STRIPE_PLANS, CREDIT_PACKAGES });
    expect(textes).not.toMatch(/€|EUR/);
    expect(STRIPE_PLANS.starter.priceFr).toBe('19 CHF');
    expect(CREDIT_PACKAGES.xlarge.priceFr).toBe('179 CHF');
  });

  it('tarifs décidés', () => {
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
