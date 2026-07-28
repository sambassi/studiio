import Link from 'next/link';
import { Wand2, Sparkles, SlidersHorizontal } from 'lucide-react';
import AssistantWizard from './AssistantWizard';

/**
 * Page Créer simplifiée (F5) — couche NON DESTRUCTIVE.
 *
 * Cette page est purement additive : elle ne remplace pas /dashboard/creer,
 * qui reste l'éditeur complet et n'est modifié en rien. Le bouton « Mode
 * avancé » y renvoie.
 *
 * Le parcours « Créer avec l'assistant » est câblé (voir AssistantWizard).
 * « Autopilote » reste une maquette, avec un bouton désactivé plutôt qu'actif
 * sans effet : rien ne doit laisser croire qu'un traitement a démarré.
 *
 * Cette page reste un composant SERVEUR : seul le wizard, qui a besoin d'état,
 * est un composant client. Le toggle est un simple lien.
 */

const BRAND = '#7C3AED';

export default function CreerSimplePage() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* ── En-tête + toggle simple / avancé ─────────────────────────── */}
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

        {/* Toggle : « simple » est l'état courant, « avancé » navigue. */}
        <div
          className="inline-flex items-center rounded-xl p-1 flex-shrink-0 self-start"
          style={{ backgroundColor: '#0A0A0F' }}
          role="group"
          aria-label="Choix du mode d'édition"
        >
          <span
            aria-current="page"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: `${BRAND}33`, boxShadow: `inset 0 0 0 1px ${BRAND}66` }}
          >
            <Wand2 className="w-4 h-4" style={{ color: '#C4B5FD' }} />
            Mode simple
          </span>
          <Link
            href="/dashboard/creer"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:text-white transition"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Mode avancé
          </Link>
        </div>
      </div>

      {/* Corps : parcours a gauche, apercu a droite — tout est pilote par
          le wizard, qui doit partager son etat entre les deux colonnes. */}
      <AssistantWizard />
    </div>
  );
}
