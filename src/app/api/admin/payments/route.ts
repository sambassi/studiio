import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/payments?page=1&limit=20&search=xxx
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const { data, error: dbError, count } = await supabase
      .from('credit_transactions')
      .select('*, users!inner(name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbError) throw dbError;

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      hasMore: offset + limit < (count || 0),
    });
  } catch (error) {
    console.error('Admin payments error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch payments' }, { status: 500 });
  }
}
