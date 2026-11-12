import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { lireTarifs } from '@/lib/tarifs/serveur';
import {
  FORMULES_PROPOSEES, analyserFormulesProposees, margeAbonnement, type LigneCoutParCredit,
} from '@/lib/stripe/formules-proposees';
import { CATALOGUE_TARIFS } from '@/lib/tarifs/catalogue';
import { analyserGrille } from '@/lib/tarifs/rentabilite';

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

  // Le coût d'usage d'une formule se déduit de la GRILLE RÉELLE : à crédits
  // égaux, une opération peut coûter cent fois plus qu'une autre. On passe
  // donc les coûts par tarif, convertis en CHF avec le taux enregistré.
  const lignes = analyserGrille({
    prix: config.prix,
    valeurCreditChf: config.valeurCreditChf,
    coutsFournisseur: config.coutsFournisseur,
    tauxChfParUsd: config.change?.chfParUsd ?? null,
    margeCible: config.margeCible,
  });
  const libelle = new Map(CATALOGUE_TARIFS.map((e) => [e.cle as string, e.libelle]));
  const coutsParCredit: LigneCoutParCredit[] = lignes.map((l) => ({
    cle: l.cle,
    libelle: libelle.get(l.cle) ?? l.cle,
    prixCredits: l.prixCredits,
    coutChf: l.coutAdminChf !== null
      ? l.coutAdminChf
      : l.coutUsd !== null && config.change
        ? Math.round(l.coutUsd * config.change.chfParUsd * 10_000) / 10_000
        : null,
  }));

  return NextResponse.json(
    {
      success: true,
      valeurCreditChf: config.valeurCreditChf,
      formules: analyserFormulesProposees(config.valeurCreditChf),
      marges: FORMULES_PROPOSEES.map((f) => margeAbonnement(f, coutsParCredit)),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
