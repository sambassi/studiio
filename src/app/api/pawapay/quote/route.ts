/**
 * GET /api/pawapay/quote?pack=<pack>&pays=<ISO3>[&devise=<ISO>] — devis
 * Mobile Money, sans rien enregistrer.
 *
 * Le montant sort de `calculerDevis`, le MÊME code que l'initiation
 * (`/api/pawapay/deposit`) : le prix affiché est exactement le prix encaissé.
 * Aucun autre paramètre client (montant, prix, crédits, taux…) n'est lu.
 * `devise` ne sert qu'à choisir parmi les devises ouvertes d'un pays qui en a
 * plusieurs ; sans elle, un tel pays répond 400 avec la liste.
 *
 * Réponses : 401 sans session ; 503 si PawaPay est désactivé, ou si les taux
 * ou l'URL de l'application ne sont pas configurés ; 400 pack/pays/devise
 * invalides ; 502 si la configuration du compte PawaPay est illisible ;
 * 200 `{ pack, credits, prixChf, montant, devise }`. Ne nécessite pas le store.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { calculerDevis, urlDeBaseConfiguree } from '@/lib/payment/pawapay/devis';
import { pawapayActif } from '@/lib/payment/pawapay/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!pawapayActif() || !urlDeBaseConfiguree()) {
    return NextResponse.json({ error: 'Paiement Mobile Money indisponible' }, { status: 503 });
  }

  const params = new URL(req.url).searchParams;
  const resultat = await calculerDevis({
    pack: params.get('pack'),
    pays: params.get('pays'),
    devise: params.get('devise') ?? undefined,
  });
  if (!resultat.ok) {
    return NextResponse.json(
      { error: resultat.erreur, ...(resultat.devises ? { devises: resultat.devises } : {}) },
      { status: resultat.status },
    );
  }
  const { pack, credits, prixChf, montant, devise } = resultat.devis;
  return NextResponse.json({ pack, credits, prixChf, montant, devise });
}
