/**
 * Destination des anciennes routes de création, query comprise.
 *
 * Trois chemins historiques mènent aujourd'hui à la création :
 * `/dashboard/creer-simple`, `/dashboard/creator` et `/dashboard/infographie`.
 * Après l'unification, ils mènent à :
 *
 * - `/dashboard/creer` — le parcours guidé : NOUVELLE création, et
 *   modification d'un post (`?postId=`, relu par `lib/creer/editTarget`) ;
 * - `/dashboard/library` — pour un lien `?id=` (un `videos.id`, voir
 *   `LIBRARY_ONLY_PARAMS`) : c'est là qu'une vidéo se modifie (#430).
 *
 * `/dashboard/creer-avance` (l'ancien éditeur) existe toujours, mais n'est
 * plus la cible d'AUCUNE redirection : il ne lit que `postId` et `tab`, et un
 * lien `?id=` y ouvrait un éditeur vide (son brouillon local, pas la vidéo).
 * On n'y arrive plus que volontairement (« Ouvrir l'éditeur avancé »).
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

/** Ancien éditeur — conservé, accessible par son lien volontaire ; plus une cible de redirection. */
export const CREER_AVANCE_ROUTE = '/dashboard/creer-avance';

/** Bibliothèque — destination des liens `?id=` (un `videos.id`). */
export const LIBRARY_ROUTE = '/dashboard/library';

/**
 * Paramètres qui désignent un contenu à MODIFIER.
 *
 * `postId` est relu par le parcours guidé. `id` (un `videos.id`, porté par
 * d'anciens liens « Modifier » de la Bibliothèque) n'est relu par AUCUN
 * éditeur : où il mène est décidé par `LIBRARY_ONLY_PARAMS`.
 */
export const EDIT_PARAMS = ['postId', 'id'] as const;

/**
 * Paramètres d'édition qui mènent à la BIBLIOTHÈQUE.
 *
 * `id` est un `videos.id`. Aucun éditeur ne le relit : ni le parcours guidé
 * (qui ouvrirait une création vierge), ni l'ancien éditeur (qui ne lit que
 * `postId` et `tab` — il ouvrait son brouillon local). Le convertir en
 * `postId` serait inventer un lien entre deux tables. La Bibliothèque, elle,
 * sait modifier une vidéo : elle ouvre le post relié, ou propose d'en créer un
 * (`POST /api/videos/[id]/editable-post`, #430).
 *
 * `postId` reste prioritaire : un lien qui porte les DEUX va au parcours
 * guidé, qui modifie ce post (et ignore `id`).
 */
export const LIBRARY_ONLY_PARAMS = ['id'] as const;

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
 * Le lien désigne-t-il une VIDÉO (et doit-il aller à la Bibliothèque) ?
 *
 * Même règle de présence que `hasEditTarget` (une clé vide compte), limitée à
 * `LIBRARY_ONLY_PARAMS` — sauf si un `postId` est présent : lui est relu par
 * le parcours guidé, qui passe donc en premier. Un `postId` vide ou répété
 * part sur le parcours guidé, qui l'affiche comme « lien incomplet ».
 */
export function pointsToLibraryVideo(searchParams?: SearchParams): boolean {
  if (!searchParams) return false;
  if (searchParams.postId !== undefined) return false;
  return LIBRARY_ONLY_PARAMS.some((key) => searchParams[key] !== undefined);
}

/**
 * Cible d'une redirection depuis une ancienne route, query comprise.
 *
 * - lien de vidéo (`?id=` sans `postId`) → la Bibliothèque, SANS query :
 *   elle ne lit pas `id`, et le transporter laisserait croire qu'il est
 *   compris ;
 * - tout le reste → le parcours guidé, query transportée intacte.
 *
 * Le chemin retourné est TOUJOURS l'une des constantes de ce module, suivie
 * d'une query encodée par `URLSearchParams`. Aucune valeur reçue ne peut donc
 * produire une destination externe : ni l'hôte ni le schéma ne proviennent de
 * l'entrée.
 */
export function creerRedirectTarget(searchParams?: SearchParams): string {
  if (pointsToLibraryVideo(searchParams)) return LIBRARY_ROUTE;
  return `${CREER_ROUTE}${buildQuery(searchParams)}`;
}
