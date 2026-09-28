/**
 * Social Token Refresh Utilities
 * Handles OAuth token refresh for platforms with short-lived tokens.
 */

import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Check if a token needs refresh and refresh it if necessary.
 * Returns the valid access token.
 */
export async function getValidToken(accountId: string): Promise<string> {
  const { data: account, error } = await supabaseAdmin
    .from('social_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (error || !account) {
    throw new Error('Social account not found');
  }

  // Check if token has expired
  if (account.expires_at) {
    const expiresAt = new Date(account.expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

    if (now.getTime() + bufferMs > expiresAt.getTime()) {
      // Token expired or about to expire, refresh it
      return await refreshToken(account);
    }
  }

  return account.access_token;
}

async function refreshToken(account: any): Promise<string> {
  switch (account.platform) {
    case 'youtube':
      return await refreshYouTubeToken(account);
    case 'tiktok':
      return await refreshTikTokToken(account);
    case 'instagram':
    case 'facebook':
      return await refreshMetaToken(account);
    default:
      return account.access_token;
  }
}

async function refreshYouTubeToken(account: any): Promise<string> {
  if (!account.refresh_token) {
    throw new Error('No refresh token available for YouTube');
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId || '',
      client_secret: clientSecret || '',
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`YouTube token refresh failed: ${data.error_description || data.error}`);
  }

  // Update token in database
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await supabaseAdmin
    .from('social_accounts')
    .update({
      access_token: data.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  return data.access_token;
}

async function refreshTikTokToken(account: any): Promise<string> {
  if (!account.refresh_token) {
    throw new Error('No refresh token available for TikTok');
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey || '',
      client_secret: clientSecret || '',
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`TikTok token refresh failed: ${data.error_description || data.error}`);
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await supabaseAdmin
    .from('social_accounts')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  return data.access_token;
}

/**
 * Meta (Facebook / Instagram).
 *
 * Le callback OAuth stocke un jeton de PAGE (`/me/accounts` -> `access_token`),
 * jamais le jeton utilisateur : c'est lui qui publie sur `/{page-id}/videos`
 * et `/{ig-user-id}/media`. Derive d'un jeton utilisateur long, un jeton de
 * page n'expire pas ; le `expires_at` a +60 jours ecrit par le callback est
 * celui du jeton UTILISATEUR, pas le sien.
 *
 * L'ancien code passait ce jeton de page a `fb_exchange_token` (reserve aux
 * jetons utilisateur) puis ECRASAIT `access_token` avec la reponse : au mieux
 * une erreur a chaque publication, au pire un jeton utilisateur a la place du
 * jeton de page, et Facebook/Instagram cassaient jusqu'a reconnexion.
 *
 * On demande donc d'abord a Meta la nature du jeton (`debug_token`) :
 *  - PAGE valide  -> on ne touche PAS au jeton, on corrige seulement
 *                    `expires_at` (null = n'expire pas) ;
 *  - invalide     -> erreur explicite (reconnexion necessaire), rien ecrit ;
 *  - USER         -> seul cas ou l'echange `fb_exchange_token` a un sens.
 * Tout echec de diagnostic leve SANS rien ecrire : les appelants gardent alors
 * le jeton stocke.
 */
async function refreshMetaToken(account: any): Promise<string> {
  const appId = process.env.FACEBOOK_CLIENT_ID;
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET;
  const appToken = `${appId}|${appSecret}`;

  const debugRes = await fetch(
    `https://graph.facebook.com/v24.0/debug_token?` +
    `input_token=${encodeURIComponent(account.access_token)}&access_token=${encodeURIComponent(appToken)}`
  );
  const debugJson = await debugRes.json();
  const info = debugJson?.data;

  if (debugJson?.error || !info) {
    throw new Error(
      `Meta token inspection failed: ${debugJson?.error?.message || 'no data'}`
    );
  }

  if (info.is_valid === false) {
    throw new Error(
      `Meta token invalid (${info.type || 'unknown'}): reconnexion du compte necessaire`
    );
  }

  if (info.type !== 'USER') {
    // Jeton de PAGE (ou autre jeton non echangeable) : on le garde tel quel.
    // `expires_at: 0` = n'expire jamais -> null, et getValidToken ne
    // redeclenchera plus de rafraichissement inutile.
    const expiresAt =
      typeof info.expires_at === 'number' && info.expires_at > 0
        ? new Date(info.expires_at * 1000).toISOString()
        : null;

    await supabaseAdmin
      .from('social_accounts')
      .update({
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return account.access_token;
  }

  // Jeton UTILISATEUR : l'echange long-lived est le flux documente par Meta.
  const res = await fetch(
    `https://graph.facebook.com/v24.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${account.access_token}`
  );

  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta token refresh failed: ${data.error.message}`);
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  await supabaseAdmin
    .from('social_accounts')
    .update({
      access_token: data.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  return data.access_token;
}
