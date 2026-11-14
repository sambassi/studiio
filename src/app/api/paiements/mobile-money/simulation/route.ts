import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { fournisseurSimule } from '@/lib/paiements/pawapay/client';
import { poserIssuePersistante } from '@/lib/paiements/pawapay/simulateur-persistant';
import { lireDepotLocal } from '@/lib/paiements/pawapay/depots';
import type { StatutDepot } from '@/lib/paiements/pawapay/contrat';

/**
 * CHOISIR L'ISSUE D'UN PAIEMENT SIMULÉ — prévisualisation uniquement.
 *
 * ⚠️ REFUSÉE (404) dès que le prestataire n'est pas simulé : hors
 * simulation, cette adresse n'existe pas. Elle ne peut donc pas servir à
 * forcer un crédit sur un paiement réel — et de toute façon elle ne crédite
 * rien : elle ne fait que poser, EN MÉMOIRE, ce que le double répondra à la
 * prochaine relecture. Le crédit reste soumis à la même vérification.
 */
export const dynamic = 'force-dynamic';

const ISSUES: readonly StatutDepot[] = ['reussi', 'echoue', 'expire', 'annule', 'en_attente'];

export async function POST(req: NextRequest) {
  if (!fournisseurSimule()) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const corps = (await req.json().catch(() => null)) as {
    depot?: unknown; issue?: unknown; montant?: unknown; devise?: unknown; retard?: unknown;
  } | null;
  const depositId = typeof corps?.depot === 'string' ? corps.depot : '';
  const issue = ISSUES.find((i) => i === corps?.issue);
  if (!depositId || !issue) {
    return NextResponse.json({ success: false, error: 'Dépôt ou issue invalide.' }, { status: 400 });
  }

  // Même en simulation, on ne touche qu'à SES propres dépôts.
  const depot = await lireDepotLocal(depositId).catch(() => null);
  if (!depot || depot.user_id !== session.user.id) {
    return NextResponse.json({ success: false, error: 'Paiement introuvable.' }, { status: 404 });
  }

  try {
    await poserIssuePersistante(depositId, {
      statut: issue,
      montant: typeof corps?.montant === 'number' ? corps.montant : undefined,
      devise: typeof corps?.devise === 'string' ? corps.devise.toUpperCase() : undefined,
      retard: typeof corps?.retard === 'number' ? corps.retard : 0,
    });
  } catch (e) {
    console.error('[mobile money] issue simulée non posée :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'L’issue n’a pas pu être posée.' }, { status: 503 });
  }
  return NextResponse.json({ success: true, depot: depositId, issue });
}
