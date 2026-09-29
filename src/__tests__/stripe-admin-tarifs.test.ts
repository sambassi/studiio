import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nouvelleBase, clientFactice, type FausseBase } from './helpers/stripe-fausse-base';

/**
 * Administration des tarifs (la base fait autorité) :
 *   - /api/admin/pricing/sync-stripe : dryRun par défaut (diff, aucune
 *     écriture) ; confirm=true écrit ; un prix manquant ou AMBIGU chez
 *     Stripe bloque toute écriture ; admin seulement ; journalisé ;
 *   - update-plan / update-pack : CHF, marqueur app sur produit et prix,
 *     ordre sûr (créer → écrire en base → désactiver l'ancien).
 * Stripe entièrement mocké : aucun appel réel.
 */

let base: FausseBase;
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: clientFactice(() => base),
  supabase: clientFactice(() => base),
}));

let prixParProduit: Record<string, any[]> = {};
const crees: any[] = [];
const desactives: string[] = [];
const produits: any[] = [];
let echecDesactivation = false;
vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    prices: {
      list: vi.fn(async (p: any) => ({ data: prixParProduit[p.product] ?? [], has_more: false })),
      create: vi.fn(async (p: any) => { crees.push(p); return { id: `price_new_${crees.length}` }; }),
      update: vi.fn(async (id: string, p: any) => {
        if (echecDesactivation) throw new Error('Stripe indisponible');
        if (p.active === false) desactives.push(id);
        return { id };
      }),
    },
    products: {
      retrieve: vi.fn(async (id: string) => ({ id, livemode: true, metadata: { app: 'studiio' } })),
      create: vi.fn(async (p: any) => { produits.push(p); return { id: 'prod_new' }; }),
      update: vi.fn(async (id: string, p: any) => { produits.push({ id, ...p }); return { id }; }),
    },
  },
}));

let estAdmin = true;
const journal: any[] = [];
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async () => (estAdmin
    ? { error: null, session: { user: { id: 'a', email: 'contact.artboost@gmail.com' } } }
    : { error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), session: null })),
  logAdminAction: vi.fn(async (p: any) => { journal.push(p); }),
}));
vi.mock('@/lib/pricing/fetch', () => ({ invalidatePricingCache: vi.fn() }));

const sync = await import('@/app/api/admin/pricing/sync-stripe/route');
const updatePlan = await import('@/app/api/admin/pricing/update-plan/route');
const updatePack = await import('@/app/api/admin/pricing/update-pack/route');
const { PRODUITS_STRIPE_PLANS, PRODUITS_STRIPE_PACKS } = await import('@/lib/stripe/produits');

const post = (body: any) => new Request('http://localhost/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as any;

const prixM = (id: string, montant: number, extra: any = {}) => ({ id, livemode: true, active: true, currency: 'chf', unit_amount: montant, recurring: { interval: 'month', interval_count: 1 }, ...extra });
const prixY = (id: string, montant: number) => ({ id, livemode: true, active: true, currency: 'chf', unit_amount: montant, recurring: { interval: 'year', interval_count: 1 } });
const prixU = (id: string, montant: number) => ({ id, livemode: true, active: true, currency: 'chf', unit_amount: montant, recurring: null });

function stripeComplet() {
  prixParProduit = {
    [PRODUITS_STRIPE_PLANS.starter]: [prixM('p_s_m', 1900), prixY('p_s_y', 19000)],
    [PRODUITS_STRIPE_PLANS.pro]: [prixM('p_p_m', 4900), prixY('p_p_y', 49000), { ...prixM('p_p_eur', 4900), currency: 'eur' }],
    [PRODUITS_STRIPE_PLANS.enterprise]: [prixM('p_e_m', 14900), prixY('p_e_y', 149000)],
    [PRODUITS_STRIPE_PACKS.small]: [prixU('p_k_s', 900)],
    [PRODUITS_STRIPE_PACKS.medium]: [prixU('p_k_m', 2900)],
    [PRODUITS_STRIPE_PACKS.large]: [prixU('p_k_l', 5900)],
    [PRODUITS_STRIPE_PACKS.xlarge]: [prixU('p_k_x', 17900)],
  };
}

beforeEach(() => {
  // Préfixe seul : clé factice, jamais utilisée (Stripe est mocké).
  process.env.STRIPE_SECRET_KEY = 'sk_live_factice';
  base = nouvelleBase();
  estAdmin = true;
  journal.length = 0; crees.length = 0; desactives.length = 0; produits.length = 0;
  echecDesactivation = false;
  stripeComplet();
  base.tables.plans.push(
    { key: 'starter', name: 'Starter', credits: 150, price_cents: 1900, yearly_price_cents: 1583, stripe_price_id: 'price_ANCIEN' },
    { key: 'pro', name: 'Pro', credits: 600, price_cents: 4900, yearly_price_cents: 4083 },
  );
  base.tables.credit_packs.push({ key: 'medium', name: '200 crédits', amount: 200, price_cents: 2900 });
});

describe('POST /api/admin/pricing/sync-stripe', () => {
  it('non admin → 403, rien lu ni écrit', async () => {
    estAdmin = false;
    const res = await sync.POST(post({ confirm: true }));
    expect(res.status).toBe(403);
    expect(base.tables.plans[0].stripe_price_id).toBe('price_ANCIEN');
  });

  it('dryRun par défaut : renvoie le diff, n\'écrit RIEN, journalise', async () => {
    const res = await sync.POST(post({}));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.dryRun).toBe(true);
    expect(corps.erreurs).toEqual([]);
    const starter = corps.lignes.find((l: any) => l.key === 'starter');
    expect(starter.champs.stripe_price_id).toEqual({ avant: 'price_ANCIEN', apres: 'p_s_m' });
    expect(starter.champs.stripe_yearly_price_id).toEqual({ avant: null, apres: 'p_s_y' });
    expect(starter.champs.yearly_price_cents).toEqual({ avant: 1583, apres: 1583 });
    expect(starter.credits).toBe(150);
    // Le prix EUR du produit Pro est écarté (CHF seulement).
    expect(corps.lignes.find((l: any) => l.key === 'pro').champs.stripe_price_id.apres).toBe('p_p_m');
    expect(corps.lignes.filter((l: any) => l.table === 'credit_packs')).toHaveLength(4);
    expect(base.tables.plans[0].stripe_price_id).toBe('price_ANCIEN');
    expect(base.tables.plans).toHaveLength(2);
    expect(journal[0].action).toBe('pricing.sync_stripe.dry_run');
  });

  it('confirm=true : écrit ids, produit et montants ; crée les lignes absentes ; journalise', async () => {
    const res = await sync.POST(post({ confirm: true }));
    const corps = await res.json();
    expect(res.status).toBe(200);
    expect(corps.success).toBe(true);
    const starter = base.tables.plans.find((p) => p.key === 'starter')!;
    expect(starter).toMatchObject({
      stripe_product_id: PRODUITS_STRIPE_PLANS.starter, stripe_price_id: 'p_s_m', stripe_yearly_price_id: 'p_s_y',
      price_cents: 1900, yearly_price_cents: 1583, credits: 150,
    });
    const enterprise = base.tables.plans.find((p) => p.key === 'enterprise')!;
    expect(enterprise).toMatchObject({ name: 'Enterprise', credits: 2500, price_cents: 14900, yearly_price_cents: 12417, stripe_yearly_price_id: 'p_e_y' });
    expect(base.tables.credit_packs.find((p) => p.key === 'xlarge')).toMatchObject({ amount: 2000, price_cents: 17900, stripe_price_id: 'p_k_x' });
    expect(journal.some((j) => j.action === 'pricing.sync_stripe')).toBe(true);
  });

  it('stripe_product_id en base prime sur la constante', async () => {
    base.tables.plans[1].stripe_product_id = 'prod_pro_perso';
    prixParProduit.prod_pro_perso = [prixM('p_perso_m', 5900), prixY('p_perso_y', 59000)];
    const corps = await (await sync.POST(post({}))).json();
    const pro = corps.lignes.find((l: any) => l.key === 'pro');
    expect(pro.champs.stripe_price_id.apres).toBe('p_perso_m');
    expect(pro.champs.price_cents).toEqual({ avant: 4900, apres: 5900 });
  });

  it('plusieurs prix mensuels actifs → erreur, et confirm n\'écrit RIEN (422)', async () => {
    prixParProduit[PRODUITS_STRIPE_PLANS.pro].push(prixM('p_p_m2', 5900));
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join(' ')).toMatch(/plan pro mensuel.*2 prix actifs candidats/);
    const res = await sync.POST(post({ confirm: true }));
    expect(res.status).toBe(422);
    expect(base.tables.plans[0].stripe_price_id).toBe('price_ANCIEN');
    expect(base.tables.credit_packs).toHaveLength(1);
  });

  it('pack sans prix unique actif → erreur explicite', async () => {
    prixParProduit[PRODUITS_STRIPE_PACKS.large] = [];
    const dry = await (await sync.POST(post({}))).json();
    expect(dry.erreurs.join(' ')).toMatch(/pack large.*aucun prix actif en CHF/);
  });
});

describe('update-plan / update-pack : ordre sûr', () => {
  const plan = { key: 'pro', name: 'Pro', price_cents: 5900, yearly_price_cents: 4917, credits: 700, features: [], popular: true, active: true, watermark: false };

  beforeEach(() => {
    Object.assign(base.tables.plans[1], { stripe_product_id: 'prod_pro', stripe_price_id: 'old_m', stripe_yearly_price_id: 'old_y' });
  });

  it('crée les prix en CHF avec marqueur, écrit en base, PUIS désactive les anciens', async () => {
    const res = await updatePlan.POST(post(plan));
    expect(res.status).toBe(200);
    expect(crees[0]).toMatchObject({ currency: 'chf', unit_amount: 5900, recurring: { interval: 'month' }, metadata: { app: 'studiio' } });
    expect(crees[1]).toMatchObject({ currency: 'chf', unit_amount: 59000, recurring: { interval: 'year' }, metadata: { app: 'studiio' } });
    expect(produits[0]).toMatchObject({ metadata: { app: 'studiio' } });
    expect(base.tables.plans[1]).toMatchObject({ stripe_price_id: 'price_new_1', stripe_yearly_price_id: 'price_new_2', credits: 700 });
    expect(desactives).toEqual(['old_m', 'old_y']);
  });

  it('écriture en base en échec → 500, les anciens prix restent ACTIFS et référencés', async () => {
    base.pannes['plans:update'] = { message: 'connexion perdue' };
    const res = await updatePlan.POST(post(plan));
    expect(res.status).toBe(500);
    expect(desactives).toEqual([]);
    expect(base.tables.plans[1].stripe_price_id).toBe('old_m');
  });

  it('désactivation en échec → journalisée, la mise à jour reste acquise', async () => {
    echecDesactivation = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await updatePlan.POST(post(plan));
    expect(res.status).toBe(200);
    expect(base.tables.plans[1].stripe_price_id).toBe('price_new_1');
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/desactivation/), 'old_m', expect.any(String));
    err.mockRestore();
  });

  it('crédits ou prix à 0 refusés (400)', async () => {
    expect((await updatePlan.POST(post({ ...plan, credits: 0 }))).status).toBe(400);
    expect((await updatePack.POST(post({ key: 'medium', name: 'x', amount: 200, price_cents: 0 }))).status).toBe(400);
  });

  it('pack : prix CHF avec marqueur, base écrite, ancien désactivé ensuite', async () => {
    base.tables.credit_packs[0].stripe_price_id = 'old_pack';
    base.tables.credit_packs[0].stripe_product_id = 'prod_pack';
    const res = await updatePack.POST(post({ key: 'medium', name: '250 crédits', amount: 250, price_cents: 3500, popular: false, active: true }));
    expect(res.status).toBe(200);
    expect(crees[0]).toMatchObject({ currency: 'chf', unit_amount: 3500, metadata: { app: 'studiio', credits: '250' } });
    expect(base.tables.credit_packs[0]).toMatchObject({ amount: 250, price_cents: 3500, stripe_price_id: 'price_new_1' });
    expect(desactives).toEqual(['old_pack']);
  });

  it('pack : écriture en base en échec → ancien prix NON désactivé', async () => {
    base.tables.credit_packs[0].stripe_price_id = 'old_pack';
    base.pannes['credit_packs:update'] = { message: 'x' };
    const res = await updatePack.POST(post({ key: 'medium', name: '250', amount: 250, price_cents: 3500 }));
    expect(res.status).toBe(500);
    expect(desactives).toEqual([]);
  });
});
