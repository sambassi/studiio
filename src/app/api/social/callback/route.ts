import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/social/callback?platform=xxx&code=xxx&state=xxx
// OAuth callback handler for all social platforms
export async function GET(req: NextRequest) {
    try {
          const { searchParams } = new URL(req.url);
          const platform = searchParams.get('platform');
          const code = searchParams.get('code');
          const state = searchParams.get('state');
          const error = searchParams.get('error');

      if (error) {
              return redirectWithMessage('error', `Connexion refusee: ${error}`);
      }

      if (!platform || !code) {
              return redirectWithMessage('error', 'Parametres manquants');
      }

      // Validate state (CSRF protection)
      // State format: userId:timestamp:random
      if (!state) {
              return redirectWithMessage('error', 'State invalide');
      }

      const [userId] = state.split(':');
          if (!userId) {
                  return redirectWithMessage('error', 'State invalide');
          }

      let tokenData: { accessToken: string; refreshToken?: string; accountId: string; accountName: string; expiresAt?: string };

      switch (platform) {
        case 'instagram':
        case 'facebook':
                  tokenData = await exchangeMetaToken(code, platform);
                  break;
        case 'tiktok':
                  tokenData = await exchangeTikTokToken(code);
                  break;
        case 'youtube':
                  tokenData = await exchangeYouTubeToken(code);
                  break;
        default:
                  return redirectWithMessage('error', `Plateforme non supportee: ${platform}`);
      }

      // Save to database
      const now = new Date().toISOString();
          const { error: dbError } = await supabase
            .from('social_accounts')
            .upsert(
              {
                          user_id: userId,
                          platform,
                          account_id: tokenData.accountId,
                          account_name: tokenData.accountName,
                          access_token: tokenData.accessToken,
                          refresh_token: tokenData.refreshToken || null,
                          expires_at: tokenData.expiresAt || null,
                          connected: true,
                          updated_at: now,
              },
              { onConflict: 'user_id,platform' }
                    );

      if (dbError) {
              console.error('DB error saving social account:', dbError);
              return redirectWithMessage('error', 'Erreur de sauvegarde');
      }

      return redirectWithMessage('success', `${platform} connecte avec succes!`);
    } catch (error) {
          console.error('OAuth callback error:', error);
          return redirectWithMessage('error', 'Erreur de connexion');
    }
}

function redirectWithMessage(type: string, message: string): NextResponse {
    // Close the popup window and notify the opener
  const html = `
      <!DOCTYPE html>
          <html>
              <head><title>Connexion ${type === 'success' ? 'reussie' : 'echouee'}</title></head>
                  <body>
                        <script>
                                if (window.opener) {
                                          window.opener.postMessage({
                                                      type: 'social-oauth-${type}',
                                                                  message: '${message.replace(/'/g, "\\'")}'
                                                                            }, '*');
                                                                                    }
                                                                                            window.close();
                                                                                                  </script>
                                                                                                        <p>${message}</p>
                                                                                                              <p>Cette fenetre va se fermer automatiquement...</p>
                                                                                                                  </body>
                                                                                                                      </html>
                                                                                                                        `;
    return new NextResponse(html, {
          headers: { 'Content-Type': 'text/html' },
    });
}

// ══════════════════════════════════════════════════════════════
// TOKEN EXCHANGE FUNCTIONS
// ══════════════════════════════════════════════════════════════

async function exchangeMetaToken(code: string, platform: string) {
    const appId = platform === 'instagram'
      ? process.env.META_INSTAGRAM_APP_ID || process.env.FACEBOOK_CLIENT_ID
          : process.env.FACEBOOK_CLIENT_ID;
    const appSecret = platform === 'instagram'
      ? process.env.META_INSTAGRAM_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET
          : process.env.FACEBOOK_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL}/api/social/callback?platform=${platform}`;

  // Exchange code for short-lived token
  const tokenRes = await fetch(
        `https://graph.facebook.com/v24.0/oauth/access_token?` +
        `client_id=${appId}&client_secret=${appSecret}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`
      );
    const tokenData = await tokenRes.json();

  if (tokenData.error) {
        throw new Error(tokenData.error.message);
  }

  // Exchange for long-lived token (60 days)
  const longTokenRes = await fetch(
        `https://graph.facebook.com/v24.0/oauth/access_token?` +
        `grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
      );
    const longTokenData = await longTokenRes.json();
    let accessToken = longTokenData.access_token || tokenData.access_token;

  // Get account info
  let accountId = '';
    let accountName = '';

  if (platform === 'instagram') {
        // Get Instagram Business Account ID via Facebook Pages
        // User may have multiple pages — iterate all to find the one with an IG Business Account
      const pagesRes = await fetch(
              `https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
            );
        const pagesData = await pagesRes.json();
        const pages = pagesData.data || [];

        console.log(`[OAuth/Instagram] Found ${pages.length} Facebook Pages:`, pages.map((p: any) => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.id })));

        // Find the first page that has an Instagram Business Account linked
        let igAccountId: string | null = null;
        let pageAccessToken: string | null = null;
        let linkedPageId: string | null = null;
        let fallbackPageName = pages[0]?.name || 'instagram_user';

        for (const page of pages) {
          if (page.instagram_business_account?.id) {
            igAccountId = page.instagram_business_account.id;
            pageAccessToken = page.access_token || null;
            linkedPageId = page.id;
            fallbackPageName = page.name;
            console.log(`[OAuth/Instagram] Found IG Business Account ${igAccountId} on page "${page.name}" (page_id: ${page.id})`);
            break;
          }
        }

        // If no page has IG Business Account, try querying each page individually
        if (!igAccountId) {
          for (const page of pages) {
            const igRes = await fetch(
              `https://graph.facebook.com/v24.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
            );
            const igData = await igRes.json();
            if (igData.instagram_business_account?.id) {
              igAccountId = igData.instagram_business_account.id;
              pageAccessToken = page.access_token || null;
              linkedPageId = page.id;
              fallbackPageName = page.name;
              console.log(`[OAuth/Instagram] Found IG Business Account ${igAccountId} on page "${page.name}" (individual query)`);
              break;
            }
          }
        }

        accountId = igAccountId || pages[0]?.id || '';

        // Use the Page Access Token for Instagram publishing (required by Graph API)
        // The page access token is scoped to the specific page that owns the IG account
        if (pageAccessToken) {
          accessToken = pageAccessToken;
          console.log(`[OAuth/Instagram] Using page access token from page ${linkedPageId} for IG publishing`);
        }

        // Get IG username from the Instagram Business Account
        if (accountId) {
          const igInfoRes = await fetch(
            `https://graph.facebook.com/v24.0/${accountId}?fields=username,name&access_token=${accessToken}`
          );
          const igInfo = await igInfoRes.json();
          accountName = igInfo.username || igInfo.name || fallbackPageName;
          console.log(`[OAuth/Instagram] IG username resolved: "${accountName}" (from account ${accountId})`);
        } else {
          accountName = fallbackPageName;
        }
  } else {
        // Facebook Page
      const meRes = await fetch(
              `https://graph.facebook.com/v24.0/me?fields=id,name&access_token=${accessToken}`
            );
        const meData = await meRes.json();
        accountId = meData.id;
        accountName = meData.name || 'facebook_user';
  }

  const expiresAt = longTokenData.expires_in
      ? new Date(Date.now() + longTokenData.expires_in * 1000).toISOString()
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days default

  return { accessToken, accountId, accountName, expiresAt };
}

async function exchangeTikTokToken(code: string) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL}/api/social/callback/tiktok`;

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
                client_key: clientKey || '',
                client_secret: clientSecret || '',
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
        }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
  }

  return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accountId: tokenData.open_id,
        accountName: `tiktok_${tokenData.open_id?.slice(0, 8)}`,
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
                : undefined,
  };
}

async function exchangeYouTubeToken(code: string) {
    const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL}/api/social/callback?platform=youtube`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
                code,
                client_id: clientId || '',
                client_secret: clientSecret || '',
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
        }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
  }

  // Get channel inf
  const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
    const channelData = await channelRes.json();
    const channel = channelData.items?.[0];

  return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accountId: channel?.id || 'unknown',
        accountName: channel?.snippet?.title || 'youtube_user',
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
                : undefined,
  };
}
