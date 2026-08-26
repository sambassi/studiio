import Link from 'next/link';
import { Sparkles, SlidersHorizontal, AlertTriangle } from 'lucide-react';
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
      {/* ── En-tête ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)' }}
          >
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Créer</h1>
            <p className="text-sm text-gray-400">
              Un parcours guidé, sans réglages à connaître.
            </p>
          </div>
        </div>

        {/* Echappatoire discrete, volontairement pas un bascule symetrique :
            l'editeur avance est une compatibilite, pas un mode a choisir. */}
        <Link
          href="/dashboard/creer-avance"
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition flex-shrink-0 self-start"
          title="Ancien éditeur, conservé temporairement"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Éditeur avancé
        </Link>
      </div>

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
