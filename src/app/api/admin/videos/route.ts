import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/videos?page=1&limit=20&status=xxx
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('videos')
      .select('*, users!inner(name, email)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error: dbError, count } = await query.range(offset, offset + limit - 1);
    if (dbError) throw dbError;

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      hasMore: offset + limit < (count || 0),
    });
  } catch (error) {
    console.error('Admin videos error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch videos' }, { status: 500 });
  }
}

// DELETE /api/admin/videos?id=xxx
export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Video ID required' }, { status: 400 });

    // Get video info for storage cleanup
    const { data: video } = await supabase.from('videos').select('video_url, user_id, credits_used').eq('id', id).single();

    // Delete from DB
    await supabase.from('videos').delete().eq('id', id);

    // Refund credits if video had charges
    if (video?.credits_used && video.user_id) {
      const { data: user } = await supabase.from('users').select('credits').eq('id', video.user_id).single();
      if (user) {
        await supabase.from('users').update({ credits: user.credits + video.credits_used }).eq('id', video.user_id);
        await supabase.from('credit_transactions').insert({
          user_id: video.user_id,
          amount: video.credits_used,
          type: 'refund',
          description: 'Admin: suppression video + remboursement',
        });
      }
    }

    await logAdminAction({
      adminEmail: session!.user!.email!,
      action: 'delete_video',
      targetType: 'video',
      targetId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin delete video error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete video' }, { status: 500 });
  }
}
