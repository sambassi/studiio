/**
 * M3-H — LA LECTURE D'UN RENDU.
 *
 * Elle rend l'ÉTAT PUBLIC, jamais la ligne. C'est par elle que l'écran suit
 * un rendu lancé en 202 : `en_attente`, `en_cours` avec son étape, puis
 * `reussie` avec les mesures du fichier ou `echouee` avec son motif fermé.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN. Consulter l'avancement ne doit pas le terminer : un
 * écran qui rafraîchit toutes les cinq secondes tuerait le rendu qu'il
 * regarde. La récupération des rendus abandonnés appartient à la CRÉATION,
 * et à elle seule — la leçon de M3-B3, reprise en M3-F et M3-G.
 *
 * ⚠️ AUCUNE URL SIGNÉE, AUCUN COMPARTIMENT, AUCUNE CLÉ. Le fichier se lit par
 * une route sœur qui refait le contrôle de propriété à chaque requête.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { diagnosticRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { lireRenduParId } from '@/lib/autopilot/analyse/rendu-service';
import { renduPublic } from '@/lib/autopilot/analyse/rendu-presentation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

const SOCLE_ABSENT = 'La table des rendus n’existe pas encore sur ce serveur.';

export async function GET(
  _req: NextRequest, { params }: { params: { renduId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!identifiantValide(params.renduId)) {
      return NextResponse.json(
        { ok: false, error: 'Identifiant invalide.', motif: 'identifiant_invalide' },
        { status: 422 },
      );
    }

    const { rendu, motif } = await lireRenduParId(session.user.id, params.renduId);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    if (!rendu) {
      return NextResponse.json({ ok: false, error: 'Rendu introuvable' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, rendu: renduPublic(rendu) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e: unknown) {
    console.error(
      `[autopilote][rendu] panne inattendue : ${diagnosticRendu(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
