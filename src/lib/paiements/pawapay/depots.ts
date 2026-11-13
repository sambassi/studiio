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
  derniere_verification_le: string | null;
  created_at: string;
}

/** `true` si l'erreur PostgREST dit « cette table n'existe pas ». */
function tableAbsente(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const m = `${erreur.code ?? ''} ${erreur.message ?? ''}`.toLowerCase();
  return m.includes('pgrst205') || m.includes('could not find the table') || m.includes('does not exist');
}

export async function creerDepot(
  d: Omit<Depot, 'statut' | 'motif_echec' | 'credite_le' | 'created_at' | 'derniere_verification_le'>,
): Promise<void> {
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
 * Au-delà de ce délai, un dépôt encore « en attente » est ABANDONNÉ : la page
 * de paiement du prestataire a expiré depuis longtemps, et un paiement qui ne
 * s'est pas conclu en vingt-quatre heures ne se conclura pas.
 *
 * La borne est volontairement large — bien plus que la durée de vie réelle
 * d'une page de paiement — parce que se tromper dans ce sens ne coûte qu'une
 * relecture de plus, alors que se tromper dans l'autre ferait sortir de la
 * file un paiement encore vivant.
 */
export const HEURES_AVANT_ABANDON = 24;

/**
 * Combien de paiements un même compte peut avoir ouverts à la fois.
 *
 * Assez large pour ne jamais gêner quelqu'un qui se ravise, change de
 * recharge ou se trompe d'opérateur ; assez bas pour qu'un seul compte ne
 * puisse pas remplir la file de réconciliation que TOUS les comptes
 * partagent. Les dépôts abandonnés sortent de ce décompte au bout de
 * `HEURES_AVANT_ABANDON`.
 */
export const MAX_DEPOTS_OUVERTS = 5;

/**
 * Les dépôts encore ouverts à relire, **les moins récemment vérifiés
 * d'abord**, jamais vérifiés en tête.
 *
 * ⚠️ CE N'EST PAS UN TRI PAR DATE DE CRÉATION, ET C'EST VOLONTAIRE. Trier par
 * ancienneté paraît naturel — le plus vieux paiement est le plus inquiétant —
 * mais c'est exactement ce qui casse le filet : des dépôts jamais honorés, et
 * donc éternellement les plus anciens, occuperaient la fenêtre à chaque
 * passage et les paiements récents ne seraient PLUS JAMAIS relus. Il suffirait
 * d'en ouvrir cinquante et de ne jamais payer. La file doit tourner.
 */
export async function depotsEnAttente(limite = 50): Promise<Depot[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*').eq('statut', 'en_attente')
    .order('derniere_verification_le', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return (data as Depot[] | null) ?? [];
}

/**
 * Note qu'un dépôt vient d'être relu — qu'il ait changé d'état ou non. C'est
 * ce qui le place en fin de file et laisse passer les suivants.
 *
 * Un échec ici ne fait pas échouer la réconciliation : au pire le dépôt est
 * relu une fois de trop, ce qui ne crédite rien en double.
 */
export async function marquerVerifie(depositId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE_DEPOTS)
    .update({ derniere_verification_le: new Date().toISOString() })
    .eq('deposit_id', depositId);
  if (error && !tableAbsente(error)) {
    console.warn('[mobile money] horodatage de vérification non écrit', { depositId });
  }
}

/**
 * Ferme les dépôts abandonnés : encore « en attente » au-delà de la borne.
 *
 * ⚠️ Fermer ici ne PERD rien. `confirmerDepot` ne regarde que `credite_le` :
 * si le prestataire confirmait malgré tout ce paiement plus tard, la
 * notification le créditerait quand même. On sort de la file de relecture,
 * on ne renonce pas au paiement.
 */
export async function expirerDepotsAbandonnes(heures = HEURES_AVANT_ABANDON): Promise<number> {
  const limite = new Date(Date.now() - heures * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS)
    .update({ statut: 'expire', motif_echec: 'sans_reponse', updated_at: new Date().toISOString() })
    .eq('statut', 'en_attente')
    .lt('created_at', limite)
    .select('deposit_id');
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts non expirés : ${error.message}`);
  }
  return (data as unknown[] | null)?.length ?? 0;
}

/**
 * Combien de paiements ce compte a-t-il d'ouverts en ce moment.
 *
 * Sert à BORNER : sans plafond, un seul compte pourrait ouvrir des milliers
 * de paiements qu'il n'honore pas et noyer la file de réconciliation de tous
 * les autres. Le plafond protège un service partagé, pas le compte lui-même.
 */
export async function depotsOuvertsDuCompte(userId: string): Promise<number> {
  const limite = new Date(Date.now() - HEURES_AVANT_ABANDON * 3600_000).toISOString();
  const { count, error } = await supabaseAdmin
    .from(TABLE_DEPOTS)
    .select('deposit_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('statut', 'en_attente')
    .gte('created_at', limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return count ?? 0;
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
