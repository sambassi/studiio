import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { etatMobileMoney } from '@/lib/paiements/mobile-money';
import { fournisseurSimule, paysDisponibles } from '@/lib/paiements/pawapay/client';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { estDeviseCfa } from '@/lib/paiements/cfa';

/**
 * LE PAIEMENT MOBILE EST-IL OUVERT ? — `GET /api/paiements/mobile-money/disponible`.
 *
 * L'écran n'affiche le moyen de paiement QUE si cette route le dit. Deux
 * conditions, et les deux sont nécessaires :
 *
 *   - le service est ouvert côté serveur (drapeau, jeton, adresse de rappel) ;
 *   - un taux CHF → EUR daté est enregistré, sans quoi aucun montant en
 *     franc CFA n'est justifiable et le paiement serait refusé après le clic.
 *
 * Les pays viennent du COMPTE MARCHAND, jamais d'une liste codée : proposer
 * un pays que le compte n'ouvre pas, c'est promettre un paiement qui
 * échouera. Aucune clé, aucun indice de configuration ne sort d'ici.
 */
export const dynamic = 'force-dynamic';

/** Noms français des pays, pour ne pas afficher un code à trois lettres. */
const NOMS_PAYS: Record<string, string> = {
  SEN: 'Sénégal', CIV: 'Côte d’Ivoire', CMR: 'Cameroun', BEN: 'Bénin', BFA: 'Burkina Faso',
  MLI: 'Mali', NER: 'Niger', TGO: 'Togo', GAB: 'Gabon', COG: 'Congo', TCD: 'Tchad',
  CAF: 'République centrafricaine', GNQ: 'Guinée équatoriale', GNB: 'Guinée-Bissau',
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const etat = etatMobileMoney();
  const config = await lireTarifs();
  const tauxPret = !!config.changeEur;

  if (!etat.actif) {
    return NextResponse.json({
      success: true, disponible: false, motif: etat.motif, message: etat.message, pays: [],
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!tauxPret) {
    return NextResponse.json({
      success: true, disponible: false, motif: 'taux_absent',
      message: 'Le paiement mobile n’est pas encore disponible.', pays: [],
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  // En simulation, on propose les deux zones franc CFA sans interroger
  // personne : il n'y a pas de compte marchand à consulter.
  const bruts = fournisseurSimule()
    ? [{ pays: 'SEN', devise: 'XOF' }, { pays: 'CMR', devise: 'XAF' }]
    : await paysDisponibles().catch((e) => {
      console.error('[mobile money] pays illisibles :', e instanceof Error ? e.message : e);
      return [] as Array<{ pays: string; devise: string }>;
    });

  // Seules les devises que Studiio sait convertir de façon vérifiable.
  const pays = bruts
    .filter((p) => estDeviseCfa(p.devise))
    .map((p) => ({ ...p, nom: NOMS_PAYS[p.pays] ?? p.pays }));

  return NextResponse.json({
    success: true,
    disponible: pays.length > 0,
    motif: pays.length > 0 ? null : 'aucun_pays',
    message: pays.length > 0 ? null : 'Aucun pays en franc CFA n’est ouvert sur ce compte.',
    simule: fournisseurSimule(),
    pays,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
