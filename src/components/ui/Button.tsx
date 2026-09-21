'use client';

/**
 * Bouton partagé de l'application.
 *
 * Style épuré : hauteur fine, contour de 0,5 px sur fond transparent pour les
 * actions secondaires, un seul aplat accent discret pour l'action principale.
 * Ni ombre ni dégradé. Les couleurs et le dessin vivent dans les classes
 * `.button-*` de `globals.css` (couche `components`), la géométrie ici — donc
 * un appelant qui passe `px-6`, `h-11` ou une couleur l'emporte toujours.
 *
 * ⚠️ Aucun prop existant n'a changé : `variant`, `size`, `disabled`,
 * `className` et tous les attributs de `<button>` se comportent comme avant.
 *
 * États d'interaction (`@/lib/ui/etats`) :
 *   - survol (élévation), appui (`active:`), focus clavier, désactivé : la
 *     composition SANS fond — les couleurs de survol/appui restent dans les
 *     classes `.button-*`, sinon un utilitaire violet écraserait la variante ;
 *   - `etat` : chargement (spinner + `aria-busy`, clic ignoré), succès (coche
 *     verte, revient seule au repos après `dureeSucces` ms puis `onEtatFin`),
 *     erreur (bordure rouge + triangle, jusqu'à ce que le parent la lève).
 *     Aucun de ces états ne prend le style « sélectionné » ;
 *   - `pressed` : usage bascule (`aria-pressed`) — SEUL cas où le bouton
 *     prend le style « sélectionné », avec une coche en plus de la couleur.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import {
  ETAT_INTERACTIF_SANS_FOND,
  ETAT_SELECTION,
  LIBELLE_ETAT,
  classesAction,
  type EtatAction,
} from '@/lib/ui/etats';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  /** État d'une action ponctuelle. Défaut `repos` : rendu identique à avant. */
  etat?: EtatAction;
  /** Durée d'affichage du succès avant retour au repos (ms). */
  dureeSucces?: number;
  /** Appelé quand le succès a fini de s'afficher — le parent remet `etat` à `repos`. */
  onEtatFin?: () => void;
  /** Bouton bascule : rend `aria-pressed` et le style « sélectionné » si vrai. */
  pressed?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  etat = 'repos',
  dureeSucces = 1500,
  onEtatFin,
  pressed,
  onClick,
  children,
  ...props
}: ButtonProps) {
  // Le succès est passager : affiché `dureeSucces` ms puis retour au repos,
  // même si le parent oublie de changer `etat`. Le parent est prévenu par
  // `onEtatFin` pour aligner son propre état.
  const [succesVisible, setSuccesVisible] = useState(false);
  useEffect(() => {
    if (etat !== 'succes') {
      setSuccesVisible(false);
      return;
    }
    setSuccesVisible(true);
    const t = setTimeout(() => {
      setSuccesVisible(false);
      onEtatFin?.();
    }, dureeSucces);
    return () => clearTimeout(t);
    // `onEtatFin` volontairement hors des deps : une fonction recréée à
    // chaque rendu du parent relancerait le compte à rebours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat, dureeSucces]);

  const etatAffiche: EtatAction = etat === 'succes' && !succesVisible ? 'repos' : etat;
  const chargement = etatAffiche === 'chargement';

  const variantClass = {
    primary: 'button-primary',
    secondary: 'button-secondary',
    // `ghost` avait son style écrit en dur ici, avec un dessin différent des
    // trois autres. Il suit maintenant la même famille de classes.
    ghost: 'button-ghost',
    accent: 'button-accent',
  }[variant];

  // Trois hauteurs : 28 / 34 / 40 px. `md` est la référence, `sm` sert aux
  // barres d'outils denses, `lg` aux appels à l'action isolés.
  // Tailles en valeurs arbitraires pour les trois : `text-sm` porte son propre
  // `line-height` et écraserait `leading-none`, ce qui rendait la hauteur de
  // `lg` imprévisible dès qu'un appelant ajoutait du padding.
  const sizeClass = {
    sm: 'min-h-[28px] px-2.5 text-[12px]',
    md: 'min-h-[34px] px-3.5 text-[13px]',
    lg: 'min-h-[40px] px-5 text-[14px]',
  }[size];

  // Les classes d'état viennent AVANT `className` : l'appelant garde le
  // dernier mot (contrat vérifié par `button-premium.test.tsx`).
  const etatClass = [
    ETAT_INTERACTIF_SANS_FOND,
    classesAction(etatAffiche),
    pressed ? ETAT_SELECTION : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Icône d'état à gauche du libellé, doublée d'un texte pour les lecteurs
  // d'écran : la forme (spinner / coche / triangle) porte l'information,
  // la couleur ne fait que la renforcer.
  const icone = { className: 'mr-1.5 h-3.5 w-3.5 shrink-0', 'aria-hidden': true } as const;
  const marqueur =
    etatAffiche === 'chargement' ? <Loader2 {...icone} className={`${icone.className} animate-spin`} data-etat-icone="chargement" />
    : etatAffiche === 'succes' ? <Check {...icone} data-etat-icone="succes" />
    : etatAffiche === 'erreur' ? <AlertTriangle {...icone} data-etat-icone="erreur" />
    : pressed ? <Check {...icone} data-etat-icone="selection" />
    : null;

  return (
    <button
      className={`${variantClass} ${sizeClass} ${etatClass} ${className}`}
      data-etat={etatAffiche}
      aria-busy={chargement || undefined}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-selected={pressed ? 'true' : undefined}
      // Un clic pendant le chargement relancerait l'action : on l'ignore sans
      // passer par `disabled`, qui grise le bouton et lui retire le focus.
      onClick={chargement ? undefined : onClick}
      {...props}
    >
      {marqueur}
      {etatAffiche !== 'repos' && <span className="sr-only">{LIBELLE_ETAT[etatAffiche]}</span>}
      {children}
    </button>
  );
}
