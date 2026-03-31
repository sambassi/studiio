import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/social/status - Check REAL connection status for all platforms
// Only trusts database records (from completed OAuth flows), NOT env vars
export async function GET(req: NextRequest) {
  void req; // unused but required by Next.js
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check DB for user's connected accounts (only real OAuth connections)
    const { data: dbAccounts } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('connected', true);

    const dbMap: Record<string, any> = {};
    dbAccounts?.forEach((acc) => {
      // Only trust accounts with real tokens (not demo_token)
      if (acc.access_token && acc.access_token !== 'demo_token' && acc.access_token !== 'env_token') {
        dbMap[acc.platform] = acc;
      }
    });

    // Check which platforms have OAuth configured (can initiate connection)
    const hasInstagramOAuth = !!(process.env.META_INSTAGRAM_APP_ID || process.env.FACEBOOK_CLIENT_ID);
    const hasFacebookOAuth = !!process.env.FACEBOOK_CLIENT_ID;
    const hasTiktokOAuth = !!process.env.TIKTOK_CLIENT_KEY;
    const hasYoutubeOAuth = !!(process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);

    const platforms = {
      instagram: {
        connected: !!dbMap.instagram,
        username: dbMap.instagram?.account_name || null,
        source: dbMap.instagram ? 'database' : null,
        oauthAvailable: hasInstagramOAuth,
      },
      facebook: {
        connected: !!dbMap.facebook,
        username: dbMap.facebook?.account_name || null,
        source: dbMap.facebook ? 'database' : null,
        oauthAvailable: hasFacebookOAuth,
      },
      tiktok: {
        connected: !!dbMap.tiktok,
        username: dbMap.tiktok?.account_name || null,
        source: dbMap.tiktok ? 'database' : null,
        oauthAvailable: hasTiktokOAuth,
      },
      youtube: {
        connected: !!dbMap.youtube,
        username: dbMap.youtube?.account_name || null,
        source: dbMap.youtube ? 'database' : null,
        oauthAvailable: hasYoutubeOAuth,
      },
    };

    return NextResponse.json({ success: true, platforms });
  } catch (error) {
    console.error('Social status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to check status' }, { status: 500 });
  }
}
