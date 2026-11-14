import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { offrePack, offrePlan } from '@/lib/stripe/prix';
import { CREDIT_PACKAGES } from '@/lib/stripe/constants';
import { PLANS_PAYANTS } from '@/lib/billing/plan-choisi';
import { annonceConversion, convertirChfVersCfa, estDeviseCfa } from '@/lib/paiements/cfa';

/**
 * PRIX D'UNE RECHARGE EN FRANC CFA — `POST /api/paiements/cfa/devis`.
 *
 * Rend ce qu'un pack coûte en XOF ou XAF, avec le taux utilisé et sa date.
 * Ne crée AUCUN paiement, n'appelle aucun prestataire, ne débite rien.
 *
 * Deux règles tenues ici :
 *
 *   - Le MONTANT NE VIENT JAMAIS DU NAVIGATEUR. Le prix est celui du pack en
 *     base (`credit_packs`, édité par l'administration) ; le corps de la
 *     requête ne porte que la clé du pack et la devise souhaitée.
 *   - Sans taux CHF → EUR enregistré, on REFUSE (409) au lieu d'afficher un
 *     prix qu'on ne saurait pas justifier.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Les deux offres passent par ici : une recharge (`pack`) ou un abonnement
  // (`plan`). Elles ne diffèrent que par la table où le prix est lu — le
  // montant ne vient jamais du navigateur, dans un cas comme dans l'autre.
  const corps = (await req.json().catch(() => null)) as {
    pack?: unknown; plan?: unknown; devise?: unknown;
  } | null;
  const pack = typeof corps?.pack === 'string' ? corps.pack : '';
  const plan = typeof corps?.plan === 'string' ? corps.plan : '';
  const packConnu = !!pack && Object.prototype.hasOwnProperty.call(CREDIT_PACKAGES, pack);
  const planConnu = !!plan && (PLANS_PAYANTS as readonly string[]).includes(plan);
  if (!packConnu && !planConnu) {
    return NextResponse.json({ success: false, error: 'Offre inconnue.' }, { status: 400 });
  }
  if (!estDeviseCfa(corps?.devise)) {
    return NextResponse.json({ success: false, error: 'Devise non prise en charge.' }, { status: 400 });
  }

  const [offre, config] = await Promise.all([
    planConnu
      ? offrePlan(plan as (typeof PLANS_PAYANTS)[number])
        .then((o) => ({ amount: o.credits, price_cents: o.price_cents }))
      : offrePack(pack as keyof typeof CREDIT_PACKAGES),
    lireTarifs(),
  ]);
  if (!(offre.amount > 0) || !(offre.price_cents > 0)) {
    console.error('[cfa/devis] offre invalide en base', planConnu ? plan : pack, offre);
    return NextResponse.json({ success: false, error: 'Offre indisponible : tarif à vérifier.' }, { status: 503 });
  }

  const r = convertirChfVersCfa({
    chfCentimes: offre.price_cents,
    devise: corps!.devise,
    tauxEurParChf: config.changeEur?.eurParChf ?? null,
    tauxLe: config.changeEur?.le ?? null,
  });
  if (!r.ok) {
    return NextResponse.json({ success: false, code: r.motif, error: r.message }, { status: 409 });
  }

  return NextResponse.json(
    {
      success: true,
      devis: {
        ...r.conversion,
        credits: offre.amount,
        annonce: annonceConversion(r.conversion, offre.amount),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
