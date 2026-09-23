'use client';

import { useId, useRef, useState } from 'react';
import { Search, Shapes } from 'lucide-react';
import { CardIcon } from '@/components/ui/CardIcon';
import { ICON_KEYWORDS, ICON_LIBRARY, iconMatches } from '@/lib/icons/library';

/**
 * L'info-bulle d'une icône, en français. Le nom lucide est anglais
 * (« Dumbbell ») : on montre le premier synonyme français quand il existe,
 * sinon le nom tel quel — toujours précédé de la consigne.
 */
function libelleIcone(nom: string): string {
  return `Choisir l’icône « ${ICON_KEYWORDS[nom]?.[0] ?? nom} »`;
}

/**
 * Le choix d'une icône — la grille catégorisée, avec recherche.
 *
 * ⚠️ EXTRAIT, PAS RECOPIÉ. Ce bloc vivait en dur dans l'assistant (« Ajouter
 * un élément ») ; l'Autopilote en a besoin pour choisir l'icône d'une carte.
 * Le dépôt a déjà payé le prix du picker dupliqué : deux grilles de photos
 * dans `/creer` s'étaient désynchronisées, et l'utilisateur croyait
 * sélectionner ce qui n'était pas mémorisé (cf. `tasks/lessons.md`,
 * 2026-05-01). Une seule grille, deux appelants.
 *
 * ⚠️ SVG LUCIDE UNIQUEMENT, JAMAIS D'EMOJI. La règle du dépôt est absolue, et
 * elle tient ici par construction : les noms viennent de `ICON_LIBRARY` et se
 * résolvent par `CardIcon` / `ICON_MAP`.
 *
 * `repliable` (défaut false) : le composant porte alors son propre bouton
 * d'ouverture (aria-expanded / aria-controls) et Échap referme la grille en
 * rendant le focus au bouton. Sans lui, rendu identique à avant : les
 * appelants actuels gèrent eux-mêmes leur panneau.
 */
export default function IconPicker({ onPick, selected, dense = false, autoFocus = false, repliable = false }: {
  onPick: (name: string) => void;
  /** Icône déjà retenue — mise en évidence dans la grille. */
  selected?: string | null;
  /** Grille plus serrée, pour un panneau flottant étroit. */
  dense?: boolean;
  autoFocus?: boolean;
  /** Grille repliée derrière un bouton d'ouverture, fermée par Échap. */
  repliable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [ouvert, setOuvert] = useState(!repliable);
  const grilleId = useId();
  const ouvreurRef = useRef<HTMLButtonElement>(null);
  const rienNeCorrespond = Object.values(ICON_LIBRARY).flat().every((n) => !iconMatches(n, query));

  const grille = (
    <div
      id={grilleId}
      data-icon-picker-grid
      className={repliable ? 'mt-2' : undefined}
      onKeyDown={repliable ? (e) => {
        if (e.key !== 'Escape') return;
        // La grille peut vivre dans un panneau qui écoute lui aussi Échap :
        // on ne referme que la grille, pas le panneau entier.
        e.stopPropagation();
        setOuvert(false);
        ouvreurRef.current?.focus();
      } : undefined}
    >
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une icône…"
          aria-label="Rechercher une icône"
          title="Rechercher une icône (nom ou mot-clé en français)"
          data-icon-search
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none pl-8 pr-2.5 py-2 text-sm"
        />
      </div>
      <div className={`mt-3 overflow-y-auto space-y-3 ${dense ? 'max-h-48' : 'max-h-64'}`}>
        {Object.entries(ICON_LIBRARY).map(([categorie, noms]) => {
          // Une categorie dont aucune icone ne correspond disparait : laisser
          // un titre seul ferait croire a un panneau casse.
          const retenues = noms.filter((n) => iconMatches(n, query));
          if (retenues.length === 0) return null;
          return (
            <div key={categorie}>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
                {categorie}
              </p>
              <div className={`grid gap-1 ${dense ? 'grid-cols-6' : 'grid-cols-8'}`}>
                {retenues.map((nom) => (
                  <button
                    key={nom}
                    type="button"
                    onClick={() => onPick(nom)}
                    data-element-pick={nom}
                    aria-pressed={selected === nom}
                    aria-label={libelleIcone(nom)}
                    title={libelleIcone(nom)}
                    className={`flex items-center justify-center rounded-lg border py-2 transition-colors ${
                      selected === nom
                        ? 'border-purple-500 text-white bg-gray-800'
                        : 'border-gray-800 text-gray-300 hover:text-white hover:border-purple-500'
                    }`}
                  >
                    <CardIcon name={nom} size={16} color="currentColor" className="" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {rienNeCorrespond && (
          <p className="text-xs text-gray-500 text-center py-4">Aucune icône pour « {query} ».</p>
        )}
      </div>
    </div>
  );

  if (!repliable) return grille;

  return (
    <div>
      <button
        ref={ouvreurRef}
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-controls={grilleId}
        title={ouvert ? 'Masquer les icônes (Échap)' : 'Afficher les icônes'}
        data-icon-picker-toggle
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
      >
        <Shapes className="w-3.5 h-3.5" />
        {ouvert ? 'Masquer les icônes' : 'Choisir une icône'}
      </button>
      {ouvert && grille}
    </div>
  );
}
