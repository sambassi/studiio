import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe } from '@/lib/stripe/client';
import { clientStripeUtilisateur } from '@/lib/stripe/client-utilisateur';
import { STRIPE_PLANS } from '@/lib/stripe/constants';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  prixPlan, verifierPrix, montantAttenduPlan, ecartCredits, MARQUEUR_APP,
} from '@/lib/stripe/prix';

type PlanKey = 'starter' | 'pro' | 'enterprise';
type Billing = 'monthly' | 'yearly';

/** Statuts qui interdisent d'ouvrir un second abonnement. */
const STATUTS_EN_COURS = new Set(['active', 'trialing', 'past_due']);

const MESSAGE_DEJA_ABONNE =
  'Vous avez déjà un abonnement. Pour changer de plan ou de facturation, passez par « Gérer mon abonnement ».';

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

    // Un seul abonnement à la fois : un second checkout créerait un second
    // abonnement facturé en parallèle. Les changements passent par le portail.
    const { data: lignes, error: errSubs } = await supabaseAdmin
      .from('subscriptions').select('status').eq('user_id', session.user.id);
    if (errSubs) {
      console.error('[checkout] lecture subscriptions impossible', errSubs.message);
      return NextResponse.json({ error: 'Abonnement momentanément indisponible' }, { status: 503 });
    }
    if ((lignes ?? []).some((l: any) => STATUTS_EN_COURS.has(l.status))) {
      return NextResponse.json({ error: MESSAGE_DEJA_ABONNE, portal: '/api/stripe/create-portal' }, { status: 409 });
    }

    const ecart = await ecartCredits('plans', plan);
    if (ecart) {
      console.error('[checkout] credits en base differents des tarifs :', ecart);
      return NextResponse.json({ error: 'Offre indisponible : crédits du plan à vérifier' }, { status: 503 });
    }

    // Variables d'environnement d'abord, base en repli (cf. lib/stripe/prix).
    const priceId = await prixPlan(plan, billingCycle);
    if (!priceId) {
      console.error(`[checkout] prix non configure : STRIPE_PRICE_ID_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`);
      return NextResponse.json({ error: `Offre ${plan} (${billingCycle === 'yearly' ? 'annuelle' : 'mensuelle'}) indisponible : prix non configuré` }, { status: 503 });
    }
    try {
      await verifierPrix(stripe, priceId, {
        recurrent: billingCycle === 'yearly' ? 'year' : 'month',
        montant: montantAttenduPlan(plan, billingCycle),
      });
    } catch (e: any) {
      console.error('[checkout]', e?.message);
      return NextResponse.json({ error: 'Offre indisponible : prix Stripe invalide' }, { status: 503 });
    }

    const customerId = await clientStripeUtilisateur(session.user.id, session.user.email, session.user.name || 'User');

    // Double contrôle chez Stripe : la table peut être en retard sur un
    // webhook pas encore reçu. Dans le doute, on refuse.
    try {
      const existants = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
      if ((existants?.data ?? []).some((s: any) => STATUTS_EN_COURS.has(s.status))) {
        return NextResponse.json({ error: MESSAGE_DEJA_ABONNE, portal: '/api/stripe/create-portal' }, { status: 409 });
      }
    } catch (e: any) {
      console.error('[checkout] subscriptions.list impossible', e?.message);
      return NextResponse.json({ error: 'Abonnement momentanément indisponible' }, { status: 503 });
    }

    const metadata = { app: MARQUEUR_APP, userId: session.user.id, plan, billingCycle };
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: session.user.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?success=true`,
      cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
      metadata,
      subscription_data: { metadata },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'checkout failed' }, { status: 500 });
  }
}
