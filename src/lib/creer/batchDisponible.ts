/**
 * Le mode SERIE de l'Assistant est-il ouvert aux utilisateurs ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NON, ET CE N'EST PAS PARCE QUE LE CODE MANQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le lot fonctionne : il compose reellement chaque montage et cree reellement
 * chaque post. Ce qui n'est pas sur, c'est ce qu'il fait AUX CREDITS, et le
 * probleme n'est pas dans l'Assistant :
 *
 *   - `deductCredits` (`lib/credits/system.ts`) est un lire-modifier-ecrire
 *     sans verrou ni decrement relatif : deux debits concurrents se perdent
 *     l'un l'autre ;
 *   - `/api/credits/deduct` accepte encore le COUT envoye par le client ;
 *   - aucune cle d'idempotence n'existe — `credit_transactions.reference_id`
 *     est en base, n'est ecrit par personne, et n'a pas d'index unique ;
 *   - la reprise apres echec est desactivee pour cette meme raison, ce qui
 *     laisse un lot interrompu sans rattrapage.
 *
 * Un lot, c'est N debits d'affilee : c'est exactement le cas ou ces quatre
 * points cessent d'etre theoriques. Le mode unitaire, lui, reste ouvert — il
 * porte le meme risque, mais une fois, et il est en production depuis
 * longtemps ; le retirer serait une regression, pas une precaution.
 *
 * Le code du lot est CONSERVE en entier. Il ne s'agit pas de le defaire, mais
 * de fermer sa porte le temps de securiser les credits.
 *
 * Reactivation : passer ce drapeau a `true`, et rien d'autre.
 */

import { clampBatchCount } from './batch';

/**
 * Annote `boolean` et NON `false`, deliberement : sans cette annotation,
 * TypeScript retrecit la constante au litteral et declare inatteignable tout
 * le code du lot conserve derriere — ce qui ferait disparaitre le
 * retrecissement de type ailleurs et produirait des erreurs sans rapport.
 * Meme raison que `BATCH_RENDER_DESACTIVE` dans `lib/render/batch-disabled`.
 */
export const BATCH_SERIE_DISPONIBLE: boolean = false;

/** Pastille de la carte « Serie ». */
export const BATCH_SERIE_BADGE = 'Bientôt disponible';

/** Une ligne, sous la carte : pourquoi c'est ferme. */
export const BATCH_SERIE_EXPLICATION = 'Sécurisation des crédits en cours';

/**
 * Message affiche si le lot est declenche malgre tout.
 *
 * Il dit la vraie raison. Un « indisponible pour le moment » laisserait croire
 * a une panne passagere alors que c'est une fermeture deliberee.
 */
export const BATCH_SERIE_REFUS =
  'La série est temporairement fermée : le débit des crédits n’est pas encore '
  + 'atomique ni idempotent, et un lot enchaîne plusieurs débits. Votre contenu '
  + 'n’a pas été composé et aucun crédit n’a été débité. Créez-le en « Un seul '
  + 'contenu » en attendant.';

/**
 * Nombre de montages REELLEMENT autorise.
 *
 * Le point unique par lequel toute valeur doit passer — y compris celles qui
 * ne viennent d'aucun clic. Un brouillon enregistre AVANT la fermeture porte
 * `batchCount: 10` dans le `localStorage` de l'utilisateur : il rouvrirait le
 * mode serie au chargement, sans que personne n'ait touche un bouton. Griser
 * la carte ne suffit donc pas, et c'est precisement ce que cette fonction
 * couvre.
 *
 * Fail-closed : tant que le drapeau est baisse, la reponse est `1`, quelle que
 * soit l'entree.
 */
export function batchCountAutorise(valeur: number): number {
  if (!BATCH_SERIE_DISPONIBLE) return 1;
  return clampBatchCount(valeur);
}

/**
 * Ce lancement doit-il etre refuse ?
 *
 * Interrogee au tout debut du gestionnaire de rendu, AVANT le moindre effet de
 * bord — avant la lecture du solde, avant la capture de l'apercu, avant la
 * composition, avant la creation du post, avant le debit.
 */
export function lotRefuse(batchCount: number): boolean {
  return !BATCH_SERIE_DISPONIBLE && clampBatchCount(batchCount) > 1;
}
