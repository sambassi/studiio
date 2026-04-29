import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { collectStorageUrlsFromPost, deleteStorageFiles } from '@/lib/storage/cleanup';

// GET /api/posts?month=2026-03
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // format: YYYY-MM

    let query = supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', session.user.id)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (month) {
      const [year, m] = month.split('-').map(Number);
      const startDate = `${year}-${String(m).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(m + 1 > 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      query = query.gte('scheduled_date', startDate).lt('scheduled_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, posts: data || [] });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch posts' }, { status: 500 });
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { title, caption, media_url, media_type, format, platforms, scheduled_date, scheduled_time, status, metadata } = body;

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert({
        user_id: session.user.id,
        title: title || '',
        caption: caption || '',
        media_url,
        media_type: media_type || 'video',
        format: format || 'reel',
        platforms: platforms || [],
        scheduled_date,
        scheduled_time: scheduled_time || '12:00',
        status: status || 'draft',
        ...(metadata ? { metadata } : {}),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, post: data });
  } catch (error) {
    console.error('Error creating post:', error);
    return NextResponse.json({ success: false, error: 'Failed to create post' }, { status: 500 });
  }
}

// PUT /api/posts - Update a post
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Post ID required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', session.user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, post: data });
  } catch (error) {
    console.error('Error updating post:', error);
    return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
  }
}

// DELETE /api/posts?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Post ID required' }, { status: 400 });
    }

    // Fetch the post first to collect every Supabase Storage URL stored in
    // its metadata (rush, montage, audio, thumbnail, poster, character,
    // ...). The row delete cascades to the helper below — fire-and-forget,
    // so a slow / failing storage call doesn't block the user's UI.
    const { data: postRow } = await supabase
      .from('scheduled_posts')
      .select('metadata')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();

    const { error } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);

    if (error) throw error;

    // Cascade delete the post's storage files. Wrapped in setImmediate so
    // the response goes back to the client without waiting on the storage
    // round-trips. Errors land in the server logs.
    if (postRow?.metadata) {
      const urls = collectStorageUrlsFromPost(postRow.metadata as Record<string, unknown>);
      if (urls.length > 0) {
        deleteStorageFiles(urls, `[POST DELETE id=${id}]`)
          .then(({ removed, failed }) => {
            console.log(`[POST DELETE id=${id}] storage cleanup: removed=${removed} failed=${failed.length}`);
          })
          .catch((err) => {
            console.error(`[POST DELETE id=${id}] storage cleanup unexpected error:`, err);
          });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting post:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete post' }, { status: 500 });
  }
}
