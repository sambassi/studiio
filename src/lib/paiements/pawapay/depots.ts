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

/**
 * Le statut tel que NOUS le stockons.
 *
 * ⚠️ `abandonne` n'est pas un statut du prestataire : c'est le nôtre, et la
 * distinction compte. `expire` veut dire « LE PRESTATAIRE a prononcé la fin
 * de ce paiement » — c'est définitif, il n'y a rien à réexaminer.
 * `abandonne` veut dire « NOUS avons cessé d'attendre » — le prestataire,
 * lui, dit encore « en attente », donc le dossier n'est pas clos et doit
 * rester repêchable. Les confondre mettrait dans la passe de seconde chance
 * des dossiers morts qui y resteraient pour toujours, et finiraient par
 * noyer ceux qui, eux, peuvent encore basculer.
 */
export type StatutDepotStocke = StatutDepot | 'abandonne';

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
  statut: StatutDepotStocke;
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

/**
 * Levée quand la BASE refuse l'ouverture : le compte a déjà trop de
 * paiements en cours. C'est le refus qui fait autorité — celui de la route
 * n'est qu'un raccourci pour afficher un message sans aller jusqu'à la base.
 */
export class TropDePaiementsOuverts extends Error {
  constructor() {
    super('trop_de_paiements_ouverts');
    this.name = 'TropDePaiementsOuverts';
  }
}

export async function creerDepot(
  d: Omit<Depot, 'statut' | 'motif_echec' | 'credite_le' | 'created_at' | 'derniere_verification_le'>,
): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE_DEPOTS).insert({ ...d, statut: 'en_attente' });
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    // Le déclencheur de la migration, qui compte sous verrou et refuse.
    if ((error.message ?? '').includes('trop_de_paiements_ouverts')) {
      throw new TropDePaiementsOuverts();
    }
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

/** Vrai si ce dépôt traîne depuis plus longtemps que la borne d'abandon. */
export function depasseLaBorne(d: Depot, heures = HEURES_AVANT_ABANDON): boolean {
  return Date.parse(d.created_at) < Date.now() - heures * 3600_000;
}

/**
 * Ferme un dépôt comme abandonné.
 *
 * ⚠️ À N'APPELER QU'APRÈS AVOIR DEMANDÉ AU PRESTATAIRE, et seulement s'il
 * répond encore « en attente ». Fermer sur le seul critère de l'âge était un
 * vrai défaut : le paiement a pu aboutir côté payeur sans que nous le
 * sachions, et comme la notification peut ne jamais arriver — c'est tout le
 * problème que ce lot traite — nous aurions encaissé sans créditer. L'âge
 * décide QUAND on cesse d'attendre, jamais SI le paiement a eu lieu.
 */
export async function marquerAbandonne(depositId: string): Promise<void> {
  await marquerDepot(depositId, { statut: 'abandonne', motif_echec: 'sans_reponse' });
}

/**
 * Au-delà de ce délai, on cesse aussi de repêcher : un paiement que le
 * prestataire laisse « en attente » depuis un mois ne basculera pas. Sans
 * cette borne, la réserve de seconde chance ne ferait que grossir, et
 * chaque dossier y passerait de moins en moins souvent.
 */
export const JOURS_AVANT_CLASSEMENT = 30;

/**
 * Les dépôts fermés comme abandonnés mais JAMAIS CRÉDITÉS, les moins
 * récemment relus d'abord.
 *
 * C'est la seconde chance : fermer un dépôt le sort de la file principale,
 * il ne faut donc pas qu'il disparaisse pour autant. Cette passe le rouvre
 * de temps en temps, pour le cas où le prestataire finirait par confirmer un
 * paiement que nous avons cessé d'attendre.
 */
export async function depotsAbandonnesARelire(limite = 10): Promise<Depot[]> {
  const plancher = new Date(Date.now() - JOURS_AVANT_CLASSEMENT * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE_DEPOTS).select('*')
    // ⚠️ `abandonne`, PAS `expire` : seulement les dossiers que nous avons
    // refermés nous-mêmes. Ceux que le prestataire a déclarés clos n'ont rien
    // à faire ici — ils ne basculeront jamais, et ils dilueraient la réserve.
    .eq('statut', 'abandonne')
    .is('credite_le', null)
    .gte('created_at', plancher)
    .order('derniere_verification_le', { ascending: true, nullsFirst: true })
    .limit(limite);
  if (error) {
    if (tableAbsente(error)) throw new SocleAbsent();
    throw new Error(`dépôts illisibles : ${error.message}`);
  }
  return (data as Depot[] | null) ?? [];
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
