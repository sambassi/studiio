import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabase } from '@/lib/db/supabase';
import { PaginatedResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<PaginatedResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, data: [], total: 0, page: 1, limit: 20, hasMore: false },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: offset + limit < (count || 0),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, data: [], total: 0, page: 1, limit: 20, hasMore: false },
      { status: 500 }
    );
  }
}
