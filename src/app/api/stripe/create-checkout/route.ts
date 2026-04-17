import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe, createCustomer } from '@/lib/stripe/client';
import { STRIPE_PLANS } from '@/lib/stripe/constants';
import { supabaseAdmin } from '@/lib/db/supabase';

type PlanKey = 'starter' | 'pro' | 'enterprise';
type Billing = 'monthly' | 'yearly';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json();
    const plan: PlanKey = body.plan;
    const billingCycle: Billing = body.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    if (!plan || !['starter', 'pro', 'enterprise'].includes(plan) || !(plan in STRIPE_PLANS)) {
      return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
    }

    // Resolve priceId: DB first, env var fallback
    let priceId: string | undefined;
    try {
      const { data: dbPlan } = await supabaseAdmin.from('plans').select('stripe_price_id, stripe_yearly_price_id').eq('key', plan).single();
      priceId = (billingCycle === 'yearly' ? dbPlan?.stripe_yearly_price_id : dbPlan?.stripe_price_id) || undefined;
    } catch {}
    if (!priceId) {
      const envKey = `STRIPE_PRICE_ID_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`;
      priceId = process.env[envKey];
    }
    if (!priceId) {
      return NextResponse.json({ error: `price not configured for ${plan}/${billingCycle}` }, { status: 400 });
    }

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

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?success=true`,
      cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
      metadata: { userId: session.user.id, plan, billingCycle },
      subscription_data: { metadata: { userId: session.user.id, plan, billingCycle } },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'checkout failed' }, { status: 500 });
  }
}
