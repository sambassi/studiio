import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/posts/[id]/debug — diagnostic endpoint showing which video would be published
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { data: post, error } = await supabase
      .from('scheduled_posts')
      .select('*, videos:video_id(*)')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();

    if (error || !post) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }

    const meta = post.metadata || {};
    const video = post.videos;

    // Reproduce cron logic for video URL selection
    const renderedVideoUrl = meta.renderedVideoUrl || null;
    const mediaUrl = post.media_url || null;
    const rawVideoUrl = video?.video_url || null;
    const metaVideoUrl = meta.videoUrl || null; // Often the raw rush — NOT the montage

    const selectedUrl = renderedVideoUrl || mediaUrl || rawVideoUrl;
    const source = renderedVideoUrl ? 'renderedVideoUrl (montage composé ✅)'
      : mediaUrl ? 'media_url'
      : rawVideoUrl ? 'video.video_url (rush brut ⚠️)'
      : 'NONE ❌';

    const isWebM = selectedUrl?.toLowerCase().includes('webm') || false;

    return NextResponse.json({
      success: true,
      postId: post.id,
      title: post.title,
      status: post.status,
      platforms: post.platforms,
      scheduled_date: post.scheduled_date,
      scheduled_time: post.scheduled_time,
      video_diagnosis: {
        will_be_published: selectedUrl,
        source,
        is_webm: isWebM,
        needs_conversion: isWebM,
        all_urls: {
          'metadata.renderedVideoUrl (montage)': renderedVideoUrl,
          'post.media_url': mediaUrl,
          'video.video_url (rush brut)': rawVideoUrl,
          'metadata.videoUrl (ambigu)': metaVideoUrl,
        },
      },
      metadata_keys: Object.keys(meta),
      has_audio: !!meta.hasAudio,
      has_music: !!meta.musicUrl,
      has_voice: !!meta.voiceUrl,
      error_info: meta.error || meta.cron_publish_results || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Debug failed' }, { status: 500 });
  }
}
