import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { createBillingPortalSession } from '@/lib/stripe/client';
import { ApiResponse } from '@/lib/types/api';

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ portalUrl: string }>>> {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const customerId = process.env.STRIPE_CUSTOMER_ID!;
    const portalSession = await createBillingPortalSession(
      customerId,
      `${process.env.NEXTAUTH_URL}/dashboard/billing`
    );

    return NextResponse.json({ success: true, data: { portalUrl: portalSession.url } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to create billing portal session' },
      { status: 500 }
    );
  }
}
