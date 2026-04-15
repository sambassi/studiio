import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { createBillingPortalSession } from '@/lib/stripe/client';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let customerId: string | undefined;
    try {
      const { data } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', session.user.id).single();
      customerId = (data as any)?.stripe_customer_id || undefined;
    } catch {}
    if (!customerId) {
      try {
        const { data } = await supabaseAdmin.from('subscriptions').select('stripe_customer_id').eq('user_id', session.user.id).order('updated_at', { ascending: false }).limit(1).single();
        customerId = (data as any)?.stripe_customer_id || undefined;
      } catch {}
    }
    if (!customerId) return NextResponse.json({ error: 'no customer' }, { status: 400 });

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const portal = await createBillingPortalSession(customerId, `${baseUrl}/dashboard/billing`);
    return NextResponse.json({ url: portal.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'portal failed' }, { status: 500 });
  }
}
