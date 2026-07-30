import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';

export async function GET(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'terms_and_conditions')
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows found" - that's okay
      throw error;
    }

    return NextResponse.json({
      content: data?.value || '',
      lastModified: data?.updated_at || '',
      modifiedBy: data?.modified_by || '',
    });
  } catch (error) {
    console.error('Error fetching terms:', error);
    return NextResponse.json(
      { content: '', lastModified: '', modifiedBy: '', error: 'Failed to fetch terms' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    // Accept both `content` (frontend) and `termsText` (legacy)
    const termsText: string | undefined = body?.content ?? body?.termsText;
    const adminEmail = session!.user.email!;
    const now = new Date().toISOString();

    if (typeof termsText !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 }
      );
    }

    // Try to update existing record, or insert if it doesn't exist
    const { data: existing } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .eq('key', 'terms_and_conditions')
      .maybeSingle();

    let result: any;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .update({
          value: termsText,
          updated_at: now,
          modified_by: adminEmail,
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
          created_at: now,
          updated_at: now,
          modified_by: adminEmail,
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Log the action (fire-and-forget — don't crash the request if audit log fails)
    try {
      await logAdminAction({
        adminEmail,
        action: 'update_terms',
        targetType: 'settings',
        targetId: 'terms_and_conditions',
        details: { length: termsText.length },
      });
    } catch (logErr) {
      console.error('audit log failed:', logErr);
    }

    return NextResponse.json({
      content: result?.value || termsText,
      lastModified: result?.updated_at || now,
      modifiedBy: result?.modified_by || adminEmail,
    });
  } catch (error) {
    console.error('Error updating terms:', error);
    return NextResponse.json(
      { error: 'Failed to update terms' },
      { status: 500 }
    );
  }
}
