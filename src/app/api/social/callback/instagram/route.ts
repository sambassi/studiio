import { NextRequest, NextResponse } from 'next/server';
import { toJsStringLiteral, escapeHtml } from '@/lib/social/html-escape';
import { auth } from '@/lib/auth/config';
import { verifyState } from '@/lib/social/oauth-state';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/social/callback/instagram?code=xxx&state=xxx
//
// Callback dediee « Instagram API with Instagram Login » (Meta a deprecie
// l'acces Instagram via Facebook Login). Route SANS query param, comme TikTok :
// Instagram compare l'URI de redirection au caractere pres a la liste blanche
// declaree dans le tableau de bord Meta, et rejette l'echange du code si un
// parametre est ajoute. On ne peut donc pas reutiliser
// /api/social/callback?platform=instagram.
//
// Consequence : contrairement a la callback TikTok — qui n'est qu'un
// re-routage vers /api/social/callback — celle-ci porte tout le flux
// (echange du code, token longue duree, profil, upsert), car le handler
// generique implemente l'ancien chemin Facebook Login pour Instagram et doit
// rester intact pour les comptes deja connectes.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorReason = searchParams.get('error_reason');
    const errorDescription = searchParams.get('error_description');

    // Refus cote Instagram (l'utilisateur a annule, ou l'app n'est pas
    // autorisee) : on journalise le detail complet renvoye par Meta.
    if (error) {
      console.error('[SOCIAL_CALLBACK_IG] provider error', {
        error,
        error_reason: errorReason,
        error_description: errorDescription,
      });
      const detail = [error, errorReason, errorDescription].filter(Boolean).join(' — ');
      return redirectWithMessage('error', `Connexion refusee: ${detail}`);
    }

    if (!code) {
      return redirectWithMessage('error', 'Parametres manquants');
    }

    // Validation du state (protection CSRF). Format : userId:timestamp:random:signature
    //
    // La SIGNATURE est indispensable : sans elle, appeler cette route avec
    // `state=<id d'une victime>:0:x` rattachait le compte Instagram de
    // l'attaquant au compte Studiio de la victime. Un `userId` lu dans un
    // state non signe n'est pas une identite, c'est une entree utilisateur.
    const verified = verifyState(state);
    if (!verified.valid || !verified.userId) {
      console.error('[SOCIAL_CALLBACK_IG] state rejete :', verified.reason);
      // Un state perime est le cas le plus frequent et le seul actionnable :
      // « State invalide » laisserait l'utilisateur sans rien a faire.
      return redirectWithMessage(
        'error',
        verified.reason === 'state expire'
          ? 'Lien de connexion expire. Relancez « Connecter » depuis Reglages.'
          : 'State invalide',
      );
    }
    const userId = verified.userId;

    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) {
      console.error('[SOCIAL_CALLBACK_IG] missing INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET');
      return redirectWithMessage('error', 'Configuration OAuth Instagram manquante cote serveur.');
    }

    // L'URI de redirection doit etre identique au caractere pres a celle
    // envoyee par /api/social/connect, sinon Instagram rejette l'echange.
    const redirectUri = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/social/callback/instagram`;

    // ── 1) Echange du code contre un token courte duree (~1 h) ──────────────
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenBody = await tokenRes.text();
    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenBody);
    } catch {
      console.error('[SOCIAL_CALLBACK_IG] token exchange: reponse non-JSON', {
        status: tokenRes.status,
        body: tokenBody.slice(0, 500),
      });
      return redirectWithMessage('error', `Echange du code Instagram illisible (HTTP ${tokenRes.status})`);
    }

    if (!tokenRes.ok || tokenData.error || tokenData.error_type || !tokenData.access_token) {
      // On journalise le corps complet : c'est la seule facon de diagnostiquer
      // un rejet Meta sans acceder aux logs du serveur (exigence PR #214).
      console.error('[SOCIAL_CALLBACK_IG] token exchange failed', {
        status: tokenRes.status,
        body: tokenData,
      });
      const detail = describeMetaError(tokenData) || `HTTP ${tokenRes.status}`;
      return redirectWithMessage('error', `Echange du code Instagram refuse: ${detail}`);
    }

    const shortLivedToken: string = tokenData.access_token;
    // user_id est l'identifiant du compte Instagram (scoped a l'app).
    const igUserId: string = String(tokenData.user_id ?? tokenData.user?.id ?? '');

    // ── 2) Token longue duree (~60 jours) ───────────────────────────────────
    let accessToken = shortLivedToken;
    let expiresIn: number | null = null;

    const longRes = await fetch(
      'https://graph.instagram.com/access_token?' +
        new URLSearchParams({
          grant_type: 'ig_exchange_token',
          client_secret: appSecret,
          access_token: shortLivedToken,
        }).toString(),
    );
    const longBody = await longRes.text();
    let longData: any = null;
    try {
      longData = JSON.parse(longBody);
    } catch {
      console.error('[SOCIAL_CALLBACK_IG] long-lived exchange: reponse non-JSON', {
        status: longRes.status,
        body: longBody.slice(0, 500),
      });
    }

    if (!longRes.ok || !longData?.access_token) {
      console.error('[SOCIAL_CALLBACK_IG] long-lived exchange failed', {
        status: longRes.status,
        body: longData,
      });
      const detail = describeMetaError(longData) || `HTTP ${longRes.status}`;
      return redirectWithMessage('error', `Token longue duree Instagram refuse: ${detail}`);
    }

    accessToken = longData.access_token;
    expiresIn = typeof longData.expires_in === 'number' ? longData.expires_in : null;

    // ── 3) Username (affichage uniquement) — NON bloquant ───────────────────
    // Comme TikTok, on retombe sur un nom derive de l'identifiant si l'appel
    // echoue : perdre le libelle ne doit pas empecher de connecter le compte.
    let accountId = igUserId;
    let accountName = igUserId ? `instagram_${igUserId.slice(0, 8)}` : 'instagram_user';
    try {
      const meRes = await fetch(
        'https://graph.instagram.com/v21.0/me?' +
          new URLSearchParams({ fields: 'user_id,username', access_token: accessToken }).toString(),
      );
      const meBody = await meRes.text();
      let meData: any = null;
      try {
        meData = JSON.parse(meBody);
      } catch {
        meData = null;
      }
      if (!meRes.ok || !meData || meData.error) {
        console.error('[SOCIAL_CALLBACK_IG] /me failed (non bloquant)', {
          status: meRes.status,
          body: meData ?? meBody.slice(0, 500),
        });
      } else {
        if (meData.username) accountName = meData.username;
        // `/me` fait AUTORITE sur l'identifiant : il renvoie le « Instagram
        // professional account ID », celui qu'attendent les appels API. Le
        // `user_id` de l'echange du code est un « Instagram-scoped user ID »,
        // proche mais pas garanti identique. On prend donc /me en priorite et
        // on ne garde l'autre que comme repli, cet appel etant non bloquant.
        if (meData.user_id) accountId = String(meData.user_id);
      }
    } catch (e: any) {
      console.error('[SOCIAL_CALLBACK_IG] /me threw (non bloquant)', e?.message || String(e));
    }

    if (!accountId) {
      console.error('[SOCIAL_CALLBACK_IG] aucun identifiant de compte Instagram resolu');
      return redirectWithMessage('error', 'Identifiant du compte Instagram introuvable.');
    }

    // ── 4) Sauvegarde ───────────────────────────────────────────────────────
    // Meme logique que /api/social/callback : le userId du state peut etre
    // perime (PR #167 a decale des user.id), on retente avec l'id de session.
    //
    // Ce repli n'est PAS une porte derobee : le state est signe, donc son
    // `userId` est authentique, et le second candidat est l'utilisateur
    // reellement authentifie dans ce navigateur. Dans les deux cas on n'ecrit
    // que sur un compte que l'appelant possede.
    const sessionForCallback = await auth();
    const sessionUserId = sessionForCallback?.user?.id;
    const candidates = [
      userId,
      ...(sessionUserId && sessionUserId !== userId ? [sessionUserId] : []),
    ];
    console.log('[SOCIAL_CALLBACK_IG] save attempt', {
      stateUserId: userId,
      sessionUserId: sessionUserId || null,
      candidatesCount: candidates.length,
    });

    const now = new Date().toISOString();
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 jours par defaut

    let dbError: any = null;
    let savedWithUserId: string | null = null;
    for (const candidate of candidates) {
      const { error: err } = await supabase
        .from('social_accounts')
        .upsert(
          {
            user_id: candidate,
            platform: 'instagram',
            account_id: accountId,
            account_name: accountName,
            access_token: accessToken,
            // Instagram Login ne renvoie pas de refresh_token : le token
            // longue duree se renouvelle via ig_refresh_token.
            refresh_token: null,
            expires_at: expiresAt,
            connected: true,
            updated_at: now,
          },
          { onConflict: 'user_id,platform' },
        );
      if (!err) {
        dbError = null;
        savedWithUserId = candidate;
        break;
      }
      dbError = err;
      console.error('[SOCIAL_CALLBACK_IG] upsert failed with user_id=' + candidate, {
        code: (err as any).code,
        message: (err as any).message,
        details: (err as any).details,
        hint: (err as any).hint,
      });
    }

    if (dbError) {
      const detail = `${(dbError as any).code || '?'} ${(dbError as any).message || ''}${(dbError as any).hint ? ' — hint: ' + (dbError as any).hint : ''}`.trim();
      return redirectWithMessage('error', `Erreur de sauvegarde: ${detail}`);
    }
    console.log('[SOCIAL_CALLBACK_IG] saved successfully', { savedWithUserId, accountId });

    return redirectWithMessage('success', 'instagram connecte avec succes!');
  } catch (error: any) {
    const msg = error?.message || String(error) || 'Erreur inconnue';
    const stack = error?.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : '';
    console.error('[SOCIAL_CALLBACK_IG_ERROR]', { msg, stack });
    return redirectWithMessage('error', msg + (stack ? ' — ' + stack : ''));
  }
}

// Extrait un message lisible du corps d'erreur Meta, quelle que soit sa forme :
// Instagram melange { error: { message, code } }, { error_message, error_type,
// code } et le format OAuth { error, error_description }.
function describeMetaError(body: any): string {
  if (!body || typeof body !== 'object') return '';
  const parts: string[] = [];
  if (typeof body.error === 'object' && body.error) {
    if (body.error.code != null) parts.push(`code ${body.error.code}`);
    if (body.error.error_subcode != null) parts.push(`subcode ${body.error.error_subcode}`);
    if (body.error.type) parts.push(String(body.error.type));
    if (body.error.message) parts.push(String(body.error.message));
  } else if (typeof body.error === 'string') {
    parts.push(body.error);
  }
  if (body.error_type) parts.push(String(body.error_type));
  if (body.code != null && typeof body.error !== 'object') parts.push(`code ${body.code}`);
  if (body.error_message) parts.push(String(body.error_message));
  if (body.error_description) parts.push(String(body.error_description));
  return parts.filter(Boolean).join(' — ');
}

// Copie conforme de la reponse HTML de /api/social/callback : la page
// /dashboard/social ecoute les messages `social-oauth-success` /
// `social-oauth-error` postes a l'ouvreur, il faut donc le meme contrat.
function redirectWithMessage(type: string, message: string): NextResponse {
  const isSuccess = type === 'success';
  // Deux contextes, deux echappements — les confondre est une XSS.
  //
  // L'ancien `replace(/'/g, "\\'")` ne tenait pas : un antislash final
  // (`...\`) devenait `...\'` et fermait la chaine JS, ce qui permettait
  // d'injecter du script. Or `message` contient `error_description`, un
  // parametre d'URL entierement controle par l'appelant.
  //
  // JSON.stringify produit un litteral JS complet et sur (guillemets inclus),
  // et `escapeHtml` couvre le contexte HTML.
  const jsMessage = toJsStringLiteral(message);
  const safeMessage = escapeHtml(message);
  const html = isSuccess
    ? `<!DOCTYPE html><html><head><title>Connexion reussie</title></head><body style="font-family:sans-serif;padding:40px;text-align:center">
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'social-oauth-success', message: ${jsMessage} }, '*');
  }
  setTimeout(() => window.close(), 800);
</script>
<p>✓ ${safeMessage}</p>
<p style="color:#888">Cette fenetre va se fermer automatiquement.</p>
</body></html>`
    : `<!DOCTYPE html><html><head><title>Erreur de connexion</title></head><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
<h2 style="color:#c00">Echec de la connexion</h2>
<p style="background:#fee;padding:16px;border-radius:8px;border:1px solid #fcc"><strong>Detail :</strong> ${safeMessage}</p>
<p style="color:#555">Copiez le message ci-dessus et renvoyez-le pour diagnostic.</p>
<button onclick="window.close()" style="padding:10px 20px;background:#333;color:#fff;border:0;border-radius:6px;cursor:pointer">Fermer</button>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'social-oauth-error', message: ${jsMessage} }, '*');
  }
</script>
</body></html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

