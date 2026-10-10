/**
 * Branchement de la persistance et de la configuration PawaPay de Studiio.
 *
 * INTERRUPTEUR GLOBAL : `PAWAPAY_ENABLED === "true"`, sinon :
 * - l'initiation (`/api/pawapay/deposit`) répond 503 ;
 * - le rattrapage (`/api/cron/pawapay-reconcile`) répond « désactivé » ;
 * - le statut (`/api/pawapay/status/[id]`) renvoie l'état LOCAL, sans relire
 *   PawaPay ni créditer ;
 * - le callback facultatif répond 404.
 *
 * TODO(migration pawapay_deposits) : la table `pawapay_deposits` et la RPC
 * atomique `crediter_depot_pawapay` n'existent pas encore (voir le TODO de
 * `creerStoreMemoire` dans `confirmation.ts`). Tant qu'elles ne sont pas
 * créées, `obtenirStore()` renvoie `null` et aucune route ne peut créditer :
 * initiation et statut répondent 503, le rattrapage « désactivé ».
 */
import { analyserTauxChf, type TauxChf } from './tarifs';
import type { DepotsStore } from './types';

export function pawapayActif(): boolean {
  return process.env.PAWAPAY_ENABLED === 'true';
}

export function obtenirStore(): DepotsStore | null {
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

/** Le store, ou `null` tant que la persistance n'existe pas. */
export function obtenirDependances(): { store: DepotsStore } | null {
  const store = obtenirStore();
  return store ? { store } : null;
}
