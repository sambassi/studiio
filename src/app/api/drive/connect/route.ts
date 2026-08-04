import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { signState, buildAuthUrl, driveStoreReady } from '@/lib/drive/oauth';

/**
 * POST /api/drive/connect — rend l'URL de consentement Google.
 *
 * La table est sondee AVANT : envoyer l'utilisateur consentir chez Google pour
 * decouvrir au retour qu'on ne sait pas ranger son jeton lui ferait accorder
 * un acces pour rien.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!(await driveStoreReady())) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google Drive n’est pas encore disponible : la migration user_drive n’a pas été appliquée.',
        },
        { status: 503 },
      );
    }

    const state = signState(session.user.id);
    if (!state) {
      // Sans secret, aucun `state` n'est verifiable : on refuse plutot que
      // d'ouvrir un callback que n'importe qui pourrait appeler.
      return NextResponse.json(
        { success: false, error: 'AUTH_SECRET manquant — connexion impossible.' },
        { status: 500 },
      );
    }

    const authUrl = buildAuthUrl(state);
    if (!authUrl) {
      return NextResponse.json(
        {
          success: false,
          needsConfig: true,
          error: 'Configuration OAuth manquante : ajoutez GOOGLE_CLIENT_ID dans les variables d’environnement.',
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ success: true, authUrl });
  } catch (err) {
    console.error('[Drive/Connect]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Connexion impossible.' }, { status: 500 });
  }
}
