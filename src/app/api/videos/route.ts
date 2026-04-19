import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { ApiResponse, PaginatedResponse } from '@/lib/types/api';

type LibraryItem = {
  id: string;
  title: string;
  format: string;
  status: string;
  type: 'infographic' | 'video';
  created_at: string;
  video_url?: string | null;
  thumbnail_url?: string | null;
  metadata?: Record<string, any> | null;
};

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

    const [videosRes, postsRes] = await Promise.all([
      supabase
        .from('videos')
        .select('*', { count: 'exact' })
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('scheduled_posts')
        .select('*', { count: 'exact' })
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false }),
    ]);

    if (videosRes.error) throw videosRes.error;
    if (postsRes.error) throw postsRes.error;

    const videos: LibraryItem[] = (videosRes.data || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      format: v.format,
      status: v.status,
      type: 'video',
      created_at: v.created_at,
      video_url: v.video_url ?? null,
      thumbnail_url: v.thumbnail_url ?? null,
      metadata: v.metadata ?? null,
    }));

    const posts: LibraryItem[] = (postsRes.data || []).map((p: any) => {
      const meta = p.metadata || {};
      return {
        id: p.id,
        title: p.title,
        format: meta.format || (p.media_type === 'video' ? 'reel' : 'reel'),
        status: p.status,
        type: 'infographic',
        created_at: p.created_at,
        video_url: meta.videoUrl ?? p.media_url ?? null,
        thumbnail_url: meta.posterUrl ?? meta.thumbnail ?? null,
        metadata: meta,
      };
    });

    const merged = [...videos, ...posts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const total = (videosRes.count || 0) + (postsRes.count || 0);
    const paged = merged.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: paged,
      total,
      page,
      limit,
      hasMore: offset + limit < total,
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
        status: body.status || 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to create video' },
      { status: 500 }
    );
  }
}
