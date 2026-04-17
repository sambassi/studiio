import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS, CREDIT_PACKAGES } from '@/lib/stripe/constants';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'].includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const plans = Object.entries(STRIPE_PLANS).map(([key, p], i) => ({
    key,
    name: p.name,
    price_cents: p.price,
    yearly_price_cents: (p as any).yearlyPrice || 0,
    credits: p.credits,
    features: JSON.stringify(p.features),
    watermark: p.watermark,
    max_socials: p.maxSocials === Infinity ? 999 : p.maxSocials,
    popular: (p as any).popular || false,
    active: true,
    sort_order: i,
  }));

  const packs = Object.entries(CREDIT_PACKAGES).map(([key, p], i) => ({
    key,
    name: p.name,
    amount: p.amount,
    price_cents: p.price,
    popular: (p as any).popular || false,
    active: true,
    sort_order: i,
  }));

  const { error: planErr } = await supabaseAdmin.from('plans').upsert(plans, { onConflict: 'key' });
  const { error: packErr } = await supabaseAdmin.from('credit_packs').upsert(packs, { onConflict: 'key' });

  // Pre-fill Stripe price IDs from env vars where DB is null
  for (const key of Object.keys(STRIPE_PLANS)) {
    if (key === 'free') continue;
    const K = key.toUpperCase();
    const monthlyEnv = process.env[`STRIPE_PRICE_ID_${K}_MONTHLY`];
    const yearlyEnv = process.env[`STRIPE_PRICE_ID_${K}_YEARLY`];
    if (monthlyEnv || yearlyEnv) {
      const { data: row } = await supabaseAdmin.from('plans').select('stripe_price_id, stripe_yearly_price_id').eq('key', key).single();
      const patch: Record<string, string> = {};
      if (monthlyEnv && !row?.stripe_price_id) patch.stripe_price_id = monthlyEnv;
      if (yearlyEnv && !row?.stripe_yearly_price_id) patch.stripe_yearly_price_id = yearlyEnv;
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from('plans').update(patch).eq('key', key);
      }
    }
  }

  for (const key of Object.keys(CREDIT_PACKAGES)) {
    const K = key.toUpperCase();
    const env = process.env[`STRIPE_PRICE_ID_PACK_${K}`];
    if (env) {
      const { data: row } = await supabaseAdmin.from('credit_packs').select('stripe_price_id').eq('key', key).single();
      if (!row?.stripe_price_id) {
        await supabaseAdmin.from('credit_packs').update({ stripe_price_id: env }).eq('key', key);
      }
    }
  }

  return NextResponse.json({
    success: !planErr && !packErr,
    plans: planErr?.message || `${plans.length} seeded`,
    packs: packErr?.message || `${packs.length} seeded`,
  });
}
