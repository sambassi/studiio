import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';

async function ensureProduct(key: string, name: string, existingProductId?: string | null): Promise<string> {
  if (existingProductId) {
    await stripe.products.update(existingProductId, { name: `Studiio ${name}` });
    return existingProductId;
  }
  const product = await stripe.products.create({
    name: `Studiio ${name}`,
    metadata: { plan_key: key },
  });
  return product.id;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'].includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { key, name, price_cents, yearly_price_cents, credits, features, popular, active, watermark } = body;
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  // Read current state from DB
  const { data: current } = await supabaseAdmin.from('plans').select('*').eq('key', key).single();

  const patch: Record<string, any> = {
    name, credits,
    features: typeof features === 'string' ? JSON.parse(features) : features,
    popular, active, watermark,
    updated_at: new Date().toISOString(),
  };

  // Free plan: no Stripe prices
  if (key === 'free') {
    patch.price_cents = 0;
    patch.yearly_price_cents = 0;
    const { error } = await supabaseAdmin.from('plans').update(patch).eq('key', key);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Paid plans: handle Stripe prices
  try {
    const productId = await ensureProduct(key, name, current?.stripe_product_id);
    patch.stripe_product_id = productId;
    patch.price_cents = price_cents;
    patch.yearly_price_cents = yearly_price_cents;

    // Monthly price changed?
    if (price_cents !== current?.price_cents) {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: price_cents,
        currency: 'eur',
        recurring: { interval: 'month' },
        metadata: { plan_key: key, cycle: 'monthly' },
      });
      if (current?.stripe_price_id) {
        try { await stripe.prices.update(current.stripe_price_id, { active: false }); } catch {}
      }
      patch.stripe_price_id = newPrice.id;
    }

    // Yearly price changed?
    if (yearly_price_cents !== current?.yearly_price_cents) {
      const yearlyUnitAmount = (yearly_price_cents || 0) * 12;
      const newYearlyPrice = await stripe.prices.create({
        product: productId,
        unit_amount: yearlyUnitAmount,
        currency: 'eur',
        recurring: { interval: 'year' },
        metadata: { plan_key: key, cycle: 'yearly' },
      });
      if (current?.stripe_yearly_price_id) {
        try { await stripe.prices.update(current.stripe_yearly_price_id, { active: false }); } catch {}
      }
      patch.stripe_yearly_price_id = newYearlyPrice.id;
    }
  } catch (stripeErr: any) {
    console.error('[update-plan] Stripe error:', stripeErr.message);
    return NextResponse.json({ success: false, error: `Stripe: ${stripeErr.message}` }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('plans').update(patch).eq('key', key);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
