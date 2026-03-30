import { NextRequest, NextResponse } from 'next/server';
import { getWebhookEvent } from '@/lib/stripe/client';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;

    const event = await getWebhookEvent(Buffer.from(body), signature);

    switch (event.type) {
      case 'charge.succeeded':
        const charge = event.data.object as any;
        console.log('Charge succeeded:', charge);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object as any;
        console.log('Subscription updated:', subscription);
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
