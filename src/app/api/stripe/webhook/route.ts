import { NextRequest, NextResponse } from 'next/server';
import { getWebhookEvent } from '@/lib/stripe/client';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { sendPaymentReceiptDirect, notifyAdminSale } from '@/lib/email/notifications';
import { STRIPE_PLANS } from '@/lib/stripe/constants';

type PlanKey = 'starter' | 'pro' | 'enterprise' | 'free';

// Resolve plan from a Stripe price id by matching env vars
function planFromPriceId(priceId: string): { plan: PlanKey; billingCycle: 'monthly' | 'yearly' } | null {
  const plans: PlanKey[] = ['starter', 'pro', 'enterprise'];
  for (const p of plans) {
    for (const cycle of ['monthly', 'yearly'] as const) {
      const env = process.env[`STRIPE_PRICE_ID_${p.toUpperCase()}_${cycle.toUpperCase()}`];
      if (env && env === priceId) return { plan: p, billingCycle: cycle };
    }
  }
  return null;
}

async function alreadyProcessed(eventId: string, type: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('stripe_events').select('event_id').eq('event_id', eventId).single();
    if (data) return true;
    await supabase.from('stripe_events').insert({ event_id: eventId, type, received_at: new Date().toISOString() });
    return false;
  } catch (e) {
    // Table missing or other error — log and continue (migration required)
    console.warn('[webhook] stripe_events unavailable (run migration):', (e as any)?.message);
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;
    const event = await getWebhookEvent(Buffer.from(body), signature);

    if (await alreadyProcessed(event.id, event.type)) {
      return NextResponse.json({ received: true, idempotent: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const cs = event.data.object as any;
        const mode = cs.mode;
        const md = cs.metadata || {};
        const userId = md.userId;

        if (mode === 'payment' && userId && md.creditAmount) {
          const creditAmount = parseInt(md.creditAmount, 10) || 0;
          if (creditAmount > 0) {
            const { data: u } = await supabase.from('users').select('credits').eq('id', userId).single();
            const current = u?.credits ?? 0;
            await supabase.from('users').update({ credits: current + creditAmount }).eq('id', userId);
            await supabase.from('credit_transactions').insert({
              user_id: userId, amount: creditAmount, type: 'purchase',
              created_at: new Date().toISOString(),
            });
          }
        } else if (mode === 'subscription' && userId && md.plan) {
          const plan = md.plan as PlanKey;
          await supabase.from('users').update({ plan }).eq('id', userId);
          const subId = cs.subscription;
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            plan,
            status: 'active',
            stripe_subscription_id: subId,
            stripe_customer_id: cs.customer,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'stripe_subscription_id' });
        }

        // Existing receipt email behavior
        if (cs.customer_details?.email) {
          const paymentData = {
            orderId: cs.id,
            amount: (cs.amount_total || 0) / 100,
            date: new Date((cs.created || Date.now() / 1000) * 1000).toISOString(),
            creditsAmount: md.creditAmount ? parseInt(md.creditAmount) : 0,
            planName: md.plan || 'Plan',
            currency: (cs.currency || 'eur').toUpperCase(),
            customerName: cs.customer_details?.name || 'Utilisateur',
          };
          sendPaymentReceiptDirect(cs.customer_details.email, paymentData);
          notifyAdminSale({
            customerName: cs.customer_details?.name || 'Client',
            customerEmail: cs.customer_details.email,
            planName: md.plan || 'Plan',
            amount: (cs.amount_total || 0) / 100,
            timestamp: new Date().toISOString(),
            currency: (cs.currency || 'eur').toUpperCase(),
            creditsAmount: md.creditAmount ? parseInt(md.creditAmount) : 0,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as any;
        const userId = sub.metadata?.userId;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const resolved = priceId ? planFromPriceId(priceId) : null;
        if (userId && resolved) {
          await supabase.from('users').update({ plan: resolved.plan }).eq('id', userId);
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            plan: resolved.plan,
            status: sub.status,
            stripe_subscription_id: sub.id,
            stripe_customer_id: sub.customer,
            current_period_end: new Date((sub.current_period_end || 0) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'stripe_subscription_id' });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as any;
        const userId = sub.metadata?.userId;
        if (userId) {
          await supabase.from('users').update({ plan: 'free' }).eq('id', userId);
        }
        await supabase.from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as any;
        if (inv.billing_reason === 'subscription_cycle') {
          const subId = inv.subscription;
          const { data: subRow } = await supabase.from('subscriptions').select('user_id, plan').eq('stripe_subscription_id', subId).single();
          const userId = subRow?.user_id;
          const plan = (subRow?.plan || 'free') as PlanKey;
          const monthly = (STRIPE_PLANS as any)[plan]?.credits ?? 0;
          if (userId && monthly > 0) {
            await supabase.from('users').update({ credits: monthly }).eq('id', userId);
            await supabase.from('credit_transactions').insert({
              user_id: userId, amount: monthly, type: 'subscription',
              created_at: new Date().toISOString(),
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as any;
        console.error('[webhook] invoice.payment_failed', inv.id, inv.customer_email);
        break;
      }

      default:
        // no-op
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 400 });
  }
}
