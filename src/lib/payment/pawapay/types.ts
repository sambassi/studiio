/**
 * PawaPay (Mobile Money) — types propres à Studiio.
 *
 * Studiio est une intégration INDÉPENDANTE : ses propres routes, son propre
 * callback, ses propres dépôts, sa propre protection contre le double crédit.
 * Aucun appel vers un autre site, aucun routeur ni aucune base partagés.
 *
 * Référence API v2 : https://docs.pawapay.io/v2/api-reference/deposits/check-deposit-status
 */

/**
 * Statuts d'un dépôt côté PawaPay (enum `DepositStatus` de l'API v2).
 * Seuls `COMPLETED` et `FAILED` sont finaux.
 */
export const STATUTS_DEPOT_PAWAPAY = [
  'ACCEPTED',
  'PROCESSING',
  'IN_RECONCILIATION',
  'COMPLETED',
  'FAILED',
] as const;

export type StatutDepotPawapay = (typeof STATUTS_DEPOT_PAWAPAY)[number];

/**
 * Le dépôt tel que relu chez PawaPay (`GET /v2/deposits/{id}`).
 *
 * L'enveloppe v2 est `{ status: "FOUND" | "NOT_FOUND", data?: Deposit }`.
 * `FOUND` n'est PAS le statut du paiement : c'est `data.status` qui l'est.
 */
export type DepotDistant =
  | {
      trouve: true;
      depositId: string;
      /** `data.status` — chaîne brute : un statut inconnu reste « non final ». */
      statut: string;
      /** Montant en chaîne décimale, tel que renvoyé (ex. « 123.00 »). */
      montant: string;
      devise: string;
      pays?: string;
      metadata?: Record<string, unknown>;
    }
  | { trouve: false; depositId: string };

/** État local d'un dépôt Studiio. */
export type StatutDepotLocal = 'en_attente' | 'credite' | 'echec';

/**
 * Le dépôt que Studiio a créé et qu'il attend : c'est LUI qui fait foi pour
 * le montant, la devise, l'utilisateur et le nombre de crédits — jamais le
 * corps du callback.
 */
export interface DepotAttendu {
  depositId: string;
  userId: string;
  /** Pack acheté (clé de `PACKS_PAWAPAY`). */
  pack: string;
  credits: number;
  /** Montant attendu en devise locale, chaîne décimale. */
  montant: string;
  devise: string;
  statut: StatutDepotLocal;
  /** Pays ISO alpha-3 choisi à l'initiation. */
  pays?: string;
  /** Horodatage ISO de création de la ligne (avant l'appel PawaPay). */
  creeLe: string;
  /**
   * Horodatage ISO de la dernière relecture réussie chez PawaPay (`null` ou
   * absent = jamais relu). Le rattrapage sert d'abord les moins récemment
   * vérifiés : des dépôts abandonnés ne peuvent pas monopoliser un lot.
   */
  verifieLe?: string | null;
}

/** Verdict pur de `evaluerDepot`. */
export type VerdictDepot =
  | 'crediter'
  | 'echec'
  | 'en_attente'
  | 'montant_invalide'
  | 'devise_invalide'
  | 'introuvable';

/** Issue de `confirmerDepot`. */
export type IssueConfirmation =
  | 'credite'
  | 'deja_credite'
  | 'echec'
  | 'en_attente'
  | 'montant_invalide'
  | 'devise_invalide'
  | 'introuvable'
  | 'inconnu_local';

/** Demande de crédit atomique. */
export interface DemandeCredit {
  depositId: string;
  userId: string;
  credits: number;
  /** `'pawapay:' + depositId` — référence UNIQUE de la transaction de crédit. */
  referenceId: string;
}

/**
 * Persistance des dépôts Studiio.
 *
 * ⚠️ `crediterSiNonCredite` est le SEUL chemin de crédit et il DOIT être
 * atomique : marquer le dépôt `credite` ET écrire le crédit (solde +
 * `credit_transactions` avec `reference_id` UNIQUE) dans UNE même
 * transaction SQL. Aucun état « crédité sans crédit » n'est donc possible :
 * soit tout est écrit, soit rien ne l'est et l'appel lève.
 */
export interface DepotsStore {
  /**
   * Enregistre un dépôt `en_attente` AVANT l'appel à PawaPay : si le réseau
   * lâche après l'envoi, cette ligne est la seule trace permettant au
   * rattrapage de retrouver le dépôt.
   */
  enregistrer(depot: DepotAttendu): Promise<void>;
  lire(depositId: string): Promise<DepotAttendu | null>;
  /**
   * Dépôts `en_attente` créés dans `[creeApres, creeAvant]` (ISO ;
   * `creeApres` facultatif), triés par `verifieLe` croissant — jamais
   * vérifiés d'abord, puis par `creeLe` — au plus `limite`.
   */
  listerEnAttente(options: { creeAvant: string; creeApres?: string; limite: number }): Promise<DepotAttendu[]>;
  /** Note une relecture réussie chez PawaPay (`verifieLe = quand`). */
  noterVerification(depositId: string, quand: string): Promise<void>;
  /**
   * Crédite UNE fois, atomiquement (voir plus haut). `'credite'` : cet appel
   * a crédité ; `'deja_credite'` : c'était déjà fait. Lève si rien n'a pu
   * être écrit — le dépôt reste alors non crédité et sera re-tenté.
   */
  crediterSiNonCredite(demande: DemandeCredit): Promise<'credite' | 'deja_credite'>;
  /** Passe en `echec` — sans effet sur un dépôt déjà crédité. */
  marquerEchec(depositId: string): Promise<void>;
}

export interface DependancesConfirmation {
  store: DepotsStore;
  lireDepotDistant: (depositId: string) => Promise<DepotDistant>;
  /** Horloge injectable (tests). */
  maintenant?: () => Date;
}

/** Erreur de dialogue avec PawaPay (réseau, HTTP, réponse illisible). */
export class PawapayErreur extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly failureCode?: string,
  ) {
    super(message);
    this.name = 'PawapayErreur';
  }
}
