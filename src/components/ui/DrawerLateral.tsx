'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * LE TIROIR — LA OU VONT LES DETAILS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE N'EST PAS UNE MODALE DE PLUS, C'EST LE RECEPTACLE
 * ---------------------------------------------------------------------------
 *
 * L'ecran Autopilote grandira : LUT, texte, branding, voix. Chacune de ces
 * fonctions, posee sur la page principale, y ajouterait un panneau — et la
 * page redeviendrait ce qu'on vient de defaire. Le tiroir est l'endroit prevu
 * pour elles, decide MAINTENANT, pendant qu'il est vide et qu'il ne coute
 * rien.
 *
 * ⚠️ FERMER DOIT ETRE IMMEDIAT ET SANS PIEGE. `Escape` ferme, le voile ferme,
 * le focus revient d'ou il venait. Un tiroir dont on ne sort pas au clavier
 * est une impasse, pas un raffinement.
 */

interface Props {
  ouvert: boolean;
  titre: string;
  onFermer: () => void;
  children: React.ReactNode;
  marqueur?: string;
}

export default function DrawerLateral({
  ouvert, titre, onFermer, children, marqueur,
}: Props) {
  const panneauRef = useRef<HTMLDivElement>(null);
  const avantRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    avantRef.current = document.activeElement as HTMLElement;
    // Le panneau prend le focus : la suite de la navigation clavier part de
    // lui, et non du fond de page qu'on vient de recouvrir.
    panneauRef.current?.focus();
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('keydown', auClavier);
      avantRef.current?.focus?.();
    };
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  return (
    <div className="fixed inset-0 z-[60]" data-drawer={marqueur}>
      {/* Le voile. Sombre et discret : il eteint la page sans la cacher. */}
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={onFermer}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panneauRef}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col
          border-l border-white/10 bg-[#0d0d14] shadow-2xl focus:outline-none
          sm:max-w-lg"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="truncate text-sm font-medium text-gray-100">{titre}</h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer le panneau"
            title="Fermer"
            data-drawer-fermer
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400
              hover:bg-white/5 hover:text-white focus-visible:outline-none
              focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
