import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/social/status - Check connection status for all platforms
// Uses pre-configured env vars AND database records
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check DB for user's connected accounts
    const { data: dbAccounts } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('connected', true);

    const dbMap: Record<string, any> = {};
    dbAccounts?.forEach((acc) => {
      dbMap[acc.platform] = acc;
    });

    // Check env vars for pre-configured tokens
    const metaToken = process.env.META_PAGE_ACCESS_TOKEN;
    const metaPageId = process.env.META_PAGE_ID || process.env.FACEBOOK_ID;
    const igAccountId = process.env.META_INSTAGRAM_APP_ID;
    const tiktokKey = process.env.TIKTOK_CLIENT_KEY;
    const youtubeRefresh = process.env.YOUTUBE_REFRESH_TOKEN;
    const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID;

    const platforms = {
      instagram: {
        connected: !!(dbMap.instagram?.connected || (metaToken && igAccountId)),
        username: dbMap.instagram?.account_name || (igAccountId ? 'afroboost' : null),
        source: dbMap.instagram ? 'database' : metaToken ? 'env' : null,
      },
      facebook: {
        connected: !!(dbMap.facebook?.connected || (metaToken && metaPageId)),
        username: dbMap.facebook?.account_name || (metaPageId ? 'Bassi Bassi' : null),
        source: dbMap.facebook ? 'database' : metaToken ? 'env' : null,
      },
      tiktok: {
        connected: !!dbMap.tiktok?.connected,
        username: dbMap.tiktok?.account_name || null,
        source: dbMap.tiktok ? 'database' : null,
        oauthAvailable: !!tiktokKey,
      },
      youtube: {
        connected: !!(dbMap.youtube?.connected || youtubeRefresh),
        username: dbMap.youtube?.account_name || (youtubeChannelId ? 'Afroboost' : null),
        source: dbMap.youtube ? 'database' : youtubeRefresh ? 'env' : null,
      },
    };

    return NextResponse.json({ success: true, platforms });
  } catch (error) {
    console.error('Social status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to check status' }, { status: 500 });
  }
}
