import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { signState } from '@/lib/social/oauth-state';

const APP_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Le `state` est desormais SIGNE (4e segment). Voir src/lib/social/oauth-state.ts :
// sans signature, forger `state=<id victime>:0:x` rattachait le compte social de
// l'attaquant au compte Studiio de la victime. Les callbacks historiques lisent
// `state.split(':')[0]` et ignorent donc le segment ajoute — aucune regression.
const generateState = signState;

function getOAuthUrl(platform: string, state: string): string | null {
    switch (platform) {
      // Instagram passe desormais par « Instagram API with Instagram Login » :
      // Meta a deprecie l'acces Instagram via Facebook Login, l'utilisateur se
      // connecte directement avec son compte Instagram Business/Creator, sans
      // Page Facebook intermediaire.
      //
      // La redirection pointe vers une route DEDIEE et SANS query param :
      // Instagram compare l'URI de redirection au caractere pres a la liste
      // blanche du tableau de bord Meta et rejette tout parametre ajoute
      // (meme contrainte que TikTok, d'ou le meme pattern de route dediee).
      case 'instagram': {
              const redirectUri = encodeURIComponent(`${APP_URL}/api/social/callback/instagram`);
              const appId = process.env.INSTAGRAM_APP_ID;
              if (!appId) return null;
              // Scopes « Instagram Login » : lecture du profil + publication.
              // La virgule est le separateur attendu par Instagram, on l'encode
              // pour ne pas dependre de la tolerance du provider.
              const scope = encodeURIComponent('instagram_business_basic,instagram_business_content_publish');
              return `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
      }

      // Facebook reste sur Facebook Login for Business. Les scopes sont lies a
      // la Login Configuration cote Meta — le client passe `config_id` au lieu
      // de `scope`.
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
              // Scopes doivent matcher exactement la config du TikTok Developer Portal.
              return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic,video.upload&redirect_uri=${redirectUri}&state=${state}`;
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
              instagram: 'INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET',
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
