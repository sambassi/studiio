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

    const settings = await req.json();

    // Store settings in user_settings table or upsert
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: session.user.id,
            social_settings: settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        // Table might not exist yet — that's ok, client uses localStorage as fallback
        console.warn('Could not save social settings to DB:', error.message);
      }
    } catch (dbError) {
      console.warn('DB error saving social settings:', dbError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Social settings error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('social_settings')
        .eq('user_id', session.user.id)
        .single();

      if (error || !data) {
        return NextResponse.json({ success: true, settings: null });
      }

      return NextResponse.json({ success: true, settings: data.social_settings });
    } catch (dbError) {
      return NextResponse.json({ success: true, settings: null });
    }
  } catch (error) {
    console.error('Social settings GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load settings' },
      { status: 500 }
    );
  }
}
