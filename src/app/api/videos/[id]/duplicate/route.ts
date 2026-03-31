import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// POST /api/videos/[id]/duplicate - Duplicate a video
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch original video
    const { data: original, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (fetchError || !original) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    // Create duplicate with new title
    const { id: _id, created_at: _created, updated_at: _updated, ...rest } = original;
    const { data, error } = await supabase
      .from('videos')
      .insert({
        ...rest,
        title: `${original.title} (copie)`,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error duplicating video:', error);
    return NextResponse.json({ success: false, error: 'Failed to duplicate video' }, { status: 500 });
  }
}
