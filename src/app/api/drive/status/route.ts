import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getDriveAccount, disconnectDrive, DRIVE_SCOPE } from '@/lib/drive/oauth';

/**
 * Etat de la connexion Drive, et deconnexion.
 *
 * `configured` distingue « pas connecte » de « pas configure sur ce
 * serveur » : sans cette nuance, l'utilisateur cliquerait indefiniment sur un
 * bouton qui ne peut pas aboutir.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const compte = await getDriveAccount(session.user.id);
    return NextResponse.json({
      success: true,
      configured: !!process.env.GOOGLE_CLIENT_ID,
      connected: !!compte,
      email: compte?.account_email ?? null,
      // Google peut accorder MOINS que demande : le dire evite un envoi
      // voue au 403, et permet a l'ecran de proposer une reconnexion.
      scopeOk: !compte || (compte.scopes ?? '').includes(DRIVE_SCOPE),
    });
  } catch (err) {
    console.error('[Drive/Status]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: true, configured: false, connected: false, email: null, scopeOk: true });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const ok = await disconnectDrive(session.user.id);
    return NextResponse.json(
      ok ? { success: true } : { success: false, error: 'Déconnexion impossible.' },
      { status: ok ? 200 : 500 },
    );
  } catch (err) {
    console.error('[Drive/Status] delete', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Déconnexion impossible.' }, { status: 500 });
  }
}
