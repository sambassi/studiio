import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  depotsAbandonnesARelire, depotsEnAttente, SocleAbsent, MESSAGE_SOCLE_ABSENT,
} from '@/lib/paiements/pawapay/depots';
import { confirmerDepot, reconcilier } from '@/lib/paiements/pawapay/confirmation';
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

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const corps = (await req.json().catch(() => null)) as { depot?: unknown } | null;
  const unSeul = typeof corps?.depot === 'string' ? corps.depot.trim() : '';

  try {
    const lire = lecteurEtat();

    /*
      RELECTURE D'UN SEUL PAIEMENT, SUR DEMANDE.

      Les deux passes automatiques ci-dessous sont bornées — en nombre, et
      dans le temps : au-delà de trente jours un dossier n'est plus repêché
      tout seul. Sans cette porte-ci, un paiement que le prestataire
      confirmerait après ce délai, et dont la notification ne nous serait
      jamais parvenue, resterait encaissé sans crédit, sans aucun moyen de le
      récupérer. C'est le dernier recours, et il est volontairement manuel.

      Il ne contourne AUCUNE garantie : il passe par le même `confirmerDepot`
      que tout le reste. Le prestataire reste seul juge du paiement, le
      montant et la devise sont vérifiés, et l'index unique interdit le
      second crédit. Réservé à l'administration, et journalisé.
    */
    if (unSeul) {
      const r = await confirmerDepot(unSeul, lire);
      console.info('[mobile money] relecture administrateur', { depot: unSeul, issue: r.issue });
      return NextResponse.json({ success: true, depot: unSeul, resultat: r });
    }

    // 1. LA FILE PRINCIPALE. Les dépôts ouverts, les moins récemment relus
    //    d'abord. Ceux qui dépassent la borne y sont fermés — mais seulement
    //    après que le prestataire a confirmé qu'ils sont toujours en attente.
    const ouverts = await depotsEnAttente(50);
    const bilan = await reconcilier(ouverts, lire);

    // 2. LA SECONDE CHANCE. Fermer un dépôt le sort de la file principale ;
    //    sans cette passe il n'y reviendrait jamais, et un paiement confirmé
    //    tardivement — après que nous avons cessé d'attendre — serait encaissé
    //    sans être crédité. Elle est petite et sans fin : ces dépôts tournent
    //    eux aussi, les moins récemment relus d'abord.
    const rattrapage = await reconcilier(
      await depotsAbandonnesARelire(10), lire, { fermerLesAbandonnes: false },
    );

    const total = { ...bilan, rattrapage };
    console.info('[mobile money] réconciliation', total);
    return NextResponse.json({ success: true, bilan: total });
  } catch (e) {
    if (e instanceof SocleAbsent) {
      return NextResponse.json({ success: false, code: 'socle_absent', error: MESSAGE_SOCLE_ABSENT }, { status: 503 });
    }
    console.error('[mobile money] réconciliation impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'La réconciliation n’a pas pu être lancée.' }, { status: 503 });
  }
}
