/**
 * GET /api/pawapay/status/[id] — CHEMIN NORMAL de confirmation d'un dépôt.
 *
 * L'interface l'interroge au retour de la page de paiement (et à intervalles
 * tant que le résultat est `pending`). La route relit le dépôt directement
 * chez PawaPay (`GET /v2/deposits/{id}`) et appelle `confirmerDepot`, le même
 * code que le rattrapage et le callback facultatif.
 *
 * Réservée au propriétaire du dépôt : tout autre cas répond 404, sans dire si
 * le dépôt existe.
 *
 * Réponse : `{ status: 'pending' | 'credited' | 'failed' }`.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { estDepositIdValide, lireDepot } from '@/lib/payment/pawapay/client';
import { confirmerDepot } from '@/lib/payment/pawapay/confirmation';
import { obtenirDependances } from '@/lib/payment/pawapay/store';
import type { IssueConfirmation } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

type StatutInterface = 'pending' | 'credited' | 'failed';

function versInterface(issue: IssueConfirmation): StatutInterface {
  if (issue === 'credite' || issue === 'deja_credite') return 'credited';
  if (issue === 'echec') return 'failed';
  // en_attente, introuvable, montant/devise invalides (examen manuel) :
  // rien n'est accordé, l'interface continue d'attendre.
  return 'pending';
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deps = obtenirDependances();
  if (!deps) return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });

  const depositId = params?.id;
  if (!estDepositIdValide(depositId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const local = await deps.store.lire(depositId);
    if (!local || local.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (local.statut === 'credite') return NextResponse.json({ status: 'credited' });
    if (local.statut === 'echec') return NextResponse.json({ status: 'failed' });

    const { issue } = await confirmerDepot(depositId, {
      store: deps.store,
      crediter: deps.crediter,
      lireDepotDistant: lireDepot,
    });
    if (issue === 'montant_invalide' || issue === 'devise_invalide') {
      console.error(`[PAWAPAY_STATUT] ${issue} pour ${depositId} — aucun crédit, examen manuel`);
    }
    return NextResponse.json({ status: versInterface(issue) });
  } catch (e) {
    // Relecture ou persistance en échec : l'interface réessaiera. Jamais un
    // « pending » qui masquerait une panne.
    console.error(`[PAWAPAY_STATUT] Vérification impossible (${depositId}) :`, (e as Error)?.message);
    return NextResponse.json({ error: 'Vérification impossible, réessayez' }, { status: 502 });
  }
}
