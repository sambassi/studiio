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

    const body = await req.json().catch(() => ({}));
    const platform = body.platform;

    if (!platform) {
      return NextResponse.json(
        { success: false, error: 'Platform is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('social_accounts')
      .delete()
      .eq('user_id', session.user.id)
      .eq('platform', platform);

    if (error) {
      console.error('Social disconnect error:', error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Social disconnect error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to disconnect social account' },
      { status: 500 }
    );
  }
}
