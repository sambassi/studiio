import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireSession } from '@/lib/autopilot/tournage/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Une session de tournage, si elle appartient à l'utilisateur connecté.
 *
 * Une session d'autrui rend 404, pas 403 : un 403 confirmerait qu'elle
 * existe. Le filtre de propriété vit dans la requête SQL, pas dans un `if`
 * qu'un futur appelant pourrait contourner.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { session: tournage, motif } = await lireSession(session.user.id, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Sessions de tournage indisponibles : migration '
            + '2026-08-31-shoot-sessions-rushes.sql non appliquée sur ce serveur.',
        },
        { status: 503 },
      );
    }
    if (!tournage) {
      return NextResponse.json({ ok: false, error: 'Session introuvable' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, session: tournage });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
