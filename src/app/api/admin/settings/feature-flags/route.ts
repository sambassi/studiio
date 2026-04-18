import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.DEV_AUTH_BYPASS !== '1') {
    const session = await auth();
    if (!session?.user?.email || !['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'].includes(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { key, value } = await req.json();
  if (!key || typeof value !== 'boolean') {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
