import { NextResponse } from 'next/server';

/**
 * Route retirée.
 *
 * Elle ouvrait un checkout Stripe au montant libre fourni par le navigateur
 * (`price_data` fabriqué à la volée), sans `metadata` : le webhook ne
 * pouvait pas créditer — le client payait et ne recevait rien. Aucun écran
 * ne l'appelle ; l'achat de crédits passe par `/api/credits/purchase-pack`,
 * dont les prix sont fixés côté Stripe (CHF).
 */
function retiree() {
  return NextResponse.json(
    { success: false, error: 'Route retirée : utiliser /api/credits/purchase-pack', replacement: '/api/credits/purchase-pack' },
    { status: 410 },
  );
}

export async function POST(): Promise<NextResponse> {
  return retiree();
}
