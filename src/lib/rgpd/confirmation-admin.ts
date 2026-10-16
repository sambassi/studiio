/**
 * Confirmation FORTE d'une suppression définitive par un administrateur.
 *
 * Partagé par l'interface (`/admin/users`) et la route `DELETE
 * /api/admin/users/[id]` : la route refuse (400, rien supprimé) tout corps
 * qui ne porte pas EXACTEMENT la phrase ET le même identifiant que l'URL.
 * Protège d'un appel accidentel ou scripté (DELETE nu, id d'une autre ligne).
 *
 * Module sans dépendance : importable côté client.
 */
export const PHRASE_SUPPRESSION_ADMIN = 'SUPPRIMER DÉFINITIVEMENT';

/** Comparaison STRICTE : casse, accents et espaces comptent. */
export function confirmationSuppressionAdminValide(corps: unknown, idUrl: string): boolean {
  if (!corps || typeof corps !== 'object') return false;
  const c = corps as { confirmation?: unknown; userId?: unknown };
  return c.confirmation === PHRASE_SUPPRESSION_ADMIN
    && typeof c.userId === 'string'
    && c.userId === idUrl;
}

/**
 * Ce que l'interface accepte comme saisie : la même phrase. Seule la forme
 * Unicode est ramenée à NFC (un « É » tapé en deux points de code reste un
 * « É ») ; la casse et les espaces ne sont PAS tolérés.
 */
export function saisieConfirmationValide(saisie: string): boolean {
  return saisie.normalize('NFC') === PHRASE_SUPPRESSION_ADMIN;
}
