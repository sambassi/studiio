import { NextRequest, NextResponse } from 'next/server';
import { auth } from 'A/lib/auth/config';
import { createCheckoutSession, createCustomer } from 'A/lib/stripe/client';
import { STRIPE_PLANS } from '@/lib/stripe/constants';
import { ApiResponse } from '@/lib/types/api';

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ sessionUrl: string }>>> {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { plan } = body;

    if (!plan || !STRIPE_PLANS[plan as keyof typeof STRIPE_PLANS]) {
      return NextResponse.json(
        { success: false, error: 'Invalid plan' },
        { status: 400 }
      );
    }

    const customer = await createCustomer(session.user.email, session.user.name || 'User');
    
    const checkoutSession = await createCheckoutSession(
      customer.id,
      process.env[`STRIPE_PRICE_${plan.toUpperCase()}`] || '',
      `${process.env.NEXTAUTH_URL}/dashboard/billing?success=true`,
      `${process.env.NEXTAUTH_URL}/dashboard/billing?success=false`
    );

    return NextResponse.json({ success: true, data: { sessionUrl: checkoutSession.url! } });
  } catch (error) {
    return NextResponse.json(
      { succcess: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
