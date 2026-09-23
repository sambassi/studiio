'use client';

import { CardIcon } from '@/components/ui/CardIcon';
import { CARTE_LIMITES, type CarteTexte } from '@/lib/creer/selection';

export { CARTE_LIMITES };

/**
 * Édition du texte des cartes EXISTANTES — étape « Contenu » de Créer.
 *
 * Porté du `CardsRailPanel` de creer-avance (mises à jour par identifiant,
 * jamais par index), et volontairement RESTREINT : titre, valeur,
 * description. Pas d'ajout, pas de suppression, pas de duplication, pas
 * d'icône — ils arriveront quand les groupes et les icônes personnalisées
 * d'un post suivront l'ajout et la suppression (voir l'audit du portage).
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
}

const CHAMP = 'w-full rounded-lg border border-gray-800 bg-gray-950/60 px-2.5 py-1.5 text-sm text-white placeholder:text-gray-600 focus:border-purple-500/60 focus:outline-none';

export default function CartesEditeur({ cards, onChange, couleurValeur = '#C4B5FD' }: CartesEditeurProps) {
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
            <span>Carte {i + 1}</span>
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
    </div>
  );
}
