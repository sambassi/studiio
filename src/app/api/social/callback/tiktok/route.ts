import { NextRequest } from 'next/server';

// TikTok OAuth callback - redirects to main callback handler with platform=tiktok
// TikTok does not allow query parameters in redirect URIs, so we use a dedicated path
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const error_description = searchParams.get('error_description');

  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const params = new URLSearchParams();
    params.set('platform', 'tiktok');
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    if (error) params.set('error', error);
    if (error_description) params.set('error_description', error_description);

  return Response.redirect(`${baseUrl}/api/social/callback?${params.toString()}`);
}
