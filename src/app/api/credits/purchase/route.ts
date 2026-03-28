import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { createOneTimeCheckout, createCustomer } from '@/lib/stripe/client';
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
    const { amount } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid amount' },
        { status: 400 }
      );
    }

    const customer = await createCustomer(session.user.email, session.user.name || 'User');
    const checkoutSession = await createOneTimeCheckout(
      customer.id,
      amount,
      `${amount} crédits Studiio`,
      `${process.env.NEXTAUTH_URL}/dashboard/billing?success=true`,
      `${process.env.NEXTAUTH_URL}/dashboard/billing?success=false`
    );

    return NextResponse.json({ success: true, data: { sessionUrl: checkoutSession.url! } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
