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
    yearly_price_cents: p.yearlyPrice || 0,
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

  return NextResponse.json({
    success: !planErr && !packErr,
    plans: planErr?.message || `${plans.length} seeded`,
    packs: packErr?.message || `${packs.length} seeded`,
  });
}
