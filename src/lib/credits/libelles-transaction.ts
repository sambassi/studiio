/**
 * LE SENS D'UNE TRANSACTION DE CRÉDITS, ET SON NOM EN FRANÇAIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LE SIGNE NE SE LIT PAS DANS LA COLONNE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `credit_transactions.amount` porte DEUX conventions selon l'appelant :
 * certains chemins enregistrent une consommation en positif (le montant
 * retiré), d'autres en négatif (la variation du solde). L'historique se fiait
 * au signe stocké — une génération de 40 crédits s'affichait donc « +40 » en
 * vert, comme un achat.
 *
 * Le sens d'une opération est porté par son TYPE, pas par le signe de son
 * montant. C'est ce que fait ce module, et c'est la même lecture que
 * `lib/credits/bilan.ts`, qui prend déjà les montants en valeur absolue par
 * type pour la même raison.
 *
 * Fonctions PURES.
 */
export type TypeTransaction = 'purchase' | 'subscription' | 'bonus' | 'refund' | 'render';

export type SensTransaction = 'debit' | 'credit';

/**
 * Ce que le type fait au solde. Seule la consommation le diminue ; l'achat,
 * les crédits d'abonnement, les crédits offerts et le remboursement
 * l'augmentent.
 */
export const SENS_PAR_TYPE: Record<TypeTransaction, SensTransaction> = {
  render: 'debit',
  purchase: 'credit',
  subscription: 'credit',
  bonus: 'credit',
  refund: 'credit',
};

/** Libellés français. `render` couvre toute génération facturée. */
export const LIBELLE_PAR_TYPE: Record<TypeTransaction, string> = {
  render: 'Génération',
  purchase: 'Achat de crédits',
  subscription: 'Crédits de l’abonnement',
  bonus: 'Crédits offerts',
  refund: 'Remboursement',
};

export function estTypeTransaction(v: unknown): v is TypeTransaction {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SENS_PAR_TYPE, v);
}

/**
 * Le sens réel. Un type inconnu est traité comme un DÉBIT : mieux vaut
 * annoncer une sortie qui n'en est pas une que faire passer une consommation
 * pour un gain.
 */
export function sensTransaction(type: unknown): SensTransaction {
  return estTypeTransaction(type) ? SENS_PAR_TYPE[type] : 'debit';
}

/**
 * Nom affiché. Un type inconnu garde sa valeur brute plutôt que d'être
 * masqué : on ne cache pas une ligne qu'on ne sait pas nommer.
 */
export function libelleTransaction(type: unknown): string {
  if (estTypeTransaction(type)) return LIBELLE_PAR_TYPE[type];
  return typeof type === 'string' && type.trim() ? type : 'Opération';
}

/**
 * Montant SIGNÉ à afficher, déduit du type et de la valeur absolue du
 * montant stocké — quelle que soit la convention de signe de l'appelant.
 */
export function montantSigne(type: unknown, montant: unknown): number {
  const n = Math.abs(Number(montant));
  if (!Number.isFinite(n)) return 0;
  return sensTransaction(type) === 'debit' ? -n : n;
}

/** Texte prêt à afficher : « +200 » ou « −40 » (vrai signe moins). */
export function montantAffiche(type: unknown, montant: unknown): string {
  const n = montantSigne(type, montant);
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}
