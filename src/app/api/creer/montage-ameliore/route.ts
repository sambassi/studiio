import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { montageAmelioreActifPourCompte } from '@/lib/creer/montage-ameliore-config';

/**
 * Le MONTAGE AMÉLIORÉ est-il proposé à ce compte ? (Créer : plan calculé dans le navigateur.)
 * Vrai seulement si session ET interrupteur serveur ET compte administrateur relu en base
 * (`montage-ameliore-config.ts`). Toute erreur ⇒ `false` (production). Aucun corps ni paramètre
 * n'est lu. Réponse : `{ ameliore }` seule, jamais mise en cache. N'autorise que le calcul du
 * plan : elle ne touche ni crédits, ni paiement, ni rendu.
 */
export const dynamic = 'force-dynamic';

const repondre = (ameliore: boolean) =>
  NextResponse.json({ ameliore }, { headers: { 'Cache-Control': 'private, no-store' } });

export async function GET() {
  try {
    const session = await auth();
    return repondre(await montageAmelioreActifPourCompte(session?.user?.id));
  } catch {
    return repondre(false);
  }
}
