import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

const LANDING_KEY = 'landing_page_content';

// GET /api/admin/landing — fetch landing page content
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', LANDING_KEY)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    const content = data?.value
      ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value)
      : null;

    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error('Landing content fetch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch landing content' }, { status: 500 });
  }
}

// PATCH /api/admin/landing — update landing page content (partial or full)
export async function PATCH(req: NextRequest) {
  const { error: authErr, session } = await requireAdmin();
  if (authErr) return authErr;

  try {
    const body = await req.json();

    // Fetch existing content first for merge
    const { data: existing } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', LANDING_KEY)
      .single();

    const currentContent = existing?.value
      ? (typeof existing.value === 'string' ? JSON.parse(existing.value) : existing.value)
      : {};

    // Deep merge: body overwrites existing keys
    const merged = { ...currentContent, ...body };

    await supabase
      .from('app_settings')
      .upsert({
        key: LANDING_KEY,
        value: JSON.stringify(merged),
        updated_at: new Date().toISOString(),
        updated_by: session!.user!.email,
      });

    await logAdminAction({
      adminEmail: session!.user!.email!,
      action: 'update_landing_page',
      targetType: 'landing',
      details: { sections: Object.keys(body) },
    });

    return NextResponse.json({ success: true, content: merged });
  } catch (error) {
    console.error('Landing content update error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update landing content' }, { status: 500 });
  }
}
