import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'].includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { key, name, price_cents, yearly_price_cents, credits, features, popular, active, watermark } = body;

  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  const { error } = await supabaseAdmin.from('plans').update({
    name, price_cents, yearly_price_cents, credits,
    features: typeof features === 'string' ? JSON.parse(features) : features,
    popular, active, watermark,
    updated_at: new Date().toISOString(),
  }).eq('key', key);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
