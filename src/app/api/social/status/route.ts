import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { canUseWhatsApp } from '@/lib/social/whatsapp';

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
    let { data: dbAccounts } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('connected', true);

    if ((!dbAccounts || dbAccounts.length === 0) && session.user.email) {
      const { data: userRow } = await supabase
        .from('users')
        .select('id')
        .eq('email', session.user.email)
        .single();
      if (userRow && userRow.id !== session.user.id) {
        const retry = await supabase
          .from('social_accounts')
          .select('*')
          .eq('user_id', userRow.id)
          .eq('connected', true);
        dbAccounts = retry.data;
      }
    }

    const dbMap: Record<string, any> = {};
    const maintenant = Date.now();
    dbAccounts?.forEach((acc) => {
      // Only trust accounts with real tokens (not demo_token)
      if (!acc.access_token || acc.access_token === 'demo_token' || acc.access_token === 'env_token') return;
      // Un jeton périmé QUE l'on ne sait pas rafraîchir n'est pas « connecté » :
      // YouTube et TikTok exigent un refresh_token pour se renouveler ; sans lui,
      // la publication échouerait — on ne l'annonce pas comme connecté. Meta
      // (Facebook/Instagram) : la date stockée est indicative (jeton de page
      // non expirant, renouvelé à la publication) — on ne la traite pas.
      const expire = !!acc.expires_at && new Date(acc.expires_at).getTime() < maintenant;
      const renouvelable = acc.platform === 'youtube' || acc.platform === 'tiktok' ? !!acc.refresh_token : true;
      if (expire && !renouvelable) return;
      dbMap[acc.platform] = acc;
    });

    // Check which platforms have OAuth configured (can initiate connection).
    // Meta : la route de connexion exige AUSSI `META_CONFIG_ID` (Facebook Login
    // for Business) — sans lui, un bouton « Connecter » n'aboutirait pas.
    const hasMetaConfig = !!process.env.META_CONFIG_ID;
    const hasInstagramOAuth = !!(process.env.META_INSTAGRAM_APP_ID || process.env.FACEBOOK_CLIENT_ID) && hasMetaConfig;
    const hasFacebookOAuth = !!process.env.FACEBOOK_CLIENT_ID && hasMetaConfig;
    const hasTiktokOAuth = !!process.env.TIKTOK_CLIENT_KEY;
    const hasYoutubeOAuth = !!(process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);

    /**
     * Plateformes mises en attente.
     *
     * Masquage d'interface REVERSIBLE, et uniquement cela : aucune cle,
     * aucun jeton, aucun compte deja connecte n'est supprime. Retirer une
     * entree de cet ensemble suffit a rendre la plateforme connectable —
     * c'est le meme principe que `channels['afroboost.com']` plus bas.
     */
    const ON_HOLD = new Set(['youtube', 'tiktok']);

    const platforms = {
      instagram: {
        available: !ON_HOLD.has('instagram'),
        connected: !!dbMap.instagram,
        username: dbMap.instagram?.account_name || null,
        source: dbMap.instagram ? 'database' : null,
        oauthAvailable: hasInstagramOAuth,
      },
      facebook: {
        available: !ON_HOLD.has('facebook'),
        connected: !!dbMap.facebook,
        username: dbMap.facebook?.account_name || null,
        source: dbMap.facebook ? 'database' : null,
        oauthAvailable: hasFacebookOAuth,
      },
      tiktok: {
        available: !ON_HOLD.has('tiktok'),
        connected: !!dbMap.tiktok,
        username: dbMap.tiktok?.account_name || null,
        source: dbMap.tiktok ? 'database' : null,
        oauthAvailable: hasTiktokOAuth,
      },
      youtube: {
        available: !ON_HOLD.has('youtube'),
        connected: !!dbMap.youtube,
        username: dbMap.youtube?.account_name || null,
        source: dbMap.youtube ? 'database' : null,
        oauthAvailable: hasYoutubeOAuth,
      },
    };

    // Canaux hors reseaux sociaux. On expose UNIQUEMENT un booleen de
    // configuration — jamais le token, qui ne doit pas atteindre le navigateur.
    const channels = {
      email: { available: !!process.env.RESEND_API_KEY },
      // Booleen calcule pour CE compte : un utilisateur non autorise voit
      // le canal « bientot disponible », comme s'il n'etait pas configure.
      whatsapp: { available: canUseWhatsApp(session.user.email) },
      'afroboost.com': { available: false },
    };

    return NextResponse.json({ success: true, platforms, channels });
  } catch (error) {
    console.error('Social status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to check status' }, { status: 500 });
  }
}
