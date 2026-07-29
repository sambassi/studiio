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
    // Instagram est sorti du groupe Meta : depuis la migration vers
    // « Instagram API with Instagram Login », le token vient de
    // graph.instagram.com et n'est PAS echangeable via fb_exchange_token.
    // Facebook, lui, reste strictement sur l'ancien chemin.
    case 'instagram':
      return await refreshInstagramToken(account);
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
 * Rafraichissement d'un token « Instagram API with Instagram Login ».
 *
 * Endpoint : GET https://graph.instagram.com/refresh_access_token
 *   ?grant_type=ig_refresh_token&access_token=<token longue duree>
 * Reponse : { access_token, token_type, expires_in }  (~60 jours)
 *
 * POURQUOI PAS DE client_id / client_secret : contrairement a
 * `fb_exchange_token` (Facebook Login), le flux `ig_refresh_token` ne prend
 * AUCUN identifiant d'application. Le token porte lui-meme l'app et l'utilisateur ;
 * ajouter client_id/client_secret ferait rejeter la requete. C'est la difference
 * cle avec `refreshMetaToken`, qu'il ne faut donc pas reutiliser ici.
 *
 * POURQUOI ON NE THROW PAS : un token Instagram longue duree n'est
 * rafraichissable que s'il a PLUS de 24 h et MOINS de 60 jours. Un token tout
 * juste emis fait donc legitimement echouer cet appel alors qu'il est
 * parfaitement valide pour publier. Faire remonter l'erreur casserait une
 * publication qui aurait reussi : on journalise le code et le message exacts
 * renvoyes par Meta, puis on retombe sur le token stocke (default safe).
 */
async function refreshInstagramToken(account: any): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?` +
      `grant_type=ig_refresh_token&access_token=${encodeURIComponent(account.access_token)}`
    );

    const data = await res.json();

    if (data.error || !data.access_token) {
      // On trace le code ET le message exacts : le code (ex. 190 /
      // error_subcode 463) est le seul moyen de distinguer « token trop
      // recent, non eligible » de « token revoque, reconnexion requise ».
      const err = data.error || {};
      console.warn(
        `[token-refresh] Instagram refresh echoue (compte ${account.id}) — ` +
        `code=${err.code ?? 'n/a'} subcode=${err.error_subcode ?? 'n/a'} ` +
        `type=${err.type ?? 'n/a'} message=${err.message ?? 'reponse sans access_token'} ` +
        `fbtrace_id=${err.fbtrace_id ?? 'n/a'} http=${res.status}`
      );
      return account.access_token;
    }

    // Meme persistance que refreshMetaToken : memes colonnes, meme updated_at,
    // meme filtre sur l'id du compte.
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
  } catch (e) {
    // Panne reseau ou reponse non JSON : meme repli, la publication doit
    // pouvoir tenter sa chance avec le token deja en base.
    console.warn(
      `[token-refresh] Instagram refresh injoignable (compte ${account.id}):`,
      e instanceof Error ? e.message : e
    );
    return account.access_token;
  }
}

async function refreshMetaToken(account: any): Promise<string> {
  // Meta long-lived tokens last 60 days and can be refreshed
  const appId = process.env.FACEBOOK_CLIENT_ID;
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET;

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
