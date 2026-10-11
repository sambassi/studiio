'use client';

/**
 * Rangée d'actions au pied d'un panneau d'édition (Titre, Cartes, CTA,
 * Élément) : Dupliquer, Regrouper, Dissocier, Supprimer.
 *
 * ⚠️ AUCUNE LOGIQUE ICI. Chaque bouton appelle une fonction EXISTANTE de
 * l'éditeur (`duplicateSelection`, `groupSelection`, `ungroupSelection`…) :
 * cette rangée ne fait que les rendre trouvables là où l'on édite.
 *
 * Un bouton indisponible reste visible, grisé, et dit POURQUOI dans son
 * infobulle : un bouton grisé sans raison est une impasse.
 */
import type { LucideIcon } from 'lucide-react';

export interface ActionEdition {
  id: string;
  libelle: string;
  Icone: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Infobulle : ce que fait l'action, ou pourquoi elle est indisponible. */
  aide: string;
  danger?: boolean;
}

export default function ActionsEdition({ actions, nom }: { actions: ActionEdition[]; nom: string }) {
  if (actions.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={`Actions — ${nom}`}
      data-actions-edition={nom}
      className="flex flex-wrap items-center gap-1.5 border-t border-gray-800 pt-3"
    >
      {actions.map(({ id, libelle, Icone, onClick, disabled, aide, danger }) => (
        <button
          key={id}
          type="button"
          data-action-edition={id}
          onClick={onClick}
          disabled={disabled}
          title={aide}
          aria-label={`${libelle} — ${aide}`}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:cursor-not-allowed disabled:opacity-40 ${
            danger
              ? 'border-gray-800 text-gray-300 hover:border-red-500/60 hover:text-red-300'
              : 'border-gray-800 text-gray-300 hover:border-gray-700 hover:text-white'
          }`}
        >
          <Icone className="w-3.5 h-3.5" />
          {libelle}
        </button>
      ))}
    </div>
  );
}
