import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;
    const body = await req.json();
    const { reason } = body;

    if (!reason || typeof reason !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Ban reason is required.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ blocked: true })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log the ban action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'ban_user',
      targetType: 'user',
      targetId: userId,
      details: { reason },
    });

    return NextResponse.json({
      success: true,
      data,
      message: 'User banned successfully',
    });
  } catch (error) {
    console.error('Error banning user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to ban user' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ blocked: false })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log the unban action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'unban_user',
      targetType: 'user',
      targetId: userId,
      details: {},
    });

    return NextResponse.json({
      success: true,
      data,
      message: 'User unbanned successfully',
    });
  } catch (error) {
    console.error('Error unbanning user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to unban user' },
      { status: 500 }
    );
  }
}
