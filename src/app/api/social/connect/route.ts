import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

const APP_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function generateState(userId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${userId}:${timestamp}:${random}`;
}

function getOAuthUrl(platform: string, state: string): string | null {
  const redirectUri = `${APP_URL}/api/social/callback?platform=${platform}`;
  const encodedRedirect = encodeURIComponent(redirectUri);

  switch (platform) {
    case 'instagram': {
      const appId = process.env.META_INSTAGRAM_APP_ID || process.env.FACEBOOK_CLIENT_ID;
      if (!appId) return null;
      // Instagram Business requires Facebook Login with instagram_basic + pages permissions
      return `https://www.facebook.com/v24.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodedRedirect}&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement&response_type=code&state=${state}`;
    }

    case 'facebook': {
      const appId = process.env.FACEBOOK_CLIENT_ID;
      if (!appId) return null;
      return `https://www.facebook.com/v24.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodedRedirect}&scope=pages_manage_posts,pages_read_engagement,publish_video&response_type=code&state=${state}`;
    }

    case 'tiktok': {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey) return null;
      return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic,video.publish,video.upload&redirect_uri=${encodedRedirect}&state=${state}`;
    }

    case 'youtube': {
      const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return null;
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodedRedirect}&scope=https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube&response_type=code&access_type=offline&prompt=consent&state=${state}`;
    }

    default:
      return null;
  }
}

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

    const state = generateState(session.user.id);
    const authUrl = getOAuthUrl(platform, state);

    if (authUrl) {
      // Real OAuth flow - return URL for popup
      return NextResponse.json({ success: true, authUrl });
    }

    // No OAuth credentials configured - inform the user
    const platformNames: Record<string, string> = {
      instagram: 'META_INSTAGRAM_APP_ID',
      facebook: 'FACEBOOK_CLIENT_ID',
      tiktok: 'TIKTOK_CLIENT_KEY',
      youtube: 'YOUTUBE_CLIENT_ID ou GOOGLE_CLIENT_ID',
    };

    return NextResponse.json({
      success: false,
      error: `Configuration OAuth manquante pour ${platform}. Ajoutez ${platformNames[platform] || 'les identifiants'} dans les variables d\'environnement Vercel.`,
      needsConfig: true,
    }, { status: 422 });
  } catch (error) {
    console.error('Social connect error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect social account' },
      { status: 500 }
    );
  }
}
