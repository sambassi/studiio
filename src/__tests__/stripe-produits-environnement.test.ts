import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nouvelleBase, clientFactice, type FausseBase } from './helpers/stripe-fausse-base';

/**
 * Produits Stripe par environnement (staging = TEST, prod = LIVE) :
 *   - ordre : stripe_product_id en base (vérifié), puis STRIPE_PRODUCT_ID_*,
 *     puis constantes LIVE — ces dernières JAMAIS avec une clé test ;
 *   - produit ou prix dont le livemode ≠ mode de la clé → erreur, et
 *     confirm=true n'écrit rien ; id en base introuvable → erreur, pas de
 *     remplacement silencieux ; metadata.app ≠ studiio → erreur ;
 *   - verifierPrix (checkout / packs) : prix d'un autre mode → 503 ;
 *   - la clé n'apparaît jamais dans un journal.
 * Stripe entièrement mocké : aucun appel réel.
 */

let base: FausseBase;
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: clientFactice(() => base),
  supabase: clientFactice(() => base),
}));

// Univers Stripe factice : produits et prix visibles avec la clé courante.
let produitsStripe: Record<string, any> = {};
let prixParProduit: Record<string, any[]> = {};
let prixParId: Record<string, any> = {};
const produitsLus: string[] = [];
vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    products: {
      retrieve: vi.fn(async (id: string) => {
        produitsLus.push(id);
        if (!produitsStripe[id]) throw Object.assign(new Error(`No such product: '${id}'`), { code: 'resource_missing', statusCode: 404 });
        return produitsStripe[id];
      }),
    },
    prices: {
      list: vi.fn(async (p: any) => ({ data: prixParProduit[p.product] ?? [], has_more: false })),
      retrieve: vi.fn(async (id: string) => {
        if (!prixParId[id]) throw new Error(`No such price: '${id}'`);
        return prixParId[id];
      }),
    },
    customers: { retrieve: vi.fn(async (id: string) => ({ id })) },
    subscriptions: { list: vi.fn(async () => ({ data: [] })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: 'https://checkout.test/s' })) } },
  },
  createCustomer: vi.fn(async () => ({ id: 'cus_new' })),
}));

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async () => ({ error: null, session: { user: { id: 'a', email: 'contact.artboost@gmail.com' } } })),
  logAdminAction: vi.fn(async () => {}),
}));
vi.mock('@/lib/pricing/fetch', () => ({ invalidatePricingCache: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1', email: 'u@test.ch', name: 'U' } })),
}));

const sync = await import('@/app/api/admin/pricing/sync-stripe/route');
const checkoutRoute = await import('@/app/api/stripe/create-checkout/route');
const packRoute = await import('@/app/api/credits/purchase-pack/route');
const produitsMod = await import('@/lib/stripe/produits');
const { PRODUITS_STRIPE_PLANS, PRODUITS_STRIPE_PACKS, modeStripe, resoudreProduit } = produitsMod;
const CONSTANTES_LIVE = [...Object.values(PRODUITS_STRIPE_PLANS), ...Object.values(PRODUITS_STRIPE_PACKS)];

const CLE_TEST = 'sk_test_SECRETfactice123';
const CLE_LIVE = 'sk_live_SECRETfactice456';
const VARIABLES = {
  STRIPE_PRODUCT_ID_STARTER: ['plans', 'starter'], STRIPE_PRODUCT_ID_PRO: ['plans', 'pro'],
  STRIPE_PRODUCT_ID_ENTERPRISE: ['plans', 'enterprise'],
  STRIPE_PRODUCT_ID_PACK_SMALL: ['credit_packs', 'small'], STRIPE_PRODUCT_ID_PACK_MEDIUM: ['credit_packs', 'medium'],
  STRIPE_PRODUCT_ID_PACK_LARGE: ['credit_packs', 'large'], STRIPE_PRODUCT_ID_PACK_XLARGE: ['credit_packs', 'xlarge'],
} as const;

const post = (body: any) => new Request('http://localhost/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as any;

const montants: Record<string, number> = { starter: 1900, pro: 4900, enterprise: 14900, small: 900, medium: 2900, large: 5900, xlarge: 17900 };

/** Déclare dans l'univers factice un produit et ses prix CHF, dans un mode donné. */
function declarer(id: string, key: string, table: string, live: boolean, extraProduit: any = {}) {
  produitsStripe[id] = { id, livemode: live, metadata: { app: 'studiio' }, ...extraProduit };
  const base = { active: true, currency: 'chf', livemode: live };
  prixParProduit[id] = table === 'plans'
    ? [
        { ...base, id: `${id}_m`, unit_amount: montants[key], recurring: { interval: 'month', interval_count: 1 } },
        { ...base, id: `${id}_y`, unit_amount: montants[key] * 10, recurring: { interval: 'year', interval_count: 1 } },
      ]
    : [{ ...base, id: `${id}_u`, unit_amount: montants[key], recurring: null }];
}

/** Univers TEST (produits prod_test_*) + univers LIVE (constantes) — seul l'un est visible selon la clé. */
function universTest() {
  for (const [table, key] of Object.values(VARIABLES)) declarer(`prod_test_${key}`, key, table, false);
}
function universLive() {
  for (const [key, id] of Object.entries(PRODUITS_STRIPE_PLANS)) declarer(id, key, 'plans', true);
  for (const [key, id] of Object.entries(PRODUITS_STRIPE_PACKS)) declarer(id, key, 'credit_packs', true);
}
function variablesTest() {
  for (const [nom, [, key]] of Object.entries(VARIABLES)) process.env[nom] = `prod_test_${key}`;
}

let journaux: string[] = [];
beforeEach(() => {
  base = nouvelleBase();
  produitsStripe = {}; prixParProduit = {}; prixParId = {};
  produitsLus.length = 0;
  journaux = [];
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: any[]) => { journaux.push(a.map(String).join(' ')); });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STRIPE_SECRET_KEY;
  for (const k of Object.keys(process.env)) if (k.startsWith('STRIPE_PRODUCT_ID_') || k.startsWith('STRIPE_PRICE_ID_')) delete process.env[k];
  // La clé ne doit JAMAIS apparaître dans un journal.
  expect(journaux.join('\n')).not.toMatch(/SECRETfactice/);
});

describe('mode de la clé', () => {
  it('déduit du préfixe, erreur claire sans jamais citer la clé', () => {
    expect(modeStripe('sk_test_x')).toBe('test');
    expect(modeStripe('rk_test_x')).toBe('test');
    expect(modeStripe('sk_live_x')).toBe('live');
    expect(modeStripe('rk_live_x')).toBe('live');
    expect(() => modeStripe(undefined)).toThrow(/STRIPE_SECRET_KEY absente ou de format inconnu/);
    let msg = '';
    try { modeStripe('pk_live_SECRETfactice'); } catch (e: any) { msg = e.message; }
    expect(msg).toMatch(/format inconnu/);
    expect(msg).not.toMatch(/SECRETfactice/);
  });

  it('resoudreProduit : base > variable > constante LIVE (clé live seulement)', () => {
    process.env.STRIPE_PRODUCT_ID_PACK_SMALL = 'prod_var';
    expect(resoudreProduit('credit_packs', 'small', 'prod_base', 'test')).toEqual({ id: 'prod_base', source: 'base' });
    expect(resoudreProduit('credit_packs', 'small', null, 'test')).toEqual({ id: 'prod_var', source: 'variable' });
    expect(resoudreProduit('plans', 'pro', null, 'live')).toEqual({ id: PRODUITS_STRIPE_PLANS.pro, source: 'constante' });
    const r = resoudreProduit('plans', 'pro', null, 'test');
    expect(r.id).toBeNull();
    expect((r as any).erreur).toMatch(/configurez STRIPE_PRODUCT_ID_PRO/);
  });
});

describe('sync-stripe par environnement', () => {
  it('clé TEST + variables → produits TEST utilisés et écrits', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universTest(); variablesTest();
    const res = await sync.POST(post({ confirm: true }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.mode).toBe('test');
    expect(corps.erreurs).toEqual([]);
    expect(base.tables.plans.find((p) => p.key === 'pro')).toMatchObject({ stripe_product_id: 'prod_test_pro', stripe_price_id: 'prod_test_pro_m' });
    expect(base.tables.credit_packs.find((p) => p.key === 'xlarge')).toMatchObject({ stripe_product_id: 'prod_test_xlarge', stripe_price_id: 'prod_test_xlarge_u' });
    expect(produitsLus.some((id) => (CONSTANTES_LIVE as string[]).includes(id))).toBe(false);
  });

  it('clé TEST sans variable → une erreur par produit, AUCUNE constante LIVE lue ni écrite', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universLive(); // même si ces produits « existaient », ils ne doivent pas être touchés
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.success).toBe(false);
    expect(dry.erreurs).toHaveLength(7);
    for (const nom of Object.keys(VARIABLES)) expect(dry.erreurs.join('\n')).toContain(`configurez ${nom}`);
    expect(produitsLus).toEqual([]);
    const res = await sync.POST(post({ confirm: true }));
    expect(res.status).toBe(422);
    expect(base.tables.plans).toHaveLength(0);
    expect(base.tables.credit_packs).toHaveLength(0);
  });

  it('clé LIVE sans variable → constantes LIVE', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_LIVE;
    universLive();
    const res = await sync.POST(post({ confirm: true }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.mode).toBe('live');
    expect(base.tables.plans.find((p) => p.key === 'starter')!.stripe_product_id).toBe(PRODUITS_STRIPE_PLANS.starter);
    expect(base.tables.credit_packs.find((p) => p.key === 'small')!.stripe_product_id).toBe(PRODUITS_STRIPE_PACKS.small);
  });

  it('id LIVE en base + clé TEST → refus (livemode), aucune écriture, pas de repli silencieux', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universTest(); variablesTest();
    // Le produit live « visible » avec livemode=true : cas d'une base copiée depuis la prod.
    declarer(PRODUITS_STRIPE_PLANS.pro, 'pro', 'plans', true);
    base.tables.plans.push({ key: 'pro', name: 'Pro', credits: 600, price_cents: 4900, stripe_product_id: PRODUITS_STRIPE_PLANS.pro, stripe_price_id: 'price_live_m' });
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join('\n')).toMatch(/plan pro : produit LIVE alors que la clé est en mode test/);
    expect(dry.lignes.find((l: any) => l.key === 'pro')).toBeUndefined();
    const res = await sync.POST(post({ confirm: true }));
    expect(res.status).toBe(422);
    expect(base.tables.plans).toEqual([expect.objectContaining({ key: 'pro', stripe_product_id: PRODUITS_STRIPE_PLANS.pro, stripe_price_id: 'price_live_m' })]);
    expect(base.tables.credit_packs).toHaveLength(0);
  });

  it('id en base introuvable dans ce mode → erreur claire, jamais remplacé par la variable', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universTest(); variablesTest();
    base.tables.credit_packs.push({ key: 'medium', name: '200', amount: 200, price_cents: 2900, stripe_product_id: 'prod_ancien' });
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join('\n')).toMatch(/pack medium : produit introuvable en mode test \(prod_ancien, stripe_product_id en base\) — corrigez-le en base \(credit_packs\.stripe_product_id\)/);
    expect(dry.lignes.find((l: any) => l.key === 'medium')).toBeUndefined();
    expect((await sync.POST(post({ confirm: true }))).status).toBe(422);
    expect(base.tables.credit_packs[0].stripe_product_id).toBe('prod_ancien');
  });

  it('prix au livemode incohérent → refus', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universTest(); variablesTest();
    prixParProduit.prod_test_starter[0].livemode = true;
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join('\n')).toMatch(/plan starter \(prod_test_starter\) : prix hors mode test \(prod_test_starter_m\)/);
    expect((await sync.POST(post({ confirm: true }))).status).toBe(422);
    expect(base.tables.plans).toHaveLength(0);
  });

  it('metadata.app d\'une autre application → refus', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    universTest(); variablesTest();
    produitsStripe.prod_test_large.metadata = { app: 'afroboost' };
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join('\n')).toMatch(/pack large : produit marqué app=afroboost/);
  });

  it('clé absente → erreur claire (502), rien écrit', async () => {
    universLive();
    const res = await sync.POST(post({ confirm: true }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/STRIPE_SECRET_KEY absente/);
    expect(base.tables.plans).toHaveLength(0);
  });
});

describe('checkout / packs : prix d\'un autre mode → 503', () => {
  beforeEach(() => {
    base.tables.users.push({ id: 'user-1', credits: 10, stripe_customer_id: 'cus_1' });
    base.tables.plans.push({ key: 'pro', credits: 600, price_cents: 4900, yearly_price_cents: 4083, stripe_price_id: 'price_m', stripe_yearly_price_id: 'price_y' });
    base.tables.credit_packs.push({ key: 'medium', amount: 200, price_cents: 2900, stripe_price_id: 'price_pack' });
    prixParId.price_m = { id: 'price_m', livemode: true, active: true, currency: 'chf', unit_amount: 4900, recurring: { interval: 'month' } };
    prixParId.price_pack = { id: 'price_pack', livemode: true, active: true, currency: 'chf', unit_amount: 2900, recurring: null };
  });

  it('clé TEST + prix LIVE → 503 (abonnement et pack)', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_TEST;
    expect((await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }))).status).toBe(503);
    expect((await packRoute.POST(post({ pack: 'medium' }))).status).toBe(503);
    expect(journaux.join('\n')).toMatch(/prix Stripe LIVE alors que la clé est en mode test/);
  });

  it('clé LIVE + prix LIVE → accepté', async () => {
    process.env.STRIPE_SECRET_KEY = CLE_LIVE;
    expect((await checkoutRoute.POST(post({ plan: 'pro', billingCycle: 'monthly' }))).status).toBe(200);
  });
});
