import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS, CREDIT_PACKAGES } from '@/lib/stripe/constants';

// Cache stored on globalThis so it's shared across Next.js route bundles.
// Each API route compiles to its own bundle; without globalThis, each bundle
// has its own `plansCache`, and invalidation from update-plan wouldn't clear
// the copy used by /api/pricing.
interface PricingCacheStore {
  plans: any[] | null;
  plansTime: number;
  packs: any[] | null;
  packsTime: number;
}

const g = globalThis as unknown as { __studiioPricingCache?: PricingCacheStore };
if (!g.__studiioPricingCache) {
  g.__studiioPricingCache = { plans: null, plansTime: 0, packs: null, packsTime: 0 };
}
const store = g.__studiioPricingCache;

const CACHE_TTL = 5 * 60 * 1000;

export function invalidatePricingCache() {
  store.plans = null;
  store.plansTime = 0;
  store.packs = null;
  store.packsTime = 0;
}

export async function getPlans() {
  if (store.plans && Date.now() - store.plansTime < CACHE_TTL) return store.plans;
  try {
    const { data } = await supabaseAdmin.from('plans').select('*').eq('active', true).order('sort_order');
    if (data && data.length > 0) {
      store.plans = data;
      store.plansTime = Date.now();
      return data;
    }
  } catch {}
  return Object.entries(STRIPE_PLANS).map(([key, p], i) => ({
    key,
    name: p.name,
    price_cents: p.price,
    yearly_price_cents: p.yearlyPrice,
    credits: p.credits,
    features: p.features,
    watermark: p.watermark,
    max_socials: p.maxSocials === Infinity ? 999 : p.maxSocials,
    popular: (p as any).popular || false,
    active: true,
    sort_order: i,
  }));
}

export async function getPacks() {
  if (store.packs && Date.now() - store.packsTime < CACHE_TTL) return store.packs;
  try {
    const { data } = await supabaseAdmin.from('credit_packs').select('*').eq('active', true).order('sort_order');
    if (data && data.length > 0) {
      store.packs = data;
      store.packsTime = Date.now();
      return data;
    }
  } catch {}
  return Object.entries(CREDIT_PACKAGES).map(([key, p], i) => ({
    key,
    name: p.name,
    amount: p.amount,
    price_cents: p.price,
    popular: (p as any).popular || false,
    active: true,
    sort_order: i,
  }));
}
