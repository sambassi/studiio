import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { droitDePublier, assurerProfil, MESSAGES_REFUS } from '@/lib/social/publishing';
import { getConnectUrl, isZernioPlatform, ZernioError } from '@/lib/social/zernio';

/**
 * Démarre la connexion d'un réseau, en marque blanche.
 *
 * ⚠️ LE GARDE EST ICI, PAS DANS L'ÉCRAN. Masquer un bouton n'empêche personne
 * d'appeler la route : sans ce contrôle, n'importe quel compte pourrait faire
 * créer un profil Zernio — que Studiio paie.
 *
 * Le profil n'est provisionné qu'à cet instant précis : c'est le premier
 * moment où l'utilisateur a réellement demandé à publier.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { platform } = await req.json().catch(() => ({})) as { platform?: unknown };
    if (!isZernioPlatform(platform)) {
      return NextResponse.json({ success: false, error: 'Plateforme inconnue.' }, { status: 400 });
    }

    const droit = await droitDePublier(session.user.id, session.user.email);
    if (!droit.autorise) {
      return NextResponse.json(
        { success: false, error: MESSAGES_REFUS[droit.raison ?? 'option-absente'] },
        { status: 403 },
      );
    }

    const profileId = await assurerProfil(session.user.id, session.user.email);
    if (!profileId) {
      return NextResponse.json(
        { success: false, error: MESSAGES_REFUS['profil-absent'] },
        { status: 503 },
      );
    }

    // ⚠️ URL ABSOLUE OBLIGATOIRE : Zernio redirige un NAVIGATEUR dessus, pas
    // une requête interne. `NEXT_PUBLIC_APP_URL` et non l'en-tête `Host`, qui
    // est falsifiable.
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://studiio.pro';
    const authUrl = await getConnectUrl(platform, profileId, `${base}/dashboard/social/callback`);
    return NextResponse.json({ success: true, authUrl });
  } catch (err) {
    if (err instanceof ZernioError) {
      console.error('[Zernio/Connect]', err.message);
      return NextResponse.json(
        {
          success: false,
          error: err.paymentRequired
            ? 'La publication sur les réseaux est momentanément indisponible.'
            : 'Connexion impossible pour le moment. Réessayez.',
        },
        { status: err.paymentRequired ? 503 : 502 },
      );
    }
    console.error('[Zernio/Connect]', err);
    return NextResponse.json({ success: false, error: 'Connexion impossible.' }, { status: 500 });
  }
}
