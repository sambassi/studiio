import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// POST /api/videos/[id]/export - Get export URL for a video
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (error || !video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    // Return the video URL or first rush URL from metadata
    const url = video.video_url
      || video.metadata?.rushUrls?.[0]
      || video.metadata?.posterPhotoUrl
      || video.metadata?.characterImageUrl
      || null;

    if (!url) {
      return NextResponse.json({ success: false, error: 'No exportable file found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, url, title: video.title });
  } catch (error) {
    console.error('Error exporting video:', error);
    return NextResponse.json({ success: false, error: 'Failed to export video' }, { status: 500 });
  }
}
