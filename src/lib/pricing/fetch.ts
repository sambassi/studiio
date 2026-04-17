import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS, CREDIT_PACKAGES } from '@/lib/stripe/constants';

let plansCache: any[] | null = null;
let plansCacheTime = 0;
let packsCache: any[] | null = null;
let packsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function getPlans() {
  if (plansCache && Date.now() - plansCacheTime < CACHE_TTL) return plansCache;
  try {
    const { data } = await supabaseAdmin.from('plans').select('*').eq('active', true).order('sort_order');
    if (data && data.length > 0) {
      plansCache = data;
      plansCacheTime = Date.now();
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
  if (packsCache && Date.now() - packsCacheTime < CACHE_TTL) return packsCache;
  try {
    const { data } = await supabaseAdmin.from('credit_packs').select('*').eq('active', true).order('sort_order');
    if (data && data.length > 0) {
      packsCache = data;
      packsCacheTime = Date.now();
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
