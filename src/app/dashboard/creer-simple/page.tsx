import Link from 'next/link';
import { Wand2, Rocket, Sparkles, SlidersHorizontal, MonitorPlay } from 'lucide-react';
import { Card, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Page Créer simplifiée (F5) — couche NON DESTRUCTIVE.
 *
 * Cette page est purement additive : elle ne remplace pas /dashboard/creer,
 * qui reste l'éditeur complet et n'est modifié en rien. Le bouton « Mode
 * avancé » y renvoie.
 *
 * Les deux parcours (Assistant, Autopilote) sont pour l'instant des maquettes
 * sans logique. Les boutons sont volontairement désactivés plutôt que de
 * simuler une action : rien ici ne doit laisser croire qu'un traitement a
 * démarré.
 *
 * Composant serveur : aucune interactivité n'est nécessaire, le toggle est un
 * simple lien.
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

      {/* ── Corps : parcours à gauche, aperçu à droite ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Colonne parcours */}
        <div className="lg:col-span-3 space-y-4">
          {/* Assistant guidé */}
          <Card className="transition" >
            <div className="flex items-start gap-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${BRAND}26`, color: '#C4B5FD' }}
              >
                <Wand2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg">Créer avec l&apos;assistant</CardTitle>
                <CardContent className="mt-1 text-sm text-gray-400">
                  On vous pose quelques questions — sujet, ton, format — et la vidéo se construit
                  toute seule. Vous gardez la main sur le résultat avant publication.
                </CardContent>
                <div className="mt-4">
                  <Button variant="primary" size="sm" disabled aria-disabled="true">
                    Commencer
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Autopilote */}
          <Card>
            <div className="flex items-start gap-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#EC489926', color: '#F9A8D4' }}
              >
                <Rocket className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-lg">Autopilote</CardTitle>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      backgroundColor: `${BRAND}33`,
                      color: '#DDD6FE',
                      boxShadow: `inset 0 0 0 1px ${BRAND}66`,
                    }}
                  >
                    Pro
                  </span>
                </div>
                <CardContent className="mt-1 text-sm text-gray-400">
                  Studiio produit et planifie vos contenus en continu à partir de vos objectifs.
                  Vous validez, il publie.
                </CardContent>
                <div className="mt-4">
                  <Button variant="secondary" size="sm" disabled aria-disabled="true">
                    Activer
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <p className="text-xs text-gray-600 italic px-1">
            Ces deux parcours arrivent. En attendant, l&apos;éditeur complet reste accessible via
            le mode avancé.
          </p>
        </div>

        {/* Colonne aperçu — conteneur vide, accueillera l'aperçu permanent */}
        <div className="lg:col-span-2">
          <div className="card-base p-4">
            <div className="flex items-center gap-2 mb-3">
              <MonitorPlay className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Aperçu
              </span>
            </div>

            {/* Placeholder au ratio 9:16 — le format par défaut de Studiio.
                Ratio en style inline : les classes Tailwind arbitraires du type
                aspect-[9/16] sont purgées en production (cf. CLAUDE.md). */}
            <div
              className="w-full rounded-xl border border-dashed border-gray-800 flex flex-col items-center justify-center gap-2 text-center px-4"
              style={{ aspectRatio: '9 / 16', backgroundColor: '#0A0A0F' }}
            >
              <MonitorPlay className="w-8 h-8 text-gray-700" />
              <p className="text-xs text-gray-600 leading-relaxed">
                Votre vidéo s&apos;affichera ici,
                <br />
                et se mettra à jour à chaque modification.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
