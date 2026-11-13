import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { etatMobileMoney, VARIABLES_ATTENDUES } from '@/lib/paiements/mobile-money';
import { enProduction, fournisseurSimule, paysDisponibles } from '@/lib/paiements/pawapay/client';
import { tousLesDepots, SocleAbsent } from '@/lib/paiements/pawapay/depots';
import { lireTarifs } from '@/lib/tarifs/serveur';

/**
 * ÉTAT DU PAIEMENT MOBILE — `GET /api/admin/paiements/mobile-money`.
 * ADMINISTRATEURS SEULEMENT.
 *
 * ⚠️ AUCUNE CLÉ NE SORT D'ICI. On dit si un jeton est PRÉSENT, jamais sa
 * valeur, jamais ses derniers caractères. Les noms des variables attendues
 * sont rendus pour que l'administration sache quoi configurer ; leurs
 * valeurs, non.
 *
 * Les pays viennent du COMPTE MARCHAND, pas d'une liste codée : une liste
 * figée divergerait du compte sans prévenir, et un pays retiré chez le
 * prestataire resterait proposé jusqu'à l'échec du paiement.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const etat = etatMobileMoney();
  const simule = fournisseurSimule();

  const pays = await (async () => {
    if (!etat.actif || simule) return { liste: [], motif: simule ? 'prestataire simulé' : etat.message };
    try {
      return { liste: await paysDisponibles(), motif: null };
    } catch (e) {
      console.error('[admin/mobile-money] pays illisibles :', e instanceof Error ? e.message : e);
      return { liste: [], motif: 'compte marchand injoignable' };
    }
  })();

  const depots = await (async () => {
    try {
      return { liste: await tousLesDepots(100), socle: true };
    } catch (e) {
      if (e instanceof SocleAbsent) return { liste: [], socle: false };
      console.error('[admin/mobile-money] dépôts illisibles :', e instanceof Error ? e.message : e);
      return { liste: [], socle: true };
    }
  })();

  const config = await lireTarifs();

  return NextResponse.json({
    success: true,
    actif: etat.actif,
    motif: etat.motif,
    message: etat.message,
    sandbox: !enProduction(),
    simule,
    // Présence seulement. Jamais la valeur.
    jetonPresent: !!(process.env.MOBILE_MONEY_API_TOKEN || '').trim(),
    rappelConfigure: !!(process.env.MOBILE_MONEY_CALLBACK_URL || '').trim(),
    variablesAttendues: VARIABLES_ATTENDUES,
    paysDisponibles: pays.liste,
    paysMotif: pays.motif,
    socleApplique: depots.socle,
    depots: depots.liste,
    // Le taux qui sert à convertir : sans lui, aucun paiement n'est ouvrable.
    change: config.changeEur,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
