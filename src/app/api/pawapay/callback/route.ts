/**
 * POST /api/pawapay/callback — déclencheur FACULTATIF, propre à Studiio.
 *
 * Le compte PawaPay est partagé et son URL de callback pointe vers un autre
 * site : Studiio n'en dépend PAS. Ses paiements sont confirmés par
 * interrogation directe (`/api/pawapay/status/[id]`) et par le rattrapage
 * (`/api/cron/pawapay-reconcile`). Cette route n'existe que pour qu'un appel
 * reçu, quelle qu'en soit l'origine, déclenche la MÊME confirmation — sans
 * jamais croire le corps : on n'en extrait que le `depositId`, on relit le
 * dépôt chez PawaPay, puis `confirmerDepot` décide. Un dépôt inconnu de
 * Studiio n'entraîne aucune relecture.
 *
 * Codes de réponse :
 * - 404 : PawaPay désactivé (`PAWAPAY_ENABLED` ≠ "true") ;
 * - 503 : persistance absente (table non migrée), ou
 *         dépôt pas encore final à la relecture ;
 * - 400 : `depositId` absent ou invalide ;
 * - 502 : relecture PawaPay impossible ;
 * - 500 : erreur de persistance ou de crédit ;
 * - 200 : issue définitive (crédité, déjà crédité, échec, inconnu…).
 */
import { NextResponse } from 'next/server';
import { confirmerDepot } from '@/lib/payment/pawapay/confirmation';
import { estDepositIdValide, lireDepot } from '@/lib/payment/pawapay/client';
import { obtenirDependances, pawapayActif } from '@/lib/payment/pawapay/store';
import { PawapayErreur } from '@/lib/payment/pawapay/types';

export const dynamic = 'force-dynamic';

function extraireDepositId(corps: unknown): unknown {
  if (typeof corps !== 'object' || corps === null) return undefined;
  const c = corps as Record<string, unknown>;
  if (c.depositId !== undefined) return c.depositId;
  const data = c.data;
  if (typeof data === 'object' && data !== null) return (data as Record<string, unknown>).depositId;
  return undefined;
}

export async function POST(req: Request) {
  // Interrupteur global : désactivé → 404, quel que soit l'état du store.
  if (!pawapayActif()) return NextResponse.json({ status: 'unavailable' }, { status: 404 });
  const deps = obtenirDependances();
  if (!deps) return NextResponse.json({ status: 'unavailable' }, { status: 503 });

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ status: 'invalid', message: 'JSON invalide' }, { status: 400 });
  }
  const depositId = extraireDepositId(corps);
  if (!estDepositIdValide(depositId)) {
    return NextResponse.json({ status: 'invalid', message: 'depositId invalide' }, { status: 400 });
  }

  try {
    const { issue } = await confirmerDepot(depositId, {
      store: deps.store,
      lireDepotDistant: lireDepot,
    });
    if (issue === 'en_attente') {
      // Callback reçu mais la relecture ne voit pas encore d'état final :
      // on demande à PawaPay de rejouer plutôt que de perdre la notification.
      return NextResponse.json({ status: 'pending', depositId }, { status: 503 });
    }
    if (issue === 'montant_invalide' || issue === 'devise_invalide') {
      console.error(`[PAWAPAY_CALLBACK] ${issue} pour ${depositId} — aucun crédit, examen manuel`);
    }
    return NextResponse.json({ status: issue, depositId }, { status: 200 });
  } catch (e) {
    if (e instanceof PawapayErreur) {
      console.error(`[PAWAPAY_CALLBACK] Relecture impossible (${depositId}) : ${e.message}`);
      return NextResponse.json({ status: 'error', message: 'Relecture PawaPay impossible' }, { status: 502 });
    }
    console.error(`[PAWAPAY_CALLBACK] Erreur interne (${depositId}) :`, e);
    return NextResponse.json({ status: 'error', message: 'Erreur interne' }, { status: 500 });
  }
}
