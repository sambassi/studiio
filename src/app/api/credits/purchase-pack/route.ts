import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe, createCustomer } from '@/lib/stripe/client';
import { CREDIT_PACKAGES } from '@/lib/stripe/constants';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { pack } = await req.json();
    if (!pack || !(pack in CREDIT_PACKAGES)) {
      return NextResponse.json({ error: 'invalid pack' }, { status: 400 });
    }
    const pkg = (CREDIT_PACKAGES as any)[pack];
    const envKey = `STRIPE_PRICE_ID_PACK_${String(pack).toUpperCase()}`;
    const priceId = process.env[envKey];
    if (!priceId) {
      return NextResponse.json({ error: `price not configured (${envKey})` }, { status: 400 });
    }

    // Reuse stored customer id if present
    let customerId: string | undefined;
    try {
      const { data } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', session.user.id).single();
      customerId = (data as any)?.stripe_customer_id || undefined;
    } catch {}
    if (!customerId) {
      const customer = await createCustomer(session.user.email, session.user.name || 'User');
      customerId = customer.id;
      try { await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', session.user.id); } catch {}
    }

    const successUrl = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=true`;
    const cancelUrl = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?canceled=true`;

    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: session.user.id,
        packKey: String(pack),
        creditAmount: String(pkg.amount),
      },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'checkout failed' }, { status: 500 });
  }
}
