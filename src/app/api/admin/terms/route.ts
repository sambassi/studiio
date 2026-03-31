import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'terms_and_conditions')
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows found" - that's okay
      throw error;
    }

    const termsText = data?.value || '';

    return NextResponse.json({
      success: true,
      data: { termsText },
    });
  } catch (error) {
    console.error('Error fetching terms:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch terms' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    const { termsText } = body;

    if (!termsText || typeof termsText !== 'string') {
      return NextResponse.json(
        { success: false, error: 'termsText is required and must be a string' },
        { status: 400 }
      );
    }

    // Try to update existing record, or insert if it doesn't exist
    const { data: existing } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'terms_and_conditions')
      .single();

    let result;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .update({
          value: termsText,
          updated_at: new Date().toISOString(),
        })
        .eq('key', 'terms_and_conditions')
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .insert({
          key: 'terms_and_conditions',
          value: termsText,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Log the action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'update_terms',
      targetType: 'settings',
      targetId: 'terms_and_conditions',
      details: { length: termsText.length },
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Terms updated successfully',
    });
  } catch (error) {
    console.error('Error updating terms:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update terms' },
      { status: 500 }
    );
  }
}
