import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings')
      .select('key, value')
      .in('key', ['agent_montage_enabled', 'demo_video_visible']);

    const map = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));

    return NextResponse.json(
      {
        agentMontageEnabled: map['agent_montage_enabled'] === 'true',
        demoVideoVisible: map['demo_video_visible'] === 'true',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // Table may not exist yet — default to false
    return NextResponse.json({ agentMontageEnabled: false, demoVideoVisible: false });
  }
}
