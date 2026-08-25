import { Sparkles } from 'lucide-react';
import AssistantWizard from './AssistantWizard';

/**
 * Page « Créer » — LA page de création de Studiio.
 *
 * Historique : ce parcours guidé vivait sous `/dashboard/creer-simple` pendant
 * que `/dashboard/creer` hébergeait l'éditeur complet. La décision produit du
 * 2026-08-25 en fait la route canonique unique ; `/dashboard/creer-simple`
 * redirige désormais ici, en conservant les paramètres d'URL.
 *
 * L'ancien éditeur n'est PAS supprimé : il est déplacé sous
 * `/dashboard/creer-avance`, hors du menu, tant que des fonctions encore
 * utilisées ailleurs (deeplink `?postId=X&tab=audio` du Calendrier) n'auront
 * pas été reprises ici. Le sélecteur « Mode simple / Mode avancé » a en
 * revanche disparu : il n'y a plus qu'un seul parcours proposé.
 *
 * Cette page reste un composant SERVEUR : seul le wizard, qui a besoin d'état,
 * est un composant client.
 */
export default function CreerPage() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* ── En-tête ──────────────────────────────────────────────────── */}
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

      {/* Corps : parcours a gauche, apercu a droite — tout est pilote par
          le wizard, qui doit partager son etat entre les deux colonnes. */}
      <AssistantWizard />
    </div>
  );
}
