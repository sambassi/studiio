/**
 * Prix d'une génération « Mon avatar » — quelle clé de la grille tarifaire
 * centrale s'applique. Module PUR : la route (`/api/avatar/generate`) et
 * l'écran (`/dashboard/avatar`) en tirent la même clé, le serveur seul lit le
 * montant au moment de débiter.
 *
 *   Standard → avatar.avatar_iii   Qualité → avatar.avatar_iv
 *   Premium  → avatar.avatar_v     Voix clonée (moteur du jumeau) → avatar.jumeau
 *
 * ⚠️ SANS QUALITÉ DEMANDÉE, LE MOTEUR N'EST PAS TRANSMIS À HEYGEN, dont le
 * défaut documenté est Avatar IV (voir `lib/avatar/moteurs.ts`, « Sans
 * `engine`, HeyGen prend Avatar IV ») : c'est donc Avatar IV qui est
 * facturé. Sans configuration admin, les quatre clés valent 40 — le prix
 * d'avant, inchangé.
 */
import { CLE_MOTEUR_AVATAR, type CleTarif } from '@/lib/tarifs/catalogue';
import { MOTEUR_PAR_QUALITE, estQualite, type MoteurAvatar } from '@/lib/avatar/moteurs';

// Pas d'import de `lib/tarifs/client` ('use client') : ce module est aussi lu par la route.
const libelleCredits = (n: number) => `${n} crédit${n > 1 ? 's' : ''}`;

/** Le moteur effectivement utilisé par HeyGen quand aucun n'est transmis. */
export const MOTEUR_HEYGEN_SANS_QUALITE: MoteurAvatar = 'avatar_iv';

/** Clé tarifaire d'un moteur ; `null` = aucun moteur transmis (défaut HeyGen). */
export function cleTarifMoteurAvatar(moteur: MoteurAvatar | null | undefined): CleTarif {
  return CLE_MOTEUR_AVATAR[moteur ?? MOTEUR_HEYGEN_SANS_QUALITE];
}

/**
 * La clé que l'écran Mon avatar annonce : voix clonée → tarif du jumeau ;
 * sinon la qualité ENVOYÉE (absente → Avatar IV, défaut HeyGen).
 */
export function cleTarifEcranMonAvatar(args: { viaVoixClonee: boolean; qualiteEnvoyee?: unknown }): CleTarif {
  if (args.viaVoixClonee) return 'avatar.jumeau';
  return estQualite(args.qualiteEnvoyee)
    ? cleTarifMoteurAvatar(MOTEUR_PAR_QUALITE[args.qualiteEnvoyee])
    : cleTarifMoteurAvatar(null);
}

/** Libellé du bouton « Générer la vidéo » ; un administrateur voit le prix public et son coût 0. */
export function libelleBoutonGenererAvatar(prix: number, exempte: boolean): string {
  return exempte
    ? `Générer la vidéo — prix public ${libelleCredits(prix)} · votre coût : 0`
    : `Générer la vidéo (${libelleCredits(prix)})`;
}
