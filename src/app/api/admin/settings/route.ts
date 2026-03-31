import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/settings
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { data, error: dbError } = await supabase
      .from('app_settings')
      .select('*');

    if (dbError) throw dbError;

    const settings: Record<string, any> = {};
    data?.forEach((s) => {
      settings[s.key] = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
    });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Admin settings error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/admin/settings
export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();

    for (const [key, value] of Object.entries(body)) {
      await supabase
        .from('app_settings')
        .upsert({
          key,
          value: JSON.stringify(value),
          updated_at: new Date().toISOString(),
          updated_by: session!.user!.email,
        });
    }

    await logAdminAction({
      adminEmail: session!.user!.email!,
      action: 'update_settings',
      targetType: 'setting',
      details: body,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin settings update error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}
