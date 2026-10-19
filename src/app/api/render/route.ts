import { NextResponse } from 'next/server';

/**
 * POST /api/render — ANCIENNE route de rendu Remotion, FERMÉE (410 Gone).
 *
 * Elle débitait en « lu-puis-écrit » (`credits: user.credits - cout`, sans
 * condition), remboursait en réécrivant l'ANCIEN solde, et lançait un rendu
 * Remotion sans plafond de concurrence — joignable par tout compte connecté.
 * Aucun écran, aucun script, aucun service ne l'appelle (inventaire PR-A) :
 * le rendu facturé passe par `/api/render/jobs` (réserver → confirmer).
 *
 * ⚠️ La réponse part AVANT toute session, lecture du corps, base, stockage ou
 * Remotion : ce module n'importe volontairement RIEN d'autre que `next/server`.
 * Aucun débit, aucun remboursement, aucun job, aucun rendu.
 */
function fermee() {
  return NextResponse.json(
    { success: false, error: 'Route retirée : utilisez /api/render/jobs.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST() {
  return fermee();
}
