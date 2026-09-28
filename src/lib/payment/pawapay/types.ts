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

/**
 * Persistance des dépôts Studiio.
 *
 * ⚠️ `marquerCrediteSiNonCredite` DOIT être atomique (UPDATE … WHERE statut
 * <> 'credite' RETURNING, ou RPC) : il ne renvoie `true` qu'UNE fois pour un
 * même `depositId`, même sous appels concurrents. C'est le verrou anti double
 * crédit.
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
   * Dépôts `en_attente` créés avant `avant` (ISO), les plus anciens d'abord,
   * au plus `limite` — pour le rattrapage par interrogation.
   */
  listerEnAttente(options: { avant: string; limite: number }): Promise<DepotAttendu[]>;
  marquerCrediteSiNonCredite(depositId: string): Promise<boolean>;
  /**
   * Rend le verrou si le crédit a échoué APRÈS sa prise, pour qu'un rejeu du
   * callback puisse créditer. Sûr seulement parce que `crediter` est
   * idempotent sur sa `referenceId`.
   */
  relacherCredit(depositId: string): Promise<void>;
  /** Passe en `echec` — sans effet sur un dépôt déjà crédité. */
  marquerEchec(depositId: string): Promise<void>;
}

/**
 * Crédite l'utilisateur. DOIT être idempotent sur `referenceId`
 * (`'pawapay:' + depositId`), par exemple via une contrainte d'unicité sur
 * la référence de la transaction de crédit.
 */
export type Crediteur = (userId: string, credits: number, referenceId: string) => Promise<void>;

export interface DependancesConfirmation {
  store: DepotsStore;
  lireDepotDistant: (depositId: string) => Promise<DepotDistant>;
  crediter: Crediteur;
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
