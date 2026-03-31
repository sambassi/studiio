import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/stats/revenue - Revenue by month (last 6 months)
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const months = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = date.toISOString();
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString();
      const label = date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

      const { data } = await supabase
        .from('credit_transactions')
        .select('amount')
        .eq('type', 'purchase')
        .gte('created_at', start)
        .lt('created_at', end);

      const total = data?.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0) || 0;
      months.push({ month: label, revenue: total });
    }

    return NextResponse.json({ success: true, data: months });
  } catch (error) {
    console.error('Revenue stats error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch revenue' }, { status: 500 });
  }
}
