import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';

/**
 * Les prix PUBLICS en vigueur — `GET /api/tarifs`.
 *
 * Les écrans affichent ce que les routes débitent : même grille, même cache.
 * `exempte` dit au seul compte de la session qu'il ne paie pas (admin) : le
 * prix public reste affiché, son coût Studiio est 0. Ni coût fournisseur ni
 * valeur du crédit ici — c'est la page admin qui les montre.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const [config, exempte] = await Promise.all([lireTarifs(), compteExempteDeCredits(userId)]);
  return NextResponse.json(
    { success: true, prix: config.prix, exempte },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
