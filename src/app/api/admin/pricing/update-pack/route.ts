import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';
import { invalidatePricingCache } from '@/lib/pricing/fetch';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { MARQUEUR_APP, DEVISE } from '@/lib/stripe/prix';

export const dynamic = 'force-dynamic';

/**
 * Édition d'un pack. Ordre SÛR : créer le nouveau prix (CHF, marqueur app),
 * écrire en base en vérifiant l'erreur, PUIS désactiver l'ancien prix.
 */
export async function POST(req: NextRequest) {
  const garde = await requireAdmin();
  if (garde.error) return garde.error;

  const body = await req.json();
  const { key, name, amount, price_cents, popular, active } = body;
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  if (!(Number(amount) > 0) || !(Number(price_cents) > 0)) {
    return NextResponse.json({ success: false, error: 'Crédits et prix doivent être > 0' }, { status: 400 });
  }

  const { data: current } = await supabaseAdmin.from('credit_packs').select('*').eq('key', key).single();

  const patch: Record<string, any> = {
    name, amount, price_cents, popular, active,
    updated_at: new Date().toISOString(),
  };

  let nouveauPrix: string | undefined;
  try {
    let productId = current?.stripe_product_id;
    if (!productId) {
      const product = await stripe.products.create({
        name: `Studiio Credits — ${name}`,
        metadata: { app: MARQUEUR_APP, pack_key: key },
      });
      productId = product.id;
    } else {
      await stripe.products.update(productId, {
        name: `Studiio Credits — ${name}`,
        metadata: { app: MARQUEUR_APP, pack_key: key },
      });
    }
    patch.stripe_product_id = productId;

    if (price_cents !== current?.price_cents || !current?.stripe_price_id) {
      const p = await stripe.prices.create({
        product: productId,
        unit_amount: price_cents,
        currency: DEVISE,
        metadata: { app: MARQUEUR_APP, pack_key: key, credits: String(amount) },
      });
      nouveauPrix = p.id;
      patch.stripe_price_id = p.id;
    }
  } catch (stripeErr: any) {
    console.error('[update-pack] Stripe error:', stripeErr.message);
    return NextResponse.json({ success: false, error: `Stripe: ${stripeErr.message}` }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('credit_packs').update(patch).eq('key', key);
  if (error) {
    console.error('[update-pack] ecriture en base impossible, ancien prix conserve', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (nouveauPrix && current?.stripe_price_id && current.stripe_price_id !== nouveauPrix) {
    try {
      await stripe.prices.update(current.stripe_price_id, { active: false });
    } catch (e: any) {
      console.error('[update-pack] desactivation de l\'ancien prix impossible', current.stripe_price_id, e?.message);
    }
  }

  invalidatePricingCache();
  await logAdminAction({ adminEmail: garde.session!.user!.email!, action: 'pricing.update_pack', targetType: 'credit_pack', targetId: key, details: patch });
  return NextResponse.json({ success: true });
}
