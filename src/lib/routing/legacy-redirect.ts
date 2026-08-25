/**
 * Redirections des anciennes routes vers la route canonique.
 *
 * Plusieurs chemins historiques mènent aujourd'hui à `/dashboard/creer` :
 * `/dashboard/creer-simple`, `/dashboard/creator`, `/dashboard/infographie`.
 * Chacun doit transporter la query string TELLE QUELLE, sinon un lien du type
 * `/dashboard/creator?id=123` arrive dépouillé de son paramètre — l'information
 * est perdue en silence, sans erreur, et le parcours repart de zéro.
 *
 * Une seule implémentation ici plutôt qu'une copie par page : trois copies
 * divergeraient, et le bug ne réapparaîtrait que sur l'une des trois.
 */

/** Ce que Next passe à une page serveur dans `searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reconstruit la query string à partir de `searchParams`.
 *
 * Garanties :
 * - **Paramètres répétés préservés** : `?tag=a&tag=b` reste `?tag=a&tag=b`.
 * - **Valeurs préservées** : Next livre les valeurs déjà décodées ;
 *   `URLSearchParams` les ré-encode, donc une valeur contenant un espace ou un
 *   `&` traverse la redirection intacte une fois relue.
 * - **Clé sans valeur ignorée** plutôt qu'écrite `undefined`, qui deviendrait
 *   une chaîne littérale côté destination.
 *
 * Limite connue : l'ordre suit celui des CLÉS telles que Next les regroupe.
 * `?a=1&b=2&a=3` ressort `?a=1&a=3&b=2` — les valeurs et leur ordre au sein
 * d'une même clé sont conservés, ce qui est ce dont dépendent les lecteurs.
 *
 * @returns `''` s'il n'y a rien à transporter, sinon `'?…'`.
 */
export function buildQuery(searchParams?: SearchParams): string {
  if (!searchParams) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Route canonique de création. */
export const CREER_ROUTE = '/dashboard/creer';

/**
 * Destination d'une redirection vers « Créer », query comprise.
 *
 * Utilisée par les pages de redirection : elles ne font que calculer cette
 * cible et la passer à `redirect()`. Aucune d'elles ne LIT les paramètres —
 * les transporter et les interpréter sont deux sujets distincts.
 */
export function creerRedirectTarget(searchParams?: SearchParams): string {
  return `${CREER_ROUTE}${buildQuery(searchParams)}`;
}
