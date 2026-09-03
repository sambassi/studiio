'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * LE MENU « ⋯ » — UNE ACTION SECONDAIRE NE PREND PAS DE PLACE.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE COMPOSANT EXISTE
 * ---------------------------------------------------------------------------
 *
 * L'ecran Autopilote posait chaque action rare en bouton permanent : relancer
 * une analyse, enregistrer un defaut, retirer un rush. Trois rushes faisaient
 * donc trois fois ces boutons, et la page devenait un formulaire. Le principe
 * retenu est l'inverse : ESSENTIEL VISIBLE, DETAILS A LA DEMANDE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ IL EST ACCESSIBLE, ET CE N'EST PAS DECORATIF
 * ---------------------------------------------------------------------------
 *
 * Un « ⋯ » qui ne s'ouvre qu'a la souris cache la fonction a qui navigue au
 * clavier — c'est-a-dire qu'il la SUPPRIME pour cette personne. Le declencheur
 * est donc un vrai `button` avec `aria-haspopup`/`aria-expanded`, le panneau
 * est un `role="menu"` dont chaque entree est un `role="menuitem"`, la
 * premiere entree prend le focus a l'ouverture, les fleches circulent, et
 * `Escape` ferme en rendant le focus au declencheur.
 */

export interface ActionMenu {
  /** Le libelle lu et affiche. Jamais une icone seule. */
  libelle: string;
  onClick: () => void;
  /** Grise l'entree sans la retirer : la fonction existe, elle n'est pas prete. */
  desactive?: boolean;
  /** Signale une action destructrice ; teinte le libelle. */
  danger?: boolean;
  icone?: React.ReactNode;
}

interface Props {
  /** Ce que le bouton fait, dit en toutes lettres pour les lecteurs d'ecran. */
  etiquette: string;
  actions: ActionMenu[];
  /** Aligne le panneau a droite du declencheur (defaut) ou a gauche. */
  cote?: 'droite' | 'gauche';
  /** Attribut de test, pose sur le declencheur. */
  marqueur?: string;
  compact?: boolean;
}

export default function MenuActions({
  etiquette, actions, cote = 'droite', marqueur, compact,
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const racineRef = useRef<HTMLDivElement>(null);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const panneauRef = useRef<HTMLDivElement>(null);
  const idPanneau = useId();

  const fermer = useCallback((rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) declencheurRef.current?.focus();
  }, []);

  // Un clic ailleurs ferme. Le `mousedown` plutot que le `click` : sinon le
  // clic qui ferme active aussi ce qui se trouve dessous.
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      if (!racineRef.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  // ⚠️ LE FOCUS ENTRE DANS LE MENU. Sans cela, `Tab` continuerait derriere le
  // panneau et l'utilisateur clavier perdrait de vue ce qu'il vient d'ouvrir.
  useEffect(() => {
    if (!ouvert) return;
    const premier = panneauRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    premier?.focus();
  }, [ouvert]);

  const naviguer = (e: React.KeyboardEvent, sens: 1 | -1) => {
    e.preventDefault();
    const entrees = Array.from(
      panneauRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (entrees.length === 0) return;
    const i = entrees.indexOf(document.activeElement as HTMLButtonElement);
    const suivant = (i + sens + entrees.length) % entrees.length;
    entrees[suivant].focus();
  };

  return (
    <div ref={racineRef} className="relative shrink-0">
      <button
        ref={declencheurRef}
        type="button"
        aria-label={etiquette}
        title={etiquette}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idPanneau : undefined}
        data-menu-actions={marqueur}
        onClick={() => setOuvert((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOuvert(true);
          }
        }}
        className={`inline-flex items-center justify-center rounded-md text-gray-400
          hover:text-white hover:bg-white/5 focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors
          ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}
      >
        <MoreHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
      </button>

      {ouvert && (
        <div
          ref={panneauRef}
          id={idPanneau}
          role="menu"
          aria-label={etiquette}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); fermer(true); }
            else if (e.key === 'ArrowDown') naviguer(e, 1);
            else if (e.key === 'ArrowUp') naviguer(e, -1);
          }}
          className={`absolute z-50 mt-1 min-w-[11rem] overflow-hidden rounded-lg border
            border-white/10 bg-[#12121a]/95 py-1 shadow-xl backdrop-blur
            ${cote === 'droite' ? 'right-0' : 'left-0'}`}
        >
          {actions.map((a) => (
            <button
              key={a.libelle}
              type="button"
              role="menuitem"
              disabled={a.desactive}
              onClick={() => { fermer(false); a.onClick(); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]
                transition-colors focus-visible:outline-none disabled:opacity-40
                ${a.danger
                  ? 'text-gray-300 hover:bg-white/5 hover:text-rose-300 focus:bg-white/5 focus:text-rose-300'
                  : 'text-gray-300 hover:bg-white/5 hover:text-white focus:bg-white/5 focus:text-white'}`}
            >
              {a.icone && <span className="shrink-0 opacity-70" aria-hidden="true">{a.icone}</span>}
              {a.libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
