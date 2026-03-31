import { NextRequest, NextResponse } from 'next/server';
import { getWebhookEvent } from '@/lib/stripe/client';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { sendPaymentReceiptDirect, notifyAdminSale } from '@/lib/email/notifications';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;

    const event = await getWebhookEvent(Buffer.from(body), signature);

    switch (event.type) {
      case 'charge.succeeded':
        const charge = event.data.object as any;
        console.log('Charge succeeded:', charge);

        // Fire-and-forget email notifications
        if (charge.receipt_email) {
          const paymentData = {
            orderId: charge.id,
            amount: charge.amount / 100,
            date: new Date(charge.created * 1000).toISOString(),
            creditsAmount: charge.metadata?.creditsAmount ? parseInt(charge.metadata.creditsAmount) : 0,
            planName: charge.metadata?.planName || 'Plan',
            currency: charge.currency?.toUpperCase() || 'EUR',
            customerName: charge.metadata?.customerName || 'Utilisateur',
          };

          sendPaymentReceiptDirect(charge.receipt_email, paymentData);

          const saleData = {
            customerName: charge.metadata?.customerName || 'Client',
            customerEmail: charge.receipt_email,
            planName: charge.metadata?.planName || 'Plan',
            amount: charge.amount / 100,
            timestamp: new Date(charge.created * 1000).toISOString(),
            currency: charge.currency?.toUpperCase() || 'EUR',
            creditsAmount: charge.metadata?.creditsAmount ? parseInt(charge.metadata.creditsAmount) : 0,
          };

          notifyAdminSale(saleData);
        }
        break;

      case 'customer.subscription.created':
        const subscription = event.data.object as any;
        console.log('Subscription created:', subscription);

        // Send payment receipt + admin notification for new subscription
        if (subscription.metadata?.email) {
          const paymentData = {
            orderId: subscription.id,
            amount: subscription.plan?.amount ? subscription.plan.amount / 100 : 0,
            date: new Date(subscription.created * 1000).toISOString(),
            creditsAmount: subscription.metadata?.creditsAmount ? parseInt(subscription.metadata.creditsAmount) : 0,
            planName: subscription.metadata?.planName || 'Plan',
            currency: subscription.plan?.currency?.toUpperCase() || 'EUR',
            customerName: subscription.metadata?.customerName || 'Utilisateur',
          };

          sendPaymentReceiptDirect(subscription.metadata.email, paymentData);

          const saleData = {
            customerName: subscription.metadata?.customerName || 'Client',
            customerEmail: subscription.metadata.email,
            planName: subscription.metadata?.planName || 'Plan',
            amount: subscription.plan?.amount ? subscription.plan.amount / 100 : 0,
            timestamp: new Date(subscription.created * 1000).toISOString(),
            currency: subscription.plan?.currency?.toUpperCase() || 'EUR',
            creditsAmount: subscription.metadata?.creditsAmount ? parseInt(subscription.metadata.creditsAmount) : 0,
          };

          notifyAdminSale(saleData);
        }
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object as any;
        console.log('Subscription updated:', updatedSubscription);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object as any;
        console.log('Subscription deleted:', deletedSubscription);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 400 }
    );
  }
}
