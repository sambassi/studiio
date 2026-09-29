import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe } from '@/lib/stripe/client';
import { clientStripeUtilisateur } from '@/lib/stripe/client-utilisateur';
import { STRIPE_PLANS } from '@/lib/stripe/constants';
import { prixPlan, verifierPrix } from '@/lib/stripe/prix';

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

    // Variables d'environnement d'abord, base en repli (cf. lib/stripe/prix).
    const priceId = await prixPlan(plan, billingCycle);
    if (!priceId) {
      console.error(`[checkout] prix non configure : STRIPE_PRICE_ID_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`);
      return NextResponse.json({ error: `Offre ${plan} (${billingCycle === 'yearly' ? 'annuelle' : 'mensuelle'}) indisponible : prix non configuré` }, { status: 503 });
    }
    try {
      await verifierPrix(stripe, priceId, { recurrent: billingCycle === 'yearly' ? 'year' : 'month' });
    } catch (e: any) {
      console.error('[checkout]', e?.message);
      return NextResponse.json({ error: 'Offre indisponible : prix Stripe invalide' }, { status: 503 });
    }

    const customerId = await clientStripeUtilisateur(session.user.id, session.user.email, session.user.name || 'User');

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: session.user.id,
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
