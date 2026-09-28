/**
 * Branchement de la persistance et de la configuration PawaPay de Studiio.
 *
 * INTERRUPTEUR GLOBAL : `PAWAPAY_ENABLED === "true"`, sinon `obtenirStore()`
 * renvoie `null` et :
 * - l'initiation (`/api/pawapay/deposit`) répond 503 ;
 * - le rattrapage (`/api/cron/pawapay-reconcile`) répond « désactivé » ;
 * - le statut (`/api/pawapay/status/[id]`) répond 503 (sans store, il ne
 *   peut pas lire l'état local) ;
 * - le callback facultatif répond 404.
 *
 * PERSISTANCE : table `pawapay_deposits` et RPC atomique
 * `crediter_depot_pawapay` (migrations/2026-09-28-pawapay-deposits.sql), via
 * PostgREST et le rôle serveur (`supabaseAdmin`). `obtenirStore()` ne renvoie
 * ce store QUE si l'interrupteur est posé ; sinon `null`, comme avant la
 * migration : aucune route ne lit ni n'écrit la table. La migration doit donc
 * être appliquée (et PostgREST rechargé) AVANT de poser `PAWAPAY_ENABLED`.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { creerStorePostgrest } from './store-postgrest';
import { analyserTauxChf, type TauxChf } from './tarifs';
import type { DepotsStore } from './types';

export function pawapayActif(): boolean {
  return process.env.PAWAPAY_ENABLED === 'true';
}

let storeMemo: DepotsStore | null = null;

export function obtenirStore(): DepotsStore | null {
  if (!pawapayActif()) return null;
  if (!storeMemo) storeMemo = creerStorePostgrest(supabaseAdmin);
  return storeMemo;
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

/** Le store, ou `null` tant que PawaPay est désactivé. */
export function obtenirDependances(): { store: DepotsStore } | null {
  const store = obtenirStore();
  return store ? { store } : null;
}
