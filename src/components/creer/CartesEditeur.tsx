'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Combine, ImageIcon, Plus, Trash2, Ungroup } from 'lucide-react';
import { CardIcon } from '@/components/ui/CardIcon';
import IconPicker from '@/components/creer/IconPicker';
import {
  CARTE_LIMITES, MIN_GROUP, blocsCartes, groupOf, type CardGroup, type CarteTexte,
} from '@/lib/creer/selection';

export { CARTE_LIMITES };

/**
 * Édition du texte des cartes EXISTANTES — étape « Contenu » de Créer.
 *
 * Porté du `CardsRailPanel` de creer-avance (mises à jour par identifiant,
 * jamais par index) : titre, valeur, description — et, quand le parent les
 * fournit, AJOUT et SUPPRESSION (PR 2). Ces deux-là ne sont sûrs que parce
 * que l'identifiant des cartes est désormais persisté (groupes stables) et
 * que les icônes personnalisées sont réalignées à l'enregistrement. Et, si le
 * parent fournit `onIconChange`, le CHOIX DE L'ICÔNE (PR 3) — par la grille
 * partagée `IconPicker`, donc SVG lucide uniquement. Pas de duplication ici
 * (elle existe sous l'aperçu).
 *
 * Seul état local : quelle carte a sa grille d'icônes ouverte. Chaque saisie
 * remonte `(id, champ)` et le
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
  /** Choix de l'icône (nom lucide). Absent : aucun bouton d'icône. */
  onIconChange?: (id: string, icon: string) => void;
  /**
   * Cartes dont une IMAGE personnalisée (`design.cardCustomIcons`, éditeur
   * avancé) s'affiche à la place de l'icône dans le Calendrier : on le dit,
   * plutôt que de laisser croire que l'icône choisie y apparaîtra.
   */
  iconesMasquees?: ReadonlySet<string>;
  /**
   * SÉLECTION, GROUPES ET ORDRE. Tout est optionnel : absent, la liste est
   * celle d'avant, sans case ni flèche.
   *
   * La sélection est CELLE de l'assistant (`selectedCards`) — la même que
   * l'aperçu : cocher ici, c'est sélectionner là-bas.
   */
  selection?: ReadonlySet<string>;
  /** Coche / décoche une carte (le parent étend au groupe). */
  onToggleSelect?: (id: string) => void;
  /** Groupes courants : leurs membres consécutifs sont encadrés ensemble. */
  groups?: CardGroup[];
  /** Regrouper la sélection (≥ 2 cartes). */
  onRegrouper?: () => void;
  /** Dissocier les groupes touchés par la sélection — l'ordre ne bouge pas. */
  onDissocier?: () => void;
  /** Monter (-1) ou descendre (+1) un bloc entier : carte seule ou groupe. */
  onMoveBloc?: (blocId: string, delta: number) => void;
}

const FLECHE = 'rounded p-1 text-gray-500 normal-case tracking-normal hover:bg-studiio-primary/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30';

const CHAMP = 'w-full rounded-lg border border-gray-800 bg-gray-950/60 px-2.5 py-1.5 text-sm text-white placeholder:text-gray-600 focus:border-purple-500/60 focus:outline-none';

export default function CartesEditeur({
  cards, onChange, couleurValeur = '#C4B5FD', onAdd, onRemove, canAdd = true, canRemove = true, max,
  onIconChange, iconesMasquees, selection, onToggleSelect, groups = [], onRegrouper, onDissocier, onMoveBloc,
}: CartesEditeurProps) {
  /** La carte dont la grille d'icônes est ouverte — une seule à la fois. */
  const [iconeOuverte, setIconeOuverte] = useState<string | null>(null);
  /** Ordre du tableau = ordre affiché = ordre de lecture de la voix. */
  const blocs = blocsCartes(cards, groups);
  const rang = new Map(cards.map((c, i) => [c.id, i]));
  const parId = new Map(cards.map((c) => [c.id, c]));
  const nbSelection = selection ? cards.filter((c) => selection.has(c.id)).length : 0;
  const selectionGroupee = !!selection && cards.some((c) => selection.has(c.id) && !!groupOf(groups, c.id));

  /** Flèches d'un bloc ; absentes sans `onMoveBloc`. */
  const fleches = (blocId: string, k: number, quoi: string) => onMoveBloc && (
    <>
      <button
        type="button"
        onClick={() => onMoveBloc(blocId, -1)}
        disabled={k === 0}
        aria-label={`Monter ${quoi}`}
        title={`Monter ${quoi}`}
        data-bloc-monter={blocId}
        className={FLECHE}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => onMoveBloc(blocId, 1)}
        disabled={k === blocs.length - 1}
        aria-label={`Descendre ${quoi}`}
        title={`Descendre ${quoi}`}
        data-bloc-descendre={blocId}
        className={FLECHE}
      >
        <ChevronDown size={14} />
      </button>
    </>
  );

  const rendreCarte = (c: CarteEditable, blocSeul: { id: string; k: number } | null) => {
    const i = rang.get(c.id) ?? 0;
    return (
        <div
          key={c.id}
          data-carte-editeur={c.id}
          className="rounded-xl bg-gray-900/60 p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={!!selection?.has(c.id)}
                onChange={() => onToggleSelect(c.id)}
                aria-label={`Sélectionner la carte ${i + 1}`}
                data-carte-selection={c.id}
                className="h-3.5 w-3.5 cursor-pointer accent-studiio-primary"
              />
            )}
            {onIconChange ? (
              <button
                type="button"
                onClick={() => setIconeOuverte((o) => (o === c.id ? null : c.id))}
                aria-label={`Changer l’icône de la carte ${i + 1}`}
                aria-expanded={iconeOuverte === c.id}
                title="Changer l’icône"
                data-carte-icone={c.id}
                className={`rounded-md border p-1 transition-colors ${
                  iconeOuverte === c.id ? 'border-purple-500 bg-gray-800' : 'border-gray-800 hover:border-purple-500/60'
                }`}
              >
                <CardIcon name={c.icon} size={14} color="#C4B5FD" className="" />
              </button>
            ) : (
              <CardIcon name={c.icon} size={14} color="#C4B5FD" className="" />
            )}
            <span className="flex-1">Carte {i + 1}</span>
            {blocSeul && fleches(blocSeul.id, blocSeul.k, `la carte ${i + 1}`)}
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
          {onIconChange && iconeOuverte === c.id && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-2" data-carte-icone-grille={c.id}>
              <IconPicker
                dense
                autoFocus
                selected={c.icon}
                onPick={(nom) => {
                  onIconChange(c.id, nom);
                  setIconeOuverte(null);
                }}
              />
            </div>
          )}
          {iconesMasquees?.has(c.id) && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-200/90" data-carte-icone-masquee>
              <ImageIcon size={12} className="mt-0.5 flex-shrink-0" />
              Cette carte a une image personnalisée : dans le Calendrier, elle s’affiche à la place de l’icône.
            </p>
          )}
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
    );
  };

  return (
    <div className="space-y-2" data-cartes-editeur>
      {onToggleSelect && (onRegrouper || onDissocier) && (
        <div className="flex flex-wrap items-center gap-1.5" data-cartes-outils>
          <span className="flex-1 text-[11px] text-gray-400">
            {nbSelection === 0
              ? 'Cochez des cartes pour les regrouper'
              : `${nbSelection} carte${nbSelection > 1 ? 's' : ''} sélectionnée${nbSelection > 1 ? 's' : ''}`}
          </span>
          {onRegrouper && (
            <button
              type="button"
              onClick={onRegrouper}
              disabled={nbSelection < MIN_GROUP}
              title={nbSelection < MIN_GROUP ? 'Sélectionnez au moins deux cartes' : 'Regrouper les cartes sélectionnées'}
              data-cartes-regrouper
              className="button-ghost gap-1.5 text-xs"
            >
              <Combine size={14} />
              Regrouper
            </button>
          )}
          {onDissocier && (
            <button
              type="button"
              onClick={onDissocier}
              disabled={!selectionGroupee}
              title={selectionGroupee ? 'Séparer les cartes de leur groupe' : 'Sélectionnez une carte d’un groupe'}
              data-cartes-dissocier
              className="button-ghost gap-1.5 text-xs"
            >
              <Ungroup size={14} />
              Dissocier
            </button>
          )}
        </div>
      )}
      {blocs.map((b, k) => {
        const membres = b.cardIds.map((id) => parId.get(id)!).filter(Boolean);
        if (!b.groupId) return rendreCarte(membres[0], { id: b.id, k });
        return (
          <div
            key={b.id}
            data-carte-groupe={b.groupId}
            data-bloc={b.id}
            className="space-y-2 rounded-xl border border-studiio-primary/40 bg-studiio-primary/5 p-2"
          >
            <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-gray-400">
              <Combine size={12} className="text-studiio-primary" />
              <span className="flex-1">Groupe · {membres.length} cartes</span>
              {fleches(b.id, k, 'le groupe')}
            </div>
            {membres.map((c) => rendreCarte(c, null))}
          </div>
        );
      })}
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
