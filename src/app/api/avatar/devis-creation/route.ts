/**
 * GET /api/avatar/devis-creation?type=video|photo — AVANT d'envoyer la source
 * d'un nouvel avatar / d'une nouvelle version : un compte admin (0 crédit
 * Studiio) reçoit 428 + le devis fournisseur (création HeyGen : montant non
 * publié) et l'avatar déjà utilisable ; tout autre compte reçoit
 * `confirmationRequise: false`. Aucune écriture, aucun fournisseur.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';
import { devisCreationPourCompte } from '@/lib/fournisseurs/devis-creation-avatar';
import { reponseConfirmationCout } from '@/lib/fournisseurs/confirmation-cout';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const type = req.nextUrl.searchParams.get('type') === 'video' ? 'video' : 'photo';
  if (!(await compteExempteDeCredits(session.user.id))) {
    return NextResponse.json({ success: true, data: { confirmationRequise: false } });
  }
  const { devis, contexte } = await devisCreationPourCompte(session.user.id, type);
  return reponseConfirmationCout(devis, { ...contexte });
}
