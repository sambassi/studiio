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
import { analyserTauxChf, type TauxChf } from './tarifs';
import type { Crediteur, DepotsStore } from './types';

export function obtenirStore(): DepotsStore | null {
  return null;
}

export function obtenirCrediteur(): Crediteur | null {
  return null;
}

/**
 * Taux FIXES CHF → devise locale, lus dans `PAWAPAY_RATES` (JSON, ex.
 * `{"XOF": …, "XAF": …}`), côté serveur uniquement. Aucune API de taux.
 *
 * `null` (initiation refusée, 503) si la variable est absente, n'est pas du
 * JSON, n'est pas un objet, ou ne contient aucun taux valide. Une devise au
 * taux invalide est écartée seule. Les journaux ne citent JAMAIS la valeur de
 * la variable : seulement la raison et les CODES de devise écartés.
 */
export async function obtenirTauxChf(): Promise<TauxChf | null> {
  const analyse = analyserTauxChf(process.env.PAWAPAY_RATES);
  if (analyse.erreur && analyse.erreur !== 'absente') {
    console.error(`[PAWAPAY_TAUX] PAWAPAY_RATES refusée : ${analyse.erreur}`);
  }
  if (analyse.devisesRefusees.length > 0) {
    console.error(`[PAWAPAY_TAUX] Taux invalide, devise(s) écartée(s) : ${analyse.devisesRefusees.join(', ')}`);
  }
  if (analyse.clesIgnorees > 0) {
    console.warn(`[PAWAPAY_TAUX] ${analyse.clesIgnorees} clé(s) ignorée(s) : pas un code ISO à 3 lettres`);
  }
  return analyse.taux;
}

/** Store + crédit, ou `null` si l'un manque : un seul point de décision. */
export function obtenirDependances(): { store: DepotsStore; crediter: Crediteur } | null {
  const store = obtenirStore();
  const crediter = obtenirCrediteur();
  return store && crediter ? { store, crediter } : null;
}
