/**
 * LE JOURNAL DES DÉPÔTS — écrit AVANT l'appel réseau, relu par tout le reste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI L'ÉCRITURE PRÉCÈDE L'APPEL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si la réponse du prestataire se perd — réseau coupé, serveur redémarré —
 * le paiement peut tout de même aboutir côté payeur. Sans ligne écrite
 * AVANT, ce paiement n'existerait nulle part chez nous : ni la notification
 * ni la réconciliation ne sauraient à quel compte l'attribuer, ni combien de
 * crédits accorder. La ligne est donc posée d'abord, et l'appel ensuite.
 *
 * Elle FIGE aussi ce qu'on attend : montant, devise, crédits promis. Un taux
 * de change qui bouge après coup ne doit pas changer ce qu'on exige du
 * payeur, ni ce qu'on lui doit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MIGRATION ABSENTE = ÉCHEC EXPLICITE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tant que `2026-11-13-mobile-money.sql` n'est pas appliquée, la table
 * n'existe pas. Chaque fonction le DIT (`socle_absent`) au lieu de laisser
 * croire à un incident passager — et surtout au lieu de créditer sans la
 * garantie d'unicité que porte l'index de cette migration.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import type { StatutDepot } from './contrat';

export const TABLE_DEPOTS = 'pawapay_depots';

export const MESSAGE_SOCLE_ABSENT =
  'Le paiement mobile n’est pas encore disponible sur ce serveur.';

export class SocleAbsent extends Error {
  constructor() {
    super('migration 2026-11-13-mobile-money.sql non appliquée');
    this.name = 'SocleAbsent';
  }
}

export interface Depot {
  deposit_id: string;
  user_id: string;
  offre_type: 'pack' | 'plan';
  offre_cle: string;
  credits: number;
  montant_local: number;
  devise: string;
  pays: string;
  prix_chf_cents: number;
  taux_eur_par_chf: number | null;
  taux_le: string | null;
  statut: StatutDepot;
  motif_echec: string | null;
  credite_le: string | null;
  sandbox: boolean;
  created_at: string;
}

/** `true` si l'erreur PostgREST dit « cette table n'existe pas ». */
function tableAbsente(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const m = `${erreur.code ?? ''} ${erreur.message ?? ''}`.toLowerCase();
  return m.includes('pgrst205') || m.includes('could not find the table') || m.includes('does not exist');
}

export async function creerDepot(d: Omit<Depot, 'statut' | 'motif_echec' | 'credite_le' | 'created_at'>): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE_DEPOTS).insert({ ...d, statut: 'en_attente' });
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôt non enregistré : ${error.message}`);
  }
}

export async function lireDepotLocal(depositId: string): Promise<Depot | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*').eq('deposit_id', depositId).maybeSingle();
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôt illisible : ${error.message}`);
  }
  return (data as Depot | null) ?? null;
}

export async function marquerDepot(
  depositId: string,
  patch: Partial<Pick<Depot, 'statut' | 'motif_echec' | 'credite_le'>>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE_DEPOTS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('deposit_id', depositId);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôt non mis à jour : ${error.message}`);
  }
}

/**
 * Les dépôts encore ouverts, les plus anciens d'abord — ce sont eux que la
 * réconciliation doit rattraper en priorité : un paiement en attente depuis
 * une heure est plus inquiétant qu'un autre depuis trente secondes.
 */
export async function depotsEnAttente(limite = 50): Promise<Depot[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*').eq('statut', 'en_attente')
    .order('created_at', { ascending: true }).limit(limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return (data as Depot[] | null) ?? [];
}

/** Derniers dépôts d'un compte, pour son historique. */
export async function depotsDuCompte(userId: string, limite = 20): Promise<Depot[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return (data as Depot[] | null) ?? [];
}

/** Tous les derniers dépôts — écran d'administration. */
export async function tousLesDepots(limite = 100): Promise<Depot[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*')
    .order('created_at', { ascending: false }).limit(limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return (data as Depot[] | null) ?? [];
}
