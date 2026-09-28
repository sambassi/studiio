/**
 * Branchement de la persistance PawaPay de Studiio.
 *
 * TODO(migration pawapay_deposits) : la table `pawapay_deposits` et la RPC
 * atomique de crédit n'existent pas encore. Tant qu'elles ne sont pas
 * créées (migration soumise à validation), ces fonctions renvoient `null` :
 * - l'initiation (`/api/pawapay/deposit`) répond 503 sans appeler PawaPay ;
 * - le statut (`/api/pawapay/status/[id]`) répond 503 ;
 * - le rattrapage (`/api/cron/pawapay-reconcile`) répond « désactivé » ;
 * - le callback facultatif répond 503 (activé) ou 404 (désactivé).
 * Aucun crédit ne peut donc être accordé.
 */
import type { TauxChf } from './tarifs';
import type { Crediteur, DepotsStore } from './types';

export function obtenirStore(): DepotsStore | null {
  return null;
}

export function obtenirCrediteur(): Crediteur | null {
  return null;
}

/**
 * Taux CHF → devise locale. TODO(source des taux) : table administrée ou
 * fournisseur, avec une règle de fraîcheur — décision à valider. Aucun taux
 * n'est figé dans le code ; `null` = initiation refusée (503).
 */
export async function obtenirTauxChf(): Promise<TauxChf | null> {
  return null;
}

/** Store + crédit, ou `null` si l'un manque : un seul point de décision. */
export function obtenirDependances(): { store: DepotsStore; crediter: Crediteur } | null {
  const store = obtenirStore();
  const crediter = obtenirCrediteur();
  return store && crediter ? { store, crediter } : null;
}
