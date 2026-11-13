import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { depotsEnAttente, SocleAbsent, MESSAGE_SOCLE_ABSENT } from '@/lib/paiements/pawapay/depots';
import { reconcilier } from '@/lib/paiements/pawapay/confirmation';
import { lecteurEtat } from '@/lib/paiements/pawapay/lecteur';

/**
 * RÉCONCILIATION — `POST /api/admin/paiements/mobile-money/reconciliation`.
 *
 * Le FILET qui rend le crédit indépendant de la notification. Il repasse sur
 * les dépôts encore ouverts, relit chacun auprès du prestataire, et crédite
 * ceux qui sont confirmés — exactement une fois.
 *
 * C'est ce qui fait qu'une panne de l'application qui héberge l'adresse de
 * notification du compte marchand RETARDE un crédit sans jamais le perdre.
 *
 * Déclenchée à la main depuis l'administration. Elle peut être appelée aussi
 * souvent qu'on veut : elle est idempotente par construction.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const ouverts = await depotsEnAttente(50);
    const bilan = await reconcilier(ouverts, lecteurEtat());
    console.info('[mobile money] réconciliation', bilan);
    return NextResponse.json({ success: true, bilan });
  } catch (e) {
    if (e instanceof SocleAbsent) {
      return NextResponse.json({ success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT }, { status: 503 });
    }
    console.error('[mobile money] réconciliation impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'La réconciliation n’a pas pu être lancée.' }, { status: 503 });
  }
}
