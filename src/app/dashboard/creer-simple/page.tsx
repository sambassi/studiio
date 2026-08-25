/**
 * LEGACY /dashboard/creer-simple.
 *
 * Ce parcours guidé est devenu `/dashboard/creer`, la route canonique unique
 * de création (décision produit du 2026-08-25). Ce fichier ne rend plus rien :
 * il redirige, en conservant les paramètres d'URL, pour qu'aucun favori,
 * aucun lien enregistré ni aucun lien interne oublié ne tombe sur un 404.
 *
 * Le calcul de la cible vit dans `@/lib/routing/legacy-redirect`, partagé avec
 * `/dashboard/creator` et `/dashboard/infographie` : trois copies de la même
 * reconstruction de query string finiraient par diverger.
 */
import { redirect } from 'next/navigation';
import { creerRedirectTarget, type SearchParams } from '@/lib/routing/legacy-redirect';

export default function CreerSimpleLegacyRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  redirect(creerRedirectTarget(searchParams));
}
