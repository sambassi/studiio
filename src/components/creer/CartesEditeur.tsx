'use client';

import { Plus, Trash2 } from 'lucide-react';
import { CardIcon } from '@/components/ui/CardIcon';
import { CARTE_LIMITES, type CarteTexte } from '@/lib/creer/selection';

export { CARTE_LIMITES };

/**
 * Édition du texte des cartes EXISTANTES — étape « Contenu » de Créer.
 *
 * Porté du `CardsRailPanel` de creer-avance (mises à jour par identifiant,
 * jamais par index) : titre, valeur, description — et, quand le parent les
 * fournit, AJOUT et SUPPRESSION (PR 2). Ces deux-là ne sont sûrs que parce
 * que l'identifiant des cartes est désormais persisté (groupes stables) et
 * que les icônes personnalisées sont réalignées à l'enregistrement. Pas de
 * duplication ici (elle existe sous l'aperçu), pas d'icône.
 *
 * Le composant n'a aucun état : chaque saisie remonte `(id, champ)` et le
 * parent (l'assistant) met à jour `generated.cards` — l'aperçu, la voix des
 * cartes et l'enregistrement lisent tous cette même source.
 */

interface CarteEditable extends CarteTexte {
  id: string;
  icon: string;
}

export interface CartesEditeurProps {
  cards: CarteEditable[];
  onChange: (id: string, patch: Partial<CarteTexte>) => void;
  /** Couleur de la valeur, comme dans l'aperçu. */
  couleurValeur?: string;
  /** Ajout d'une carte vide. Absent : aucun bouton d'ajout. */
  onAdd?: () => void;
  /** Suppression d'une carte. Absent : aucun bouton de suppression. */
  onRemove?: (id: string) => void;
  /** Faux au maximum du format : le bouton reste visible, désactivé, et dit pourquoi. */
  canAdd?: boolean;
  /** Faux s'il ne reste qu'une carte. */
  canRemove?: boolean;
  /** Nombre maximal de cartes du format, pour le libellé. */
  max?: number;
}

const CHAMP = 'w-full rounded-lg border border-gray-800 bg-gray-950/60 px-2.5 py-1.5 text-sm text-white placeholder:text-gray-600 focus:border-purple-500/60 focus:outline-none';

export default function CartesEditeur({
  cards, onChange, couleurValeur = '#C4B5FD', onAdd, onRemove, canAdd = true, canRemove = true, max,
}: CartesEditeurProps) {
  return (
    <div className="space-y-2" data-cartes-editeur>
      {cards.map((c, i) => (
        <div
          key={c.id}
          data-carte-editeur={c.id}
          className="rounded-xl bg-gray-900/60 p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
            <CardIcon name={c.icon} size={14} color="#C4B5FD" className="" />
            <span className="flex-1">Carte {i + 1}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                disabled={!canRemove}
                aria-label={`Supprimer la carte ${i + 1}`}
                title={canRemove ? `Supprimer la carte ${i + 1}` : 'Il faut garder au moins une carte'}
                data-carte-supprimer={c.id}
                className="rounded p-1 text-gray-500 normal-case tracking-normal hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block min-w-0">
              <span className="sr-only">Titre de la carte {i + 1}</span>
              <input
                type="text"
                data-carte-champ="title"
                value={c.title}
                maxLength={CARTE_LIMITES.title}
                placeholder="Titre"
                onChange={(e) => onChange(c.id, { title: e.target.value })}
                className={`${CHAMP} font-medium`}
              />
            </label>
            <label className="block w-24">
              <span className="sr-only">Valeur de la carte {i + 1}</span>
              <input
                type="text"
                data-carte-champ="value"
                value={c.value}
                maxLength={CARTE_LIMITES.value}
                placeholder="ex : +30 %"
                onChange={(e) => onChange(c.id, { value: e.target.value })}
                className={`${CHAMP} font-bold text-right`}
                style={{ color: couleurValeur }}
              />
            </label>
          </div>
          <label className="block">
            <span className="sr-only">Description de la carte {i + 1}</span>
            <textarea
              data-carte-champ="description"
              value={c.description}
              maxLength={CARTE_LIMITES.description}
              rows={2}
              placeholder="Description"
              onChange={(e) => onChange(c.id, { description: e.target.value })}
              className={`${CHAMP} text-xs resize-none`}
            />
          </label>
        </div>
      ))}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          data-carte-ajouter
          title={canAdd ? 'Ajouter une carte vide' : `Maximum de ${max ?? cards.length} cartes atteint dans ce format`}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-700 py-2 text-xs text-gray-300 hover:border-purple-500/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} />
          Ajouter une carte
        </button>
      )}
      {onAdd && !canAdd && (
        <p className="text-center text-[11px] text-gray-500" data-carte-maximum>
          Maximum de {max ?? cards.length} cartes atteint dans ce format.
        </p>
      )}
    </div>
  );
}
