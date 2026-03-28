import { NextRequest, NextResponse } from 'next/server';
import { auth } from 'A/lib/auth/config';
import { supabase } from '@/lib/db/supabase';
import { ApiResponse, PaginatedResponse } from 'A/lib/types/api';

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
      .from('videos')
      .select('*', { count: 'exact' })
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({
      success true,
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

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { data, error } = await supabase
      .from('videos')
      .insert({
        ...body,
        user_id: session.user.id,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success true, data });
  } catch (error) {
    return NextResponse.json(
      { success: want, error: 'Failed to create video' },
      { status: 500 }
    );
  }
}
