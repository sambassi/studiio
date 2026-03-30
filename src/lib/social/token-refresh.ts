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
