import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'].includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { key, name, amount, price_cents, popular, active } = body;
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  const { data: current } = await supabaseAdmin.from('credit_packs').select('*').eq('key', key).single();

  const patch: Record<string, any> = {
    name, amount, price_cents, popular, active,
    updated_at: new Date().toISOString(),
  };

  try {
    let productId = current?.stripe_product_id;
    if (!productId) {
      const product = await stripe.products.create({
        name: `Studiio Credits — ${name}`,
        metadata: { pack_key: key },
      });
      productId = product.id;
    } else {
      await stripe.products.update(productId, { name: `Studiio Credits — ${name}` });
    }
    patch.stripe_product_id = productId;

    if (price_cents !== current?.price_cents) {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: price_cents,
        currency: 'eur',
        metadata: { pack_key: key, credits: String(amount) },
      });
      if (current?.stripe_price_id) {
        try { await stripe.prices.update(current.stripe_price_id, { active: false }); } catch {}
      }
      patch.stripe_price_id = newPrice.id;
    }
  } catch (stripeErr: any) {
    console.error('[update-pack] Stripe error:', stripeErr.message);
    return NextResponse.json({ success: false, error: `Stripe: ${stripeErr.message}` }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('credit_packs').update(patch).eq('key', key);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
