/**
 * MOBILE MONEY — l'interrupteur, et pourquoi il est FERMÉ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI MANQUE, ET QUI N'EST PAS DU CODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'encaissement Mobile Money d'afroboost fonctionne, mais il ne peut pas
 * être repris tel quel pour Studiio, et la raison est contractuelle :
 *
 *   1. Le prestataire n'accepte QU'UNE SEULE URL de rappel par compte
 *      marchand. Celle du compte existant pointe vers afroboost, qui
 *      redistribue ensuite vers ses autres applications. Brancher Studiio
 *      dessus rendrait la CONFIRMATION DE SES PAIEMENTS dépendante de la
 *      disponibilité d'afroboost — un incident là-bas, et un paiement
 *      Studiio encaissé reste non crédité.
 *   2. Un compte marchand distinct suppose un enrôlement commercial séparé,
 *      pas une reprise de configuration.
 *
 * Tant que ce point n'est pas tranché, ce module reste FERMÉ : aucun appel
 * sortant n'est possible, et `etatMobileMoney()` dit pourquoi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST DÉJÀ LÀ, ET UTILISABLE SANS PRESTATAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La conversion (`lib/paiements/cfa`) ne dépend d'aucun prestataire : elle
 * permet déjà d'AFFICHER un prix en franc CFA, vérifiable et daté. C'est ce
 * que sert `/api/paiements/cfa/devis`.
 *
 * Fonctions PURES, hors lecture d'environnement.
 */
export const BASE_SANDBOX = 'https://api.sandbox.pawapay.io';
export const BASE_PRODUCTION = 'https://api.pawapay.io';

/**
 * Noms des variables attendues le jour de l'activation. Les VALEURS ne sont
 * jamais lues ici, jamais journalisées, jamais renvoyées au navigateur.
 */
export const VARIABLES_ATTENDUES = [
  'MOBILE_MONEY_ACTIF',
  'MOBILE_MONEY_API_TOKEN',
  'MOBILE_MONEY_BASE_URL',
  'MOBILE_MONEY_CALLBACK_URL',
  'MOBILE_MONEY_PAYS_DEFAUT',
] as const;

export type MotifFermeture =
  | 'drapeau_absent'
  | 'jeton_absent'
  | 'rappel_absent'
  | 'compte_marchand_non_tranche';

export const MESSAGE_FERMETURE: Record<MotifFermeture, string> = {
  drapeau_absent: 'Le paiement Mobile Money n’est pas activé sur ce serveur.',
  jeton_absent: 'Le paiement Mobile Money n’est pas configuré sur ce serveur.',
  rappel_absent: 'Le paiement Mobile Money n’est pas configuré sur ce serveur.',
  compte_marchand_non_tranche: 'Le paiement Mobile Money n’est pas encore ouvert.',
};

export interface EtatMobileMoney {
  /** `true` seulement si TOUT est réuni. Fermé par défaut, sans exception. */
  actif: boolean;
  /** Pourquoi c'est fermé. `null` si c'est ouvert. */
  motif: MotifFermeture | null;
  /** Ce que l'utilisateur lit. Ne nomme jamais le prestataire. */
  message: string | null;
  /** `true` = l'adresse configurée est celle du bac à sable. */
  sandbox: boolean;
}

/**
 * Lit l'environnement et rend l'état. Le drapeau doit valoir exactement
 * `'1'` : une valeur approximative (`true`, `oui`, vide) laisse fermé, parce
 * qu'un encaissement ne s'ouvre pas par accident de configuration.
 */
export function etatMobileMoney(env: NodeJS.ProcessEnv = process.env): EtatMobileMoney {
  const base = (env.MOBILE_MONEY_BASE_URL || BASE_SANDBOX).trim();
  const sandbox = !base.startsWith(BASE_PRODUCTION);
  const ferme = (motif: MotifFermeture): EtatMobileMoney => ({
    actif: false, motif, message: MESSAGE_FERMETURE[motif], sandbox,
  });

  if ((env.MOBILE_MONEY_ACTIF || '').trim() !== '1') return ferme('drapeau_absent');
  if (!(env.MOBILE_MONEY_API_TOKEN || '').trim()) return ferme('jeton_absent');
  if (!(env.MOBILE_MONEY_CALLBACK_URL || '').trim()) return ferme('rappel_absent');
  return { actif: true, motif: null, message: null, sandbox };
}
