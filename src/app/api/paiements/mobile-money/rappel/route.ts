import { NextRequest, NextResponse } from 'next/server';
import { identifiantDeLaNotification } from '@/lib/paiements/pawapay/contrat';
import { confirmerDepot } from '@/lib/paiements/pawapay/confirmation';
import { lecteurEtat } from '@/lib/paiements/pawapay/lecteur';
import { SocleAbsent } from '@/lib/paiements/pawapay/depots';

/**
 * NOTIFICATION DU PRESTATAIRE — `POST /api/paiements/mobile-money/rappel`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ON FAIT DU CORPS REÇU : PRESQUE RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On en extrait UNIQUEMENT l'identifiant du dépôt. Statut, montant, devise :
 * tout est relu auprès du prestataire avec notre propre jeton. Une
 * notification n'est pas une preuve — cette adresse est publique, et
 * n'importe qui peut y poster un JSON.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI ON RÉPOND 200, MÊME QUAND ÇA SE PASSE MAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un 5xx fait réessayer le prestataire en boucle. Or la notification n'est
 * PAS ce qui garantit le crédit : la réconciliation repassera de toute
 * façon. Mieux vaut accuser réception et laisser le filet faire son travail
 * que déclencher une tempête de relivraisons.
 *
 * Un dépôt inconnu de notre journal appartient très probablement à une AUTRE
 * application partageant le même compte marchand. On répond `ignore` : on ne
 * le touche pas, et on ne prétend pas l'avoir traité.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const corps = await req.json().catch(() => null);
  const depositId = identifiantDeLaNotification(corps);

  if (!depositId) {
    console.warn('[mobile money] notification sans identifiant exploitable');
    return NextResponse.json({ statut: 'ignore', raison: 'identifiant absent' }, { status: 200 });
  }

  try {
    const r = await confirmerDepot(depositId, lecteurEtat());
    if (r.issue === 'depot_inconnu') {
      return NextResponse.json({ statut: 'ignore', raison: 'depot inconnu de cette application' }, { status: 200 });
    }
    console.info('[mobile money] notification traitée', { depositId, issue: r.issue });
    return NextResponse.json({ statut: 'traite', issue: r.issue }, { status: 200 });
  } catch (e) {
    // Y compris `SocleAbsent` : le dépôt reste en attente, la réconciliation
    // le reprendra une fois la migration appliquée.
    const detail = e instanceof SocleAbsent ? 'socle absent' : (e instanceof Error ? e.message : String(e));
    console.error('[mobile money] notification non traitée, reprise par la réconciliation', { depositId, detail });
    return NextResponse.json({ statut: 'differe' }, { status: 200 });
  }
}
