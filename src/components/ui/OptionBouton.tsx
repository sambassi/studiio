'use client';

/**
 * Option sélectionnable (choix persistant parmi plusieurs : filtre, style,
 * transition, intention…).
 *
 * Trois signaux redondants disent « c'est celle-ci » — jamais la couleur
 * seule : le fond/anneau violet (`ETAT_SELECTION`), une COCHE à gauche du
 * libellé, et `aria-pressed` pour les technologies d'assistance. La coche
 * réserve toujours sa place (invisible au repos) pour que la sélection ne
 * fasse pas sauter la mise en page.
 *
 * Contrairement au `<Button etat>`, l'état ici est PERSISTANT : c'est le
 * composant à employer pour une option, pas pour une action.
 */
import { Check } from 'lucide-react';
import { classesOption } from '@/lib/ui/etats';

interface OptionBoutonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  selected: boolean;
  onSelect?: () => void;
  /** Icône propre à l'option, rendue avant le libellé (après la coche). */
  icone?: React.ReactNode;
  children: React.ReactNode;
}

export function OptionBouton({
  selected,
  onSelect,
  icone,
  className = '',
  children,
  onClick,
  ...props
}: OptionBoutonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected ? 'true' : undefined}
      className={`${classesOption(selected)} ${className}`}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelect?.();
      }}
      {...props}
    >
      <Check
        aria-hidden
        data-coche={selected ? 'visible' : 'reservee'}
        className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-150 ${selected ? 'opacity-100' : 'opacity-0'}`}
      />
      {icone}
      {children}
    </button>
  );
}

export default OptionBouton;
