/**
 * Route historique `/dashboard/creator`.
 *
 * La création est unifiée sous `/dashboard/creer`. Cette page ne fait que
 * rediriger, en transportant la query TELLE QUELLE : un lien porteur d'un
 * identifiant arriverait sinon dépouillé, sans erreur, et le parcours
 * repartirait de zéro.
 *
 * Le calcul de la cible — `postId` (un post) vers le parcours guidé qui sait
 * le relire, `id` (une vidéo) encore vers l'éditeur avancé —
 * appartient à `legacy-redirect`, partagé par les trois routes.
 *
 * TODO: supprimer ce fichier une fois qu'aucun signet n'en dépend plus.
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
