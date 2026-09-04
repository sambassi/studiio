'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE PANNEAU SORT DU FLUX, ET CE N'EST PAS UN DETAIL DE STYLE
 * ---------------------------------------------------------------------------
 *
 * La bande de rushes defile horizontalement : elle est en `overflow-x-auto`.
 * Un panneau `absolute` rendu DEDANS s'y fait donc rogner — en production, le
 * menu d'un rush affichait « ir l'analyse » au lieu de « Voir l'analyse ».
 * Mettre le conteneur en `overflow: visible` reglerait l'affichage en cassant
 * le defilement, c'est-a-dire en echangeant un defaut contre un pire.
 *
 * Le panneau est donc rendu dans `document.body` par un portail, positionne
 * en `fixed` a partir du rectangle du declencheur. Il passe au-dessus de
 * tout, ne depend d'aucun `overflow` parent, et se recale au defilement comme
 * au redimensionnement. Il se replie aussi vers l'interieur quand il
 * toucherait un bord de la fenetre.
 */

/** La largeur du panneau. Connue avant la mesure, pour le premier placement. */
const LARGEUR_MENU = 176;

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
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const racineRef = useRef<HTMLDivElement>(null);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const panneauRef = useRef<HTMLDivElement>(null);
  const idPanneau = useId();

  const fermer = useCallback((rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) declencheurRef.current?.focus();
  }, []);

  /**
   * Place le panneau sous le declencheur, en le rentrant dans la fenetre.
   *
   * ⚠️ `useLayoutEffect` : mesurer apres la peinture ferait apparaitre le
   * menu a (0,0) le temps d'une image.
   */
  const placer = useCallback(() => {
    const d = declencheurRef.current?.getBoundingClientRect();
    if (!d) return;
    const largeur = panneauRef.current?.offsetWidth ?? LARGEUR_MENU;
    const hauteur = panneauRef.current?.offsetHeight ?? 0;
    const marge = 8;
    let left = cote === 'droite' ? d.right - largeur : d.left;
    left = Math.min(Math.max(marge, left), window.innerWidth - largeur - marge);
    let top = d.bottom + 4;
    // Pas de place en dessous : on ouvre vers le haut plutot que hors ecran.
    if (hauteur > 0 && top + hauteur > window.innerHeight - marge) {
      top = Math.max(marge, d.top - hauteur - 4);
    }
    setPosition({ top, left });
  }, [cote]);

  useLayoutEffect(() => {
    if (!ouvert) { setPosition(null); return undefined; }
    placer();
    // La bande defile, la page aussi : le panneau suit son declencheur.
    window.addEventListener('scroll', placer, true);
    window.addEventListener('resize', placer);
    return () => {
      window.removeEventListener('scroll', placer, true);
      window.removeEventListener('resize', placer);
    };
  }, [ouvert, placer]);

  // Un clic ailleurs ferme. Le `mousedown` plutot que le `click` : sinon le
  // clic qui ferme active aussi ce qui se trouve dessous.
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node;
      // ⚠️ LE PANNEAU N'EST PLUS UN DESCENDANT DE LA RACINE : depuis le
      // portail, `racineRef.contains` ne le couvre plus, et cliquer DANS le
      // menu le fermait avant que l'entree ne recoive le clic.
      if (racineRef.current?.contains(cible)) return;
      if (panneauRef.current?.contains(cible)) return;
      setOuvert(false);
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

      {ouvert && createPortal((
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
          data-menu-panneau={marqueur}
          style={{
            position: 'fixed',
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            minWidth: LARGEUR_MENU,
            visibility: position ? 'visible' : 'hidden',
          }}
          className="z-[70] overflow-hidden rounded-lg border border-white/10
            bg-[#12121a]/95 py-1 shadow-xl backdrop-blur"
        >
          {actions.map((a) => (
            <button
              key={a.libelle}
              type="button"
              role="menuitem"
              disabled={a.desactive}
              /**
               * ⚠️ LE FOCUS REVIENT AU « ⋯ » AVANT D'EXECUTER L'ACTION.
               *
               * Une entree qui ouvre un tiroir se demonte aussitot. Le tiroir,
               * lui, memorise `document.activeElement` pour le rendre a la
               * fermeture : s'il memorisait cette entree, il rendrait le focus
               * a un noeud disparu — et le focus retombait sur `<body>`.
               * Constate en production le 2026-09-04. En rendant le focus au
               * declencheur D'ABORD, ce que le tiroir memorise est un bouton
               * qui, lui, existe encore quand on referme.
               */
              onClick={() => { fermer(true); a.onClick(); }}
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
      ), document.body)}
    </div>
  );
}
