import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { stripe } from '@/lib/stripe/client';
import { clientStripeUtilisateur } from '@/lib/stripe/client-utilisateur';
import { CREDIT_PACKAGES } from '@/lib/stripe/constants';
import {
  prixPack, verifierPrix, montantAttenduPack, ecartCredits, MARQUEUR_APP, type PackKey,
} from '@/lib/stripe/prix';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { pack } = await req.json();
    if (!pack || !Object.prototype.hasOwnProperty.call(CREDIT_PACKAGES, pack)) {
      return NextResponse.json({ error: 'invalid pack' }, { status: 400 });
    }
    const cle = pack as PackKey;

    // Crédits vendus = tarifs décidés. Un écart avec la base (ce que la
    // page affiche) bloque la vente plutôt que de livrer autre chose.
    const ecart = await ecartCredits('credit_packs', cle);
    if (ecart) {
      console.error('[purchase-pack] credits en base differents des tarifs :', ecart);
      return NextResponse.json({ error: 'Pack indisponible : crédits du pack à vérifier' }, { status: 503 });
    }
    const creditAmount = CREDIT_PACKAGES[cle].amount;

    // Prix : variable d'environnement d'abord, base en repli (cf. lib/stripe/prix).
    const priceId = await prixPack(cle);
    if (!priceId) {
      console.error(`[purchase-pack] prix non configure : STRIPE_PRICE_ID_PACK_${cle.toUpperCase()}`);
      return NextResponse.json({ error: `Pack ${cle} indisponible : prix non configuré` }, { status: 503 });
    }
    try {
      await verifierPrix(stripe, priceId, { recurrent: null, montant: montantAttenduPack(cle) });
    } catch (e: any) {
      console.error('[purchase-pack]', e?.message);
      return NextResponse.json({ error: 'Pack indisponible : prix Stripe invalide' }, { status: 503 });
    }

    const customerId = await clientStripeUtilisateur(session.user.id, session.user.email, session.user.name || 'User');

    const metadata = { app: MARQUEUR_APP, userId: session.user.id, packKey: cle, creditAmount: String(creditAmount) };
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: session.user.id,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?success=true`,
      cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
      metadata,
      // Le marqueur suit le paiement : un remboursement ou un litige sur la
      // charge sera reconnu comme Studiio.
      payment_intent_data: { metadata },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'checkout failed' }, { status: 500 });
  }
}
