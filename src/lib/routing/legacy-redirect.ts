/**
 * Destination des anciennes routes de création, query comprise.
 *
 * Trois chemins historiques mènent aujourd'hui à la création :
 * `/dashboard/creer-simple`, `/dashboard/creator` et `/dashboard/infographie`.
 * Après l'unification, deux pages seulement subsistent :
 *
 * - `/dashboard/creer` — le parcours guidé : NOUVELLE création, et
 *   modification d'un post (`?postId=`, relu par `lib/creer/editTarget`) ;
 * - `/dashboard/creer-avance` — l'ancien éditeur, conservé pour les liens
 *   qu'aucun autre écran ne sait interpréter (`?id=`, voir `LEGACY_ONLY_PARAMS`).
 *
 * Ce module ne fait que CALCULER une cible. Il ne redirige pas lui-même, ne
 * lit aucune base et n'interprète aucun identifiant : transporter un paramètre
 * et le comprendre sont deux sujets distincts, et seul le premier est traité
 * ici.
 *
 * Une seule implémentation plutôt qu'une copie par page : trois copies
 * divergeraient, et le bug ne réapparaîtrait que sur l'une des trois.
 */

/** Ce que Next passe à une page serveur dans `searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Parcours guidé — toute nouvelle création. */
export const CREER_ROUTE = '/dashboard/creer';

/** Ancien éditeur — destination des seuls liens `?id=` (voir `LEGACY_ONLY_PARAMS`). */
export const CREER_AVANCE_ROUTE = '/dashboard/creer-avance';

/**
 * Paramètres qui désignent un contenu à MODIFIER.
 *
 * `postId` est lu par les deux éditeurs ; `id` ne l'est encore par personne,
 * mais il est porté par le bouton « Modifier » de la Bibliothèque pour une
 * vidéo. Les deux sont des intentions d'édition — où chacune peut aller est
 * décidé par `LEGACY_ONLY_PARAMS`.
 */
export const EDIT_PARAMS = ['postId', 'id'] as const;

/**
 * Paramètres d'édition que SEUL l'ancien éditeur reçoit.
 *
 * `postId` n'y figure plus : c'est un `scheduled_posts.id`, que le parcours
 * guidé relit depuis PR #426 (chargement owner-scopé par `GET /api/posts/[id]`,
 * enregistrement `PATCH` sur le MÊME post). Un lien historique `?postId=` y va
 * donc, comme les boutons « Modifier » du Calendrier.
 *
 * `id` reste ici : c'est un `videos.id` (Bibliothèque), que le parcours guidé
 * ignore — le lui envoyer ouvrirait un montage vierge. Le convertir en
 * `postId` serait inventer un lien entre deux tables qui n'en ont pas. Un lien
 * qui porte les DEUX reste aussi sur l'ancien éditeur : ambigu, il garde son
 * comportement d'avant.
 */
export const LEGACY_ONLY_PARAMS = ['id'] as const;

/**
 * Reconstruit la query string à partir de `searchParams`.
 *
 * Garanties :
 * - **Paramètres répétés préservés** : `?tag=a&tag=b` reste `?tag=a&tag=b`,
 *   valeurs et ordre interne compris.
 * - **Valeurs vides préservées** : `?tab=` reste `?tab=`. Une clé présente
 *   sans valeur n'est pas la même chose qu'une clé absente, et le distinguo
 *   appartient au lecteur, pas au transport.
 * - **Valeurs ré-encodées** : Next livre les valeurs déjà décodées ;
 *   `URLSearchParams` les ré-encode, si bien qu'un espace, un `&` ou un
 *   caractère accentué traverse la redirection intact une fois relu.
 * - **Clé à `undefined` ignorée** plutôt qu'écrite `undefined`, qui
 *   deviendrait la chaîne littérale « undefined » côté destination.
 *
 * Limite connue : l'ordre suit celui des CLÉS telles que Next les regroupe.
 * `?a=1&b=2&a=3` ressort `?a=1&a=3&b=2` — l'ordre des valeurs d'une MÊME clé
 * est conservé, ce qui est ce dont dépendent les lecteurs.
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

/**
 * La query désigne-t-elle un contenu existant à modifier ?
 *
 * Une clé présente mais VIDE (`?postId=`) compte comme une intention
 * d'édition. C'est le choix prudent : un identifiant vide est un lien
 * d'édition abîmé, pas une demande de nouvelle création.
 *
 * Aucune des clés surveillées n'existe sur `Object.prototype` : la lecture
 * directe ne peut pas remonter une propriété héritée.
 */
export function hasEditTarget(searchParams?: SearchParams): boolean {
  if (!searchParams) return false;
  return EDIT_PARAMS.some((key) => searchParams[key] !== undefined);
}

/**
 * Le lien doit-il encore passer par l'ancien éditeur ?
 *
 * Même règle de présence que `hasEditTarget` (une clé vide compte), limitée à
 * `LEGACY_ONLY_PARAMS`. Un `postId` vide ou répété part sur le parcours guidé,
 * qui l'affiche comme « lien incomplet » au lieu d'ouvrir une création.
 */
export function needsLegacyEditor(searchParams?: SearchParams): boolean {
  if (!searchParams) return false;
  return LEGACY_ONLY_PARAMS.some((key) => searchParams[key] !== undefined);
}

/**
 * Cible d'une redirection depuis une ancienne route, query comprise.
 *
 * Le chemin retourné est TOUJOURS l'une des deux constantes de ce module,
 * suivie d'une query encodée par `URLSearchParams`. Aucune valeur reçue ne
 * peut donc produire une destination externe : ni l'hôte ni le schéma ne
 * proviennent de l'entrée.
 */
export function creerRedirectTarget(searchParams?: SearchParams): string {
  const route = needsLegacyEditor(searchParams) ? CREER_AVANCE_ROUTE : CREER_ROUTE;
  return `${route}${buildQuery(searchParams)}`;
}
