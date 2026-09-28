/**
 * Branchement de la persistance PawaPay de Studiio.
 *
 * TODO(migration pawapay_deposits) : la table `pawapay_deposits` et la RPC
 * atomique de crédit n'existent pas encore. Tant qu'elles ne sont pas
 * créées (migration soumise à validation), ces fonctions renvoient `null` et
 * la route de callback refuse de traiter quoi que ce soit (503 si PawaPay est
 * activé, 404 sinon). Aucun crédit ne peut donc être accordé par ce chemin.
 */
import type { Crediteur, DepotsStore } from './types';

export function obtenirStore(): DepotsStore | null {
  return null;
}

export function obtenirCrediteur(): Crediteur | null {
  return null;
}
