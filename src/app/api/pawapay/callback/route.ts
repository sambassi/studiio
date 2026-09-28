/**
 * POST /api/pawapay/callback — callback PawaPay PROPRE À STUDIIO.
 *
 * PawaPay POSTe ici l'état final d'un dépôt (URL déclarée dans le tableau de
 * bord du compte PawaPay de Studiio). Le corps n'est JAMAIS cru sur parole :
 * on n'en extrait que le `depositId`, on relit le dépôt chez PawaPay, puis
 * `confirmerDepot` décide.
 *
 * Codes de réponse (PawaPay rejoue pendant 15 min tant qu'il n'a pas de 200) :
 * - 404 : PawaPay désactivé et persistance absente ;
 * - 503 : PawaPay activé mais persistance absente (table non migrée), ou
 *         dépôt pas encore final à la relecture → rejeu souhaité ;
 * - 400 : `depositId` absent ou invalide ;
 * - 502 : relecture PawaPay impossible → rejeu ;
 * - 500 : erreur de persistance ou de crédit → rejeu ;
 * - 200 : issue définitive (crédité, déjà crédité, échec, inconnu…).
 */
import { NextResponse } from 'next/server';
import { confirmerDepot } from '@/lib/payment/pawapay/confirmation';
import { estDepositIdValide, lireDepot } from '@/lib/payment/pawapay/client';
import { obtenirCrediteur, obtenirStore } from '@/lib/payment/pawapay/store';
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
  const actif = process.env.PAWAPAY_ENABLED === 'true';
  const store = obtenirStore();
  const crediter = obtenirCrediteur();
  if (!store || !crediter) {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: actif ? 503 : 404 },
    );
  }

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
      store,
      crediter,
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
