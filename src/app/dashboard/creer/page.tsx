import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import AssistantWizard from './AssistantWizard';
import { readEditTarget, LIEN_INCOMPLET } from '@/lib/creer/editTarget';
import type { SearchParams } from '@/lib/routing/legacy-redirect';

/**
 * Page « Créer » — la route canonique de création.
 *
 * Elle porte le parcours guidé et l'Autopilote, tous deux rendus par
 * `AssistantWizard`. C'est la SEULE entrée « Créer » du menu.
 *
 * L'ancien éditeur vit désormais sous `/dashboard/creer-avance`. Il n'est ni
 * dans le menu ni présenté comme un parcours : c'est une compatibilité
 * temporaire, le temps que ce parcours-ci sache relire un contenu existant.
 * Le lien discret ci-dessous existe pour ne pas laisser sans issue quelqu'un
 * qui a besoin d'un réglage que le parcours guidé n'expose pas encore — il
 * n'est PAS un troisième choix mis sur le même plan que l'assistant.
 *
 * Cette page reste un composant SERVEUR : seul le wizard, qui a besoin d'état,
 * est un composant client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MODIFICATION D'UN CONTENU EXISTANT (`?postId=`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le triage du lien appartient à `lib/creer/editTarget`, pas à cette page :
 * distinguer « nouvelle création » de « contenu à charger » est la décision qui,
 * si elle se trompe, ouvre un montage vierge à la place d'un travail existant —
 * sans erreur, sans message. Elle est donc nommée, testée à part, et lue ici.
 *
 * Un lien porteur d'un `postId` inexploitable affiche une ERREUR et ne rend pas
 * le wizard. Retomber en création serait le pire des deux mondes : l'écran
 * paraîtrait normal, et le contenu paraîtrait perdu.
 */

export default function CreerPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const cible = readEditTarget(searchParams);
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* L'en-tete vit dans le wizard (`CreerEntete`) : il change selon que
          l'on est au choix des modes, dans l'assistant ou dans l'Autopilote,
          et porte le retour au choix. L'editeur avance est propose sur
          l'ecran de choix, comme option secondaire. */}

      {/* Corps : parcours a gauche, apercu a droite — tout est pilote par
          le wizard, qui doit partager son etat entre les deux colonnes.

          Sans `postId`, RIEN ne change : le wizard reçoit `undefined` et ouvre
          une nouvelle création, exactement comme avant ce lot. */}
      {cible.kind === 'invalid' ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-amber-200">{LIEN_INCOMPLET}</p>
            <p className="text-sm text-gray-400">
              Rouvrez le contenu depuis le Calendrier, ou{' '}
              <Link href="/dashboard/creer" className="underline hover:text-gray-200">
                commencez une nouvelle création
              </Link>
              .
            </p>
          </div>
        </div>
      ) : (
        <AssistantWizard />
      )}
    </div>
  );
}
