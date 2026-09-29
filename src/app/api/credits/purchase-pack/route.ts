import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe } from '@/lib/stripe/client';
import { clientStripeUtilisateur } from '@/lib/stripe/client-utilisateur';
import { CREDIT_PACKAGES } from '@/lib/stripe/constants';
import { supabaseAdmin } from '@/lib/db/supabase';
import { prixPack, verifierPrix } from '@/lib/stripe/prix';

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

    // Crédits du pack : table `credit_packs` (ce que la page affiche),
    // repli sur les constantes.
    let creditAmount: number = (CREDIT_PACKAGES as any)[pack].amount;
    try {
      const { data: dbPack } = await supabaseAdmin.from('credit_packs').select('amount').eq('key', pack).single();
      if (typeof dbPack?.amount === 'number' && dbPack.amount > 0) creditAmount = dbPack.amount;
    } catch {}

    // Prix : variable d'environnement d'abord, base en repli (cf. lib/stripe/prix).
    const priceId = await prixPack(pack);
    if (!priceId) {
      console.error(`[purchase-pack] prix non configure : STRIPE_PRICE_ID_PACK_${String(pack).toUpperCase()}`);
      return NextResponse.json({ error: `Pack ${pack} indisponible : prix non configuré` }, { status: 503 });
    }
    try {
      await verifierPrix(stripe, priceId, { recurrent: null });
    } catch (e: any) {
      console.error('[purchase-pack]', e?.message);
      return NextResponse.json({ error: 'Pack indisponible : prix Stripe invalide' }, { status: 503 });
    }

    const customerId = await clientStripeUtilisateur(session.user.id, session.user.email, session.user.name || 'User');

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: session.user.id,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?success=true`,
      cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
      metadata: { userId: session.user.id, packKey: String(pack), creditAmount: String(creditAmount) },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'checkout failed' }, { status: 500 });
  }
}
