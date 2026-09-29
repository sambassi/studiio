import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { stripe } from '@/lib/stripe/client';
import { invalidatePricingCache } from '@/lib/pricing/fetch';
import { totalAnnuelCentimes } from '@/lib/stripe/constants';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { MARQUEUR_APP, DEVISE } from '@/lib/stripe/prix';

export const dynamic = 'force-dynamic';

async function ensureProduct(key: string, name: string, existingProductId?: string | null): Promise<string> {
  if (existingProductId) {
    await stripe.products.update(existingProductId, {
      name: `Studiio ${name}`,
      metadata: { app: MARQUEUR_APP, plan_key: key },
    });
    return existingProductId;
  }
  const product = await stripe.products.create({
    name: `Studiio ${name}`,
    metadata: { app: MARQUEUR_APP, plan_key: key },
  });
  return product.id;
}

/** Désactive un ancien prix APRÈS l'écriture en base ; un échec est journalisé, pas bloquant. */
async function desactiver(priceId: string | null | undefined, remplacePar: string | undefined): Promise<void> {
  if (!priceId || priceId === remplacePar) return;
  try {
    await stripe.prices.update(priceId, { active: false });
  } catch (e: any) {
    console.error('[update-plan] desactivation de l\'ancien prix impossible', priceId, e?.message);
  }
}

/**
 * Édition d'un plan. Ordre SÛR pour chaque prix modifié :
 *   1. créer le nouveau prix Stripe (CHF, marqueur app) ;
 *   2. écrire en base et vérifier l'erreur ;
 *   3. seulement ensuite désactiver l'ancien prix.
 * Un échec en 2 laisse l'ancien prix actif et référencé : les checkouts
 * continuent de fonctionner (le nouveau prix orphelin est inoffensif).
 */
export async function POST(req: NextRequest) {
  const garde = await requireAdmin();
  if (garde.error) return garde.error;

  const body = await req.json();
  const { key, name, price_cents, yearly_price_cents, credits, features, popular, active, watermark } = body;
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

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
    invalidatePricingCache();
    await logAdminAction({ adminEmail: garde.session!.user!.email!, action: 'pricing.update_plan', targetType: 'plan', targetId: key, details: patch });
    return NextResponse.json({ success: true });
  }

  if (!(Number(credits) > 0) || !(Number(price_cents) > 0) || !(Number(yearly_price_cents) > 0)) {
    return NextResponse.json({ success: false, error: 'Crédits et prix doivent être > 0' }, { status: 400 });
  }

  let nouveauMensuel: string | undefined;
  let nouvelAnnuel: string | undefined;
  try {
    const productId = await ensureProduct(key, name, current?.stripe_product_id);
    patch.stripe_product_id = productId;
    patch.price_cents = price_cents;
    patch.yearly_price_cents = yearly_price_cents;

    if (price_cents !== current?.price_cents || !current?.stripe_price_id) {
      const p = await stripe.prices.create({
        product: productId,
        unit_amount: price_cents,
        currency: DEVISE,
        recurring: { interval: 'month' },
        metadata: { app: MARQUEUR_APP, plan_key: key, cycle: 'monthly' },
      });
      nouveauMensuel = p.id;
      patch.stripe_price_id = p.id;
    }

    if (yearly_price_cents !== current?.yearly_price_cents || !current?.stripe_yearly_price_id) {
      // Total annuel arrondi au franc (15,83 × 12 = 189,96 → 190 CHF).
      const p = await stripe.prices.create({
        product: productId,
        unit_amount: totalAnnuelCentimes(yearly_price_cents || 0),
        currency: DEVISE,
        recurring: { interval: 'year' },
        metadata: { app: MARQUEUR_APP, plan_key: key, cycle: 'yearly' },
      });
      nouvelAnnuel = p.id;
      patch.stripe_yearly_price_id = p.id;
    }
  } catch (stripeErr: any) {
    console.error('[update-plan] Stripe error:', stripeErr.message);
    return NextResponse.json({ success: false, error: `Stripe: ${stripeErr.message}` }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('plans').update(patch).eq('key', key);
  if (error) {
    // Les anciens prix restent actifs et référencés : rien n'est cassé.
    console.error('[update-plan] ecriture en base impossible, anciens prix conserves', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (nouveauMensuel) await desactiver(current?.stripe_price_id, nouveauMensuel);
  if (nouvelAnnuel) await desactiver(current?.stripe_yearly_price_id, nouvelAnnuel);

  invalidatePricingCache();
  await logAdminAction({ adminEmail: garde.session!.user!.email!, action: 'pricing.update_plan', targetType: 'plan', targetId: key, details: patch });
  return NextResponse.json({ success: true });
}
