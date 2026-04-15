import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    const userId = session.user.id;

    let subscription: any = null;
    try {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      subscription = data || null;
    } catch {}

    let transactions: any[] = [];
    try {
      const { data } = await supabaseAdmin
        .from('credit_transactions')
        .select('id, amount, type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      transactions = data || [];
    } catch {}

    return NextResponse.json({ ok: true, subscription, transactions });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
