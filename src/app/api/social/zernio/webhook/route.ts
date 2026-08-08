import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Webhook Zernio — un seul point d'entrée, routage interne.
 *
 * ⚠️ CETTE ROUTE EST PUBLIQUE : n'importe qui sur Internet peut l'appeler.
 * C'est la SIGNATURE qui fait foi, rien d'autre. Sans elle, il suffirait de
 * poster un `account.connected` bien formé pour rattacher un compte au profil
 * d'un autre utilisateur.
 *
 * Zernio signe le corps BRUT en HMAC-SHA256 et le pose dans
 * `X-Zernio-Signature` (spécification OpenAPI publique). La signature y est
 * *optionnelle* — elle ne s'active qu'en configurant un secret côté Zernio.
 * D'où la règle ci-dessous, qui n'est pas une commodité :
 *
 * ⚠️ SANS `ZERNIO_WEBHOOK_SECRET`, ON REFUSE TOUT. Accepter les événements non
 * signés « en attendant » laisserait une porte ouverte que personne ne
 * penserait à refermer — et elle ne se verrait dans aucun test.
 *
 * ⚠️ ET LE CORPS SE LIT EN TEXTE, PAS EN JSON. `req.json()` reformate ; le
 * HMAC porte sur les octets exacts. Un espace de différence et toute
 * signature valide serait rejetée.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Comparaison à temps constant — une comparaison naïve fuit la signature. */
function signatureValide(brut: string, entete: string | null, secret: string): boolean {
  if (!entete) return false;
  const attendu = createHmac('sha256', secret).update(brut, 'utf8').digest('hex');
  // Zernio peut préfixer (`sha256=…`) : on compare la partie hexadécimale.
  const recu = entete.includes('=') ? entete.split('=').pop()!.trim() : entete.trim();
  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(recu.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** L'utilisateur derrière un profil Zernio. */
async function utilisateurDuProfil(profileId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users').select('id').eq('zernio_profile_id', profileId).limit(1);
  return (data?.[0] as { id?: string } | undefined)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error(
      '[Zernio/Webhook] ZERNIO_WEBHOOK_SECRET absente — evenements REFUSES. '
      + 'Configurer le secret cote Zernio (Settings → Webhooks) et dans Coolify.',
    );
    return NextResponse.json({ success: false }, { status: 503 });
  }

  const brut = await req.text();
  if (!signatureValide(brut, req.headers.get('x-zernio-signature'), secret)) {
    console.warn('[Zernio/Webhook] Signature invalide — evenement ignore.');
    return NextResponse.json({ success: false }, { status: 401 });
  }

  let evenement: Record<string, unknown>;
  try {
    evenement = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  // ⚠️ ON REPOND 200 QUOI QU'IL ARRIVE ENSUITE. Un 5xx ferait rejouer
  // l'evenement en boucle chez Zernio pour une erreur qui vient de NOTRE base :
  // le traitement est journalisé, la livraison acquittée.
  try {
    await traiter(evenement);
  } catch (err) {
    console.error('[Zernio/Webhook] Traitement echoue :', err);
  }
  return NextResponse.json({ success: true });
}

async function traiter(evenement: Record<string, unknown>): Promise<void> {
  const type = String(evenement.event ?? evenement.type ?? '');
  const data = (evenement.data ?? evenement) as Record<string, unknown>;

  if (type === 'account.connected' || type === 'account.disconnected') {
    const accountId = String(data.accountId ?? data._id ?? '');
    const profileId = String(data.profileId ?? '');
    if (!accountId || !profileId) return;

    if (type === 'account.disconnected') {
      // Pas de `user_id` a retrouver : la ligne existe deja, on ne touche
      // qu'au statut. L'ecran proposera « Reconnecter ».
      await supabaseAdmin
        .from('zernio_accounts')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('account_id', accountId);
      return;
    }

    const userId = await utilisateurDuProfil(profileId);
    if (!userId) {
      console.warn(`[Zernio/Webhook] Profil ${profileId} sans utilisateur — evenement ignore.`);
      return;
    }
    await supabaseAdmin.from('zernio_accounts').upsert(
      {
        user_id: userId,
        profile_id: profileId,
        account_id: accountId,
        platform: String(data.platform ?? 'inconnu'),
        username: typeof data.username === 'string' ? data.username : null,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    );
    return;
  }

  if (type === 'post.published' || type === 'post.failed' || type === 'post.partial') {
    // ⚠️ ON RETROUVE LE POST PAR L'IDENTIFIANT QU'ON A ECRIT A LA CREATION,
    // range dans `metadata.studiioPostId`. Se fier a un rapprochement par
    // date ou par contenu confondrait deux montages du meme cycle.
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const postId = typeof meta.studiioPostId === 'string' ? meta.studiioPostId : null;
    if (!postId) return;
    const statut = type === 'post.published' ? 'published' : 'failed';
    await supabaseAdmin
      .from('scheduled_posts')
      .update({ status: statut })
      .eq('id', postId);
  }
}
