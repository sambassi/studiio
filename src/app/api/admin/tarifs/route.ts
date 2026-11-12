import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  ecrireTarifs, invaliderTarifs, lireHistoriqueTarifs, lireTarifs, validerModification,
  type ModificationTarifs,
} from '@/lib/tarifs/serveur';
import { CATALOGUE_TARIFS, TARIFS_GRATUITS, TARIF_MAX } from '@/lib/tarifs/catalogue';
import { analyserGrille, resumeRentabilite } from '@/lib/tarifs/rentabilite';
import { libelleTaux, tauxPerime } from '@/lib/tarifs/change';

/**
 * Tarifs & crédits — `GET / PUT /api/admin/tarifs`, ADMINISTRATEURS SEULEMENT.
 *
 * La garde est ICI, côté serveur (`requireAdmin` → 401/403) : masquer le
 * bouton ne suffit pas. Un PUT validé s'applique à la requête suivante
 * (cache vidé), sans redéploiement, et chaque changement va à `audit_log`.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  invaliderTarifs();
  const [config, historique] = await Promise.all([lireTarifs(), lireHistoriqueTarifs()]);
  return NextResponse.json({
    success: true,
    catalogue: CATALOGUE_TARIFS,
    gratuits: TARIFS_GRATUITS,
    max: TARIF_MAX,
    ...config,
    historique,
    ...rentabilite(config),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const corps = (await req.json().catch(() => null)) as ModificationTarifs | null;
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
    return NextResponse.json({ success: false, error: 'Corps invalide' }, { status: 400 });
  }
  const m: ModificationTarifs = {
    prix: corps.prix,
    valeurCreditChf: corps.valeurCreditChf,
    coutsFournisseur: corps.coutsFournisseur,
    change: corps.change,
  };
  const erreurs = validerModification(m);
  if (erreurs.length) return NextResponse.json({ success: false, error: 'Tarifs invalides', erreurs }, { status: 400 });
  try {
    const changements = await ecrireTarifs(m, session!.user!.email!);
    const config = await lireTarifs();
    return NextResponse.json({ success: true, changements, ...config, ...rentabilite(config) });
  } catch (e) {
    console.error('[admin/tarifs] écriture :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Les tarifs n’ont pas pu être enregistrés.' }, { status: 503 });
  }
}

/**
 * La rentabilité de la grille, telle que l'administration la voit : une ligne
 * par tarif, le résumé des pertes, et l'état du taux de change. Jamais
 * exposée hors `/api/admin/*`.
 */
function rentabilite(config: Awaited<ReturnType<typeof lireTarifs>>) {
  const lignes = analyserGrille({
    prix: config.prix,
    valeurCreditChf: config.valeurCreditChf,
    coutsFournisseur: config.coutsFournisseur,
    tauxChfParUsd: config.change?.chfParUsd ?? null,
  });
  return {
    rentabilite: lignes,
    resumeRentabilite: resumeRentabilite(lignes),
    changeLibelle: libelleTaux(config.change),
    changePerime: tauxPerime(config.change),
  };
}
