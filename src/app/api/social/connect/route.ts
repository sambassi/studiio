import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { platform } = await req.json();

    if (!platform || !['instagram', 'tiktok', 'facebook', 'youtube'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'Invalid platform' },
        { status: 400 }
      );
    }

    // In production, this would generate a real OAuth URL for the platform.
    // For now, we create a demo connection directly.
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('social_accounts')
      .upsert(
        {
          user_id: session.user.id,
          platform,
          account_id: `${platform}_${session.user.id}`,
          account_name: `user_${platform}`,
          access_token: 'demo_token',
          connected: true,
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id,platform' }
      )
      .select()
      .single();

    if (error) {
      // If upsert fails (e.g. no unique constraint), try insert
      const { data: insertData, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id: session.user.id,
          platform,
          account_id: `${platform}_${session.user.id}`,
          account_name: `user_${platform}`,
          access_token: 'demo_token',
          connected: true,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Social connect error:', insertError);
        // Return success without authUrl to trigger demo mode in frontend
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ success: true, account: insertData });
    }

    return NextResponse.json({ success: true, account: data });
  } catch (error) {
    console.error('Social connect error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect social account' },
      { status: 500 }
    );
  }
}
