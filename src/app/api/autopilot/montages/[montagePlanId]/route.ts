/**
 * M3-G — LA LECTURE D'UN PLAN DE MONTAGE.
 *
 * Elle lit une ligne, et rien d'autre. C'est par elle que l'écran — et
 * demain M3-H — récupère ce qui a été décidé : l'ordre des plans, leurs
 * durées, leurs positions et leurs rectangles de recadrage.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN. Consulter un plan ne le recalcule pas : un plan est
 * une décision figée, et la refaire à chaque lecture la rendrait sensible à
 * un changement de constante entre deux affichages.
 *
 * ⚠️ AUCUNE URL SIGNÉE N'EST RENDUE. Chaque plan donne son compartiment et sa
 * clé ; l'accès aux octets passe par le relais de stockage existant, avec sa
 * propre signature brève.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { diagnosticSur } from '@/lib/autopilot/analyse/clip-extraction';
import { lirePlanParId } from '@/lib/autopilot/analyse/montage-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Une lecture indexée. Rien de plus. */
export const maxDuration = 15;

const SOCLE_ABSENT = 'La table des plans de montage n’existe pas encore sur ce serveur.';

export async function GET(
  _req: NextRequest, { params }: { params: { montagePlanId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!identifiantValide(params.montagePlanId)) {
      return NextResponse.json(
        { ok: false, error: 'Identifiant invalide.', motif: 'identifiant_invalide' },
        { status: 422 },
      );
    }

    const { plan, motif } = await lirePlanParId(session.user.id, params.montagePlanId);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    if (!plan) {
      return NextResponse.json({ ok: false, error: 'Plan introuvable' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, plan }, {
      // Un plan porte des clés de stockage : il ne se met pas en cache.
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e: unknown) {
    console.error(
      `[autopilote][montage] panne inattendue : ${diagnosticSur(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
