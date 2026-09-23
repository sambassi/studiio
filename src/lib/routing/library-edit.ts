/**
 * Cible du bouton « Modifier » de la Bibliothèque.
 *
 * `GET /api/videos` fusionne DEUX tables dans une même liste, et `type` dit
 * laquelle :
 *
 * - `type: 'infographic'` → l'`id` est un `scheduled_posts.id`. Le parcours
 *   guidé le rouvre (`?postId=`, chargement owner-scopé) et l'enregistre par
 *   `PATCH` sur le MÊME post — exactement comme « Modifier » du Calendrier.
 * - tout autre `type` → l'`id` est un `videos.id`. Le parcours guidé l'ignorerait
 *   et ouvrirait un montage vierge ; il reste donc sur l'éditeur avancé, tel
 *   quel. Il n'est JAMAIS réécrit en `postId` : aucune colonne ne relie une
 *   ligne `videos` à un post.
 */
export function libraryEditHref(item: { id: string; type?: string }): string {
  const id = encodeURIComponent(item.id);
  return item.type === 'infographic'
    ? `/dashboard/creer?postId=${id}`
    : `/dashboard/creer-avance?id=${id}`;
}
