/**
 * LEGACY /dashboard/creator.
 *
 * L'expérience unifiée « Créer » vit sous `/dashboard/creer`. Ce fichier ne
 * rend rien : il redirige les favoris et liens internes qui pointent encore
 * ici — dont le bouton « Modifier » de la Bibliothèque, qui appelle
 * `/dashboard/creator?id=<video>`.
 *
 * La query string est transportée INTÉGRALEMENT. Elle n'est pas interprétée
 * pour autant : aucune page ne lit encore `id`, et reprendre une vidéo
 * existante dans le parcours guidé reste un chantier à part entière. Ce
 * transport en est seulement le préalable — sans lui, l'identifiant est perdu
 * avant même d'atteindre la destination.
 *
 * Même mécanisme que `/dashboard/creer-simple` et `/dashboard/infographie` :
 * une seule implémentation, dans `@/lib/routing/legacy-redirect`.
 */
import { redirect } from 'next/navigation';
import { creerRedirectTarget, type SearchParams } from '@/lib/routing/legacy-redirect';

export default function CreatorLegacyRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  redirect(creerRedirectTarget(searchParams));
}
