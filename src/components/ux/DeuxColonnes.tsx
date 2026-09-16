'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * LA mise en page « travail à gauche, aperçu à droite » de Studiio — la même
 * pour Créer (choix, assistant, Autopilote) et Mon avatar (cahier UX §2.1).
 *
 * Trois éléments, trois jeux de classes, une seule implémentation :
 * - la grille : `grid grid-cols-1 lg:grid-cols-5 gap-6 items-start` ;
 * - la colonne travail : `lg:col-span-3 space-y-4` ;
 * - la colonne aperçu : `lg:col-span-2 lg:sticky lg:top-20`.
 *
 * `items-start` est ce qui rend le `sticky` opérant (sans lui la colonne
 * s'étire sur toute la hauteur et n'a plus rien à coller). `top-20` et non
 * `top-4` : la navbar est `fixed h-16`, un décalage plus court glissait le
 * haut de la carte sous cette barre.
 *
 * Règle d'aperçu (la cause du « haut coupé » corrigée ici) : AUCUN défilement
 * interne ni borne de hauteur en `vh` entre la colonne et le cadre. Un aperçu
 * plus haut que la fenêtre se voit en faisant défiler la PAGE ; une boîte à
 * défilement interne garde son `scrollTop` et masque le haut de l'aperçu.
 *
 * Sous `lg` : une colonne, ordre du DOM (travail puis aperçu), jamais de
 * `order-*`.
 *
 * `apercu={false}` : l'écran n'a PAS d'aperçu (le choix du mode de Créer
 * n'a rien à prévisualiser) — une seule colonne, centrée, la colonne
 * travail prend toute la largeur. L'appelant ne rend alors pas de
 * `ColonneApercu`.
 */

const PleineLargeur = createContext(false);

type Attributs = Record<`data-${string}`, string | undefined>;

export interface DeuxColonnesProps {
  /** Le nom de l'écran (`data-colonnes`). */
  nom: string;
  children: ReactNode;
  className?: string;
  attributs?: Attributs;
  /** `false` = pas de colonne d'aperçu : une seule colonne centrée. */
  apercu?: boolean;
}

export default function DeuxColonnes({ nom, children, className = '', attributs, apercu = true }: DeuxColonnesProps) {
  const grille = apercu
    ? 'grid grid-cols-1 lg:grid-cols-5 gap-6 items-start'
    : 'grid grid-cols-1 gap-6 items-start max-w-3xl mx-auto';
  return (
    <PleineLargeur.Provider value={!apercu}>
      <div data-colonnes={nom} data-apercu-colonne={apercu ? 'oui' : 'non'} {...(attributs ?? {})} className={`${grille} ${className}`}>
        {children}
      </div>
    </PleineLargeur.Provider>
  );
}

export function ColonneTravail({ children, className = '', attributs }: { children: ReactNode; className?: string; attributs?: Attributs }) {
  const pleine = useContext(PleineLargeur);
  return (
    <div data-colonne="travail" {...(attributs ?? {})} className={`${pleine ? '' : 'lg:col-span-3'} space-y-4 ${className}`}>
      {children}
    </div>
  );
}

export function ColonneApercu({ children, className = '', attributs }: { children: ReactNode; className?: string; attributs?: Attributs }) {
  return (
    <div data-colonne="apercu" {...(attributs ?? {})} className={`lg:col-span-2 lg:sticky lg:top-20 space-y-4 ${className}`}>
      {children}
    </div>
  );
}
