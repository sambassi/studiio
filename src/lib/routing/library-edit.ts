/**
 * Ce que fait le bouton « Modifier » de la Bibliothèque.
 *
 * `GET /api/videos` fusionne DEUX tables dans une même liste, et `type` dit
 * laquelle :
 *
 * - `type: 'infographic'` → l'`id` est un `scheduled_posts.id`. Le parcours
 *   guidé le rouvre (`?postId=`, chargement owner-scopé) et l'enregistre par
 *   `PATCH` sur le MÊME post — exactement comme « Modifier » du Calendrier.
 * - tout autre `type` → l'`id` est un `videos.id`, que personne ne sait relire.
 *   La vidéo s'édite à travers le post qui la référence
 *   (`scheduled_posts.video_id`, fourni par l'API en `linked_post_id`) :
 *     - relié → on ouvre CE post ;
 *     - non relié → `create-editable` : l'écran propose explicitement d'en créer
 *       un (`POST /api/videos/[id]/editable-post`) au lieu d'ouvrir un éditeur
 *       vide.
 *   Le `videos.id` n'est JAMAIS passé comme `postId`.
 */
export type LibraryEditAction =
  | { kind: 'open'; href: string }
  | { kind: 'create-editable'; videoId: string };

export const editPostHref = (postId: string) =>
  `/dashboard/creer?postId=${encodeURIComponent(postId)}`;

export function libraryEditAction(item: {
  id: string;
  type?: string;
  linked_post_id?: string | null;
}): LibraryEditAction {
  if (item.type === 'infographic') return { kind: 'open', href: editPostHref(item.id) };
  if (typeof item.linked_post_id === 'string' && item.linked_post_id) {
    return { kind: 'open', href: editPostHref(item.linked_post_id) };
  }
  return { kind: 'create-editable', videoId: item.id };
}
