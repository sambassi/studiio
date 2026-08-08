import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { droitDePublier } from '@/lib/social/publishing';
import { isZernioPlatform } from '@/lib/social/zernio';

/**
 * Les réseaux connectés de l'utilisateur — et l'enregistrement du retour de
 * connexion.
 *
 * ⚠️ POURQUOI UN `POST` ICI ALORS QU'IL Y A UN WEBHOOK. Le retour de Zernio
 * porte déjà `accountId`, `platform` et `username` dans l'URL : l'écran peut
 * donc afficher le compte IMMÉDIATEMENT, sans attendre une livraison réseau
 * qui peut prendre quelques secondes — ou ne jamais arriver si le webhook
 * n'est pas configuré. Le webhook confirme et corrige ; il ne conditionne
 * pas l'affichage.
 *
 * Les deux chemins écrivent la même ligne, d'où l'unicité sur `account_id`
 * qui rend l'écriture idempotente.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const droit = await droitDePublier(session.user.id, session.user.email);
    const { data } = await supabaseAdmin
      .from('zernio_accounts')
      .select('account_id, platform, username, status')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });
    return NextResponse.json({
      success: true,
      autorise: droit.autorise,
      admin: droit.admin,
      raison: droit.raison ?? null,
      comptes: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        accountId: String(r.account_id),
        platform: String(r.platform),
        username: (r.username as string | null) ?? null,
        status: String(r.status ?? 'connected'),
      })),
    });
  } catch (err) {
    console.error('[Zernio/Accounts]', err);
    return NextResponse.json({ success: true, autorise: false, comptes: [] });
  }
}

/** Enregistre le compte que le retour de connexion vient d'annoncer. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const droit = await droitDePublier(session.user.id, session.user.email);
    if (!droit.autorise) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const corps = await req.json().catch(() => ({})) as Record<string, unknown>;
    const accountId = typeof corps.accountId === 'string' ? corps.accountId : '';
    const platform = corps.platform;
    if (!accountId || !isZernioPlatform(platform)) {
      return NextResponse.json({ success: false, error: 'Paramètres manquants.' }, { status: 400 });
    }
    // ⚠️ LE `profileId` VIENT DE NOTRE BASE, PAS DE L'URL. Celui de l'URL est
    // sous le contrôle du navigateur : s'en servir laisserait un utilisateur
    // rattacher un compte au profil d'un autre.
    if (!droit.profileId) {
      return NextResponse.json({ success: false, error: 'Profil absent.' }, { status: 409 });
    }
    const { error } = await supabaseAdmin.from('zernio_accounts').upsert(
      {
        user_id: session.user.id,
        profile_id: droit.profileId,
        account_id: accountId,
        platform,
        username: typeof corps.username === 'string' ? corps.username : null,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    );
    if (error) {
      console.error('[Zernio/Accounts] upsert :', error.message);
      return NextResponse.json({ success: false, error: 'Enregistrement impossible.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Zernio/Accounts]', err);
    return NextResponse.json({ success: false, error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
