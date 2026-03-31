import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// POST /api/videos/[id]/repost - Repost a video to calendar as new draft
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch original video
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (fetchError || !video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    // Create a new scheduled post from this video
    const today = new Date();
    const scheduledDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const mediaUrl = video.video_url
      || video.metadata?.rushUrls?.[0]
      || video.metadata?.posterPhotoUrl
      || video.metadata?.characterImageUrl
      || null;

    const { data: post, error: postError } = await supabase
      .from('scheduled_posts')
      .insert({
        user_id: session.user.id,
        title: video.title || 'Repost',
        caption: video.metadata?.salesPhrase || video.metadata?.subtitle || '',
        media_url: mediaUrl,
        media_type: video.type === 'infographic' ? 'image' : 'video',
        format: video.format || 'reel',
        platforms: [],
        scheduled_date: scheduledDate,
        scheduled_time: '12:00',
        status: 'draft',
      })
      .select()
      .single();

    if (postError) throw postError;

    // Update video status
    await supabase
      .from('videos')
      .update({ status: 'published' })
      .eq('id', params.id)
      .eq('user_id', session.user.id);

    return NextResponse.json({ success: true, post });
  } catch (error) {
    console.error('Error reposting video:', error);
    return NextResponse.json({ success: false, error: 'Failed to repost video' }, { status: 500 });
  }
}
