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
    switch (platform) {
      // Instagram + Facebook go through the same unified Meta app using
      // Facebook Login for Business. Scopes are bound to the Login
      // Configuration on Meta's side — the client passes `config_id`
      // instead of `scope`.
      case 'instagram':
      case 'facebook': {
              const redirectUri = encodeURIComponent(`${APP_URL}/api/social/callback?platform=${platform}`);
              const appId = process.env.META_INSTAGRAM_APP_ID || process.env.FACEBOOK_CLIENT_ID;
              const configId = process.env.META_CONFIG_ID;
              if (!appId || !configId) return null;
              return `https://www.facebook.com/v23.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&config_id=${configId}&response_type=code&state=${state}`;
      }

      case 'tiktok': {
              const redirectUri = encodeURIComponent(`${APP_URL}/api/social/callback/tiktok`);
              const clientKey = process.env.TIKTOK_CLIENT_KEY;
              if (!clientKey) return null;
              // Scopes auto-approuvés TikTok uniquement. video.publish/upload requièrent App Review.
              return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic,video.list&redirect_uri=${redirectUri}&state=${state}`;
      }

      case 'youtube': {
              const redirectUri = encodeURIComponent(`${APP_URL}/api/social/callback?platform=youtube`);
              const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
              if (!clientId) return null;
              return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube&response_type=code&access_type=offline&prompt=consent&state=${state}`;
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
              return NextResponse.json({ success: true, authUrl });
      }

      const platformNames: Record<string, string> = {
              instagram: 'META_INSTAGRAM_APP_ID + META_CONFIG_ID',
              facebook: 'FACEBOOK_CLIENT_ID + META_CONFIG_ID',
              tiktok: 'TIKTOK_CLIENT_KEY',
              youtube: 'YOUTUBE_CLIENT_ID ou GOOGLE_CLIENT_ID',
      };

      return NextResponse.json({
              success: false,
              error: `Configuration OAuth manquante pour ${platform}. Ajoutez ${platformNames[platform] || 'les identifiants'} dans les variables d'environnement Vercel.`,
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
