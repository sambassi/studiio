import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { PaginatedResponse, ApiResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<PaginatedResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';
    const plan = searchParams.get('plan') || '';
    const status = searchParams.get('status') || '';
    const role = searchParams.get('role') || '';

    let query = supabaseAdmin.from('users').select('*', { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }
    if (plan && plan !== 'all') {
      query = query.eq('plan', plan);
    }
    if (status === 'active') {
      query = query.eq('blocked', false);
    } else if (status === 'blocked') {
      query = query.eq('blocked', true);
    }
    if (role && role !== 'all') {
      query = query.eq('role', role);
    }

    const { data, error, count } = await query
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
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { success: false, data: [], total: 0, page: 1, limit: 20, hasMore: false },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    const { userId, credits, plan, role, blocked } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    // Validate update data
    const updateData: any = {};
    if (credits !== undefined) updateData.credits = credits;
    if (plan) updateData.plan = plan;
    if (role) updateData.role = role;
    if (blocked !== undefined) updateData.blocked = blocked;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'update_user',
      targetType: 'user',
      targetId: userId,
      details: updateData,
    });

    return NextResponse.json({
      success: true,
      data,
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}
