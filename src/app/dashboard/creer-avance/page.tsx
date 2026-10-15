/**
 * Route historique `/dashboard/creer-avance` — l'ancien éditeur avancé.
 *
 * L'éditeur a été retiré : la création passe par `/dashboard/creer` (parcours
 * guidé et Autopilote). Cette page ne fait que rediriger, de façon PERMANENTE,
 * en transportant la query comme les autres routes historiques :
 *
 * - `?postId=` → `/dashboard/creer?postId=`, qui sait relire et modifier le
 *   post (l'ancien éditeur était le seul à le faire autrefois) ;
 * - `?id=` (un `videos.id`) → la Bibliothèque, où une vidéo se modifie ;
 * - tout le reste → `/dashboard/creer`, query intacte.
 *
 * En pratique, `next.config.js` (`redirects()`) répond déjà en HTTP 308 avec
 * ces mêmes règles, sous-chemins compris : cette page n'est qu'un filet. Le
 * calcul de la cible appartient à `legacy-redirect`, partagé par toutes les
 * routes historiques.
 *
 * TODO: supprimer ce fichier une fois qu'aucun signet n'en dépend plus.
 */
import { permanentRedirect } from 'next/navigation';
import { creerRedirectTarget, type SearchParams } from '@/lib/routing/legacy-redirect';

export default function CreerAvanceLegacyRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  permanentRedirect(creerRedirectTarget(searchParams));
}
