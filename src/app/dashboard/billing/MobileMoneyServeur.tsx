import { MobileMoneyPanel, type PackMobileMoney, type PaysMobileMoney } from '@/components/billing/MobileMoneyPanel';
import { pawapayConfigure, paysActifs } from '@/lib/payment/pawapay/client';
import { obtenirDependances, pawapayActif } from '@/lib/payment/pawapay/store';
import { PACKS_PAWAPAY } from '@/lib/payment/pawapay/tarifs';

/**
 * Préparation SERVEUR du panneau Mobile Money.
 *
 * Les packs (crédits, prix CHF) viennent de `PACKS_PAWAPAY` et les pays de
 * `/v2/active-conf` (cache 5 min côté serveur) : le navigateur ne reçoit que
 * des valeurs prêtes à afficher, il ne calcule rien.
 *
 * Le montant en devise locale n'est PAS fourni avant le paiement : aucune
 * route de devis n'existe encore (à ajouter : `GET /api/pawapay/quote`).
 */

/** Libellés français des pays PawaPay (ISO alpha-3). Affichage seulement. */
const NOMS_PAYS: Readonly<Record<string, string>> = {
  BEN: 'Bénin', BFA: 'Burkina Faso', CIV: "Côte d'Ivoire", CMR: 'Cameroun',
  COD: 'RD Congo', COG: 'Congo', GAB: 'Gabon', GHA: 'Ghana', KEN: 'Kenya',
  MOZ: 'Mozambique', MWI: 'Malawi', NGA: 'Nigeria', RWA: 'Rwanda',
  SEN: 'Sénégal', SLE: 'Sierra Leone', TZA: 'Tanzanie', UGA: 'Ouganda',
  ZMB: 'Zambie', MLI: 'Mali', TGO: 'Togo', ETH: 'Éthiopie', LSO: 'Lesotho',
};

function packsAffichables(): PackMobileMoney[] {
  return Object.values(PACKS_PAWAPAY).map((p) => ({
    id: p.id,
    credits: p.credits,
    prixChf: (p.prixCentimesChf / 100).toFixed(2),
  }));
}

export async function MobileMoneyServeur({ depositRetour }: { depositRetour: string | null }) {
  let disponible = pawapayActif() && pawapayConfigure() && obtenirDependances() !== null;
  let pays: PaysMobileMoney[] = [];
  if (disponible) {
    try {
      pays = (await paysActifs()).map((p) => ({ code: p.pays, nom: NOMS_PAYS[p.pays] ?? p.pays }));
    } catch (e) {
      console.error('[PAWAPAY_UI] Pays actifs illisibles :', (e as Error)?.message);
    }
    if (pays.length === 0) disponible = false;
  }
  return (
    <div className="max-w-lg mx-auto py-8">
      <MobileMoneyPanel
        disponible={disponible}
        packs={packsAffichables()}
        pays={pays}
        depositRetour={depositRetour}
      />
    </div>
  );
}
