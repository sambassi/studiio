/**
 * Etat de la route `/api/render/batch`.
 *
 * Vit hors de `route.ts` : un fichier de route Next ne peut exporter que ses
 * gestionnaires — tout autre export fait echouer la verification de types des
 * routes. Et sorti de la route, l'etat devient interrogeable par les tests.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE ROUTE EST DESACTIVEE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. Elle debite `count x cout` D'AVANCE, sans jamais rembourser : le mot
 *    n'apparait nulle part dans le fichier, et son `catch` final rend un 500
 *    APRES que les credits sont partis.
 * 2. Elle ne lance AUCUN rendu. Elle insere des `render_jobs` en `queued` — or
 *    rien ne consomme cette file. Les lignes restent en `rendering` jusqu'a
 *    leur purge a sept jours par `cron/cleanup-db`. N credits partent, zero
 *    video est produite.
 * 3. Elle n'a aucune cle d'idempotence : rejouer la meme requete debite deux
 *    fois.
 *
 * Elle n'a aucun appelant dans l'application — mais elle reste joignable en
 * HTTP par tout porteur de session, ce qui suffit a en faire un risque.
 *
 * Reactivation : quand le debit sera atomique ET idempotent, et quand un
 * consommateur lira reellement `render_jobs`. Pas avant, pas partiellement.
 */

/**
 * Annote `boolean` et NON `true`, deliberement : sans cette annotation,
 * TypeScript rétrécit la constante au litteral, declare inatteignable le corps
 * historique conserve sous le garde, et perd du meme coup le retrecissement de
 * `session` et `user` — onze erreurs de type pour un drapeau.
 */
export const BATCH_RENDER_DESACTIVE: boolean = true;

export const BATCH_RENDER_MESSAGE =
  'Le rendu Batch serveur est temporairement indisponible : le débit des '
  + 'crédits n’est ni atomique ni idempotent, et aucun rendu n’était réellement '
  + 'lancé. Aucun crédit n’a été débité.';
