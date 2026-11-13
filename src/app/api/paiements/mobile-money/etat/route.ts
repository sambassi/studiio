import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { confirmerDepot } from '@/lib/paiements/pawapay/confirmation';
import { lecteurEtat } from '@/lib/paiements/pawapay/lecteur';
import { lireDepotLocal, SocleAbsent, MESSAGE_SOCLE_ABSENT } from '@/lib/paiements/pawapay/depots';

/**
 * ÉTAT D'UN PAIEMENT — `GET /api/paiements/mobile-money/etat?depot=...`.
 *
 * Appelée par la page de retour. ⚠️ LE RETOUR DU NAVIGATEUR NE CRÉDITE
 * RIEN : cette route déclenche la MÊME vérification que la notification —
 * relecture auprès du prestataire, puis crédit idempotent si et seulement si
 * le paiement est confirmé au bon montant. Revenir sans avoir payé ne donne
 * donc rien, et revenir deux fois ne donne pas deux fois.
 *
 * Un dépôt qui n'appartient pas à l'appelant n'est pas consultable : son
 * identifiant est un UUID, mais on ne s'en remet pas à l'imprévisibilité.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const depositId = new URL(req.url).searchParams.get('depot') ?? '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(depositId)) {
    return NextResponse.json({ success: false, error: 'Référence invalide.' }, { status: 400 });
  }

  try {
    const depot = await lireDepotLocal(depositId);
    if (!depot || depot.user_id !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Paiement introuvable.' }, { status: 404 });
    }

    const r = await confirmerDepot(depositId, lecteurEtat());
    const apres = await lireDepotLocal(depositId);
    return NextResponse.json({
      success: true,
      issue: r.issue,
      statut: apres?.statut ?? depot.statut,
      credits: depot.credits,
      montant: Number(depot.montant_local),
      devise: depot.devise,
      creditLe: apres?.credite_le ?? null,
      message: r.issue === 'refuse' ? r.message : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof SocleAbsent) {
      return NextResponse.json({ success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT }, { status: 503 });
    }
    console.error('[mobile money] état illisible :', e instanceof Error ? e.message : e);
    return NextResponse.json({
      success: false,
      error: 'L’état du paiement n’a pas pu être lu. Il sera vérifié automatiquement, aucun crédit n’est perdu.',
    }, { status: 503 });
  }
}
