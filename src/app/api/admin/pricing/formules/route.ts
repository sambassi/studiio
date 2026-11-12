import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { analyserFormulesProposees } from '@/lib/stripe/formules-proposees';

/**
 * FORMULES PROPOSÉES — `GET /api/admin/pricing/formules`, ADMIN SEULEMENT.
 *
 * Rend la grille visée (12,90 / 34,90 / 69,90 CHF) confrontée à la valeur du
 * crédit configurée. Lecture seule : rien n'est mis en vente ici. Réservée à
 * l'administration parce qu'elle expose la valeur interne du crédit, qui
 * n'est pas une information client.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const config = await lireTarifs();
  return NextResponse.json(
    { success: true, valeurCreditChf: config.valeurCreditChf, formules: analyserFormulesProposees(config.valeurCreditChf) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
