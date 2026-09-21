'use client';

/**
 * Onglets accessibles (`role="tablist"` / `role="tab"`).
 *
 * L'onglet actif se reconnaît à TROIS signaux : fond violet doux + anneau
 * (`ETAT_SELECTION`), une BARRE sous l'onglet (forme, pas couleur) et
 * `aria-selected`. La sélection est persistante : elle ne dépend d'aucun
 * survol ni focus.
 *
 * Clavier (activation automatique, pattern WAI-ARIA « Tabs ») : ←/→ passent
 * à l'onglet voisin (en boucle), Début/Fin aux extrémités ; seul l'onglet
 * actif est dans l'ordre de tabulation (`tabIndex 0`), les autres à -1, donc
 * Tab sort du groupe au lieu de le parcourir.
 */
import { useRef } from 'react';
import { classesOnglet } from '@/lib/ui/etats';

export interface Onglet {
  id: string;
  label: React.ReactNode;
  icone?: React.ReactNode;
  disabled?: boolean;
  /** `id` du panneau associé, pour `aria-controls`. */
  panneauId?: string;
}

interface OngletsProps {
  onglets: Onglet[];
  actif: string;
  onChange: (id: string) => void;
  /** Intitulé du groupe pour les lecteurs d'écran. */
  label?: string;
  className?: string;
}

export function Onglets({ onglets, actif, onChange, label, className = '' }: OngletsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const actifs = onglets.filter((o) => !o.disabled);

  const aller = (depuis: string, delta: number | 'debut' | 'fin') => {
    if (actifs.length === 0) return;
    const i = Math.max(0, actifs.findIndex((o) => o.id === depuis));
    const cible =
      delta === 'debut' ? actifs[0]
      : delta === 'fin' ? actifs[actifs.length - 1]
      : actifs[(i + delta + actifs.length) % actifs.length];
    onChange(cible.id);
    refs.current[onglets.findIndex((o) => o.id === cible.id)]?.focus();
  };

  const auClavier = (id: string) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const touches: Record<string, number | 'debut' | 'fin'> = {
      ArrowRight: 1, ArrowLeft: -1, Home: 'debut', End: 'fin',
    };
    const delta = touches[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    aller(id, delta);
  };

  return (
    <div role="tablist" aria-label={label} className={`inline-flex items-center gap-1 ${className}`}>
      {onglets.map((o, i) => {
        const selected = o.id === actif;
        return (
          <button
            key={o.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`onglet-${o.id}`}
            aria-selected={selected}
            aria-controls={o.panneauId}
            data-selected={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            className={`${classesOnglet(selected)} pb-2`}
            onClick={() => onChange(o.id)}
            onKeyDown={auClavier(o.id)}
          >
            {o.icone}
            {o.label}
            {/* Barre sous l'onglet actif — le marqueur de forme. */}
            <span
              aria-hidden
              data-barre={selected ? 'visible' : 'masquee'}
              className={`pointer-events-none absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-purple-400 transition-opacity duration-150 ${selected ? 'opacity-100' : 'opacity-0'}`}
            />
          </button>
        );
      })}
    </div>
  );
}

export default Onglets;
