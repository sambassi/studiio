import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { ApiResponse, PaginatedResponse } from '@/lib/types/api';

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

    // Only include valid columns — reject unknown fields that could cause Supabase errors
    const validFields: Record<string, unknown> = {
      user_id: session.user.id,
      title: body.title || 'Untitled',
      format: body.format || 'reel',
      type: body.type || 'creator',
      status: body.status || 'draft',
      video_url: body.video_url || null,
      thumbnail_url: body.thumbnail_url || null,
      metadata: body.metadata || {},
    };

    const { data, error } = await supabase
      .from('videos')
      .insert(validFields)
      .select()
      .single();

    if (error) {
      console.error('Video insert error:', error.message, error.details, error.hint);
      return NextResponse.json(
        { success: false, error: `Failed to create video: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Video POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create video' },
      { status: 500 }
    );
  }
}
