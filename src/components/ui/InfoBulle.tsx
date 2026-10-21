'use client';

/**
 * InfoBulle — le DÉTAIL À LA DEMANDE (docs/UX-PREMIUM.md, règles 5 et 6).
 *
 * Une petite icône `Info` ouvre un popover léger : les explications longues,
 * le fonctionnement, les précisions techniques y vivent au lieu d'encombrer
 * l'écran en permanence.
 *
 * Accessibilité :
 *  - bouton avec `aria-label`, `aria-expanded`, `aria-controls` ;
 *  - ouverture au clic / tap, à `Entrée` et à `Espace` ;
 *  - fermeture par le bouton « Fermer », `Échap` (le focus revient sur
 *    l'icône) et un clic / tap à l'extérieur ;
 *  - à l'ouverture, le focus passe dans le panneau.
 *
 * Tout est en `<span>` : l'icône se pose dans un titre ou un paragraphe
 * sans imbrication HTML invalide. Le contenu passé doit l'être aussi
 * (`<span className="block">` plutôt que `<p>`).
 *
 * Le panneau reste MONTÉ fermé (`hidden`) : `aria-controls` désigne toujours
 * un élément existant, et l'information existe dans la page même repliée.
 *
 * Positionnement : sous l'icône, décalé horizontalement si besoin pour ne
 * jamais déborder de la fenêtre (390 px compris). Aucune dépendance.
 *
 * ⚠️ JAMAIS pour masquer un coût, une erreur, une progression, un
 * consentement ou l'action principale : ceux-là restent visibles.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

/** Marge minimale entre le panneau et le bord de la fenêtre (px). */
const MARGE = 12;
/** Largeur visée du panneau (px) — bornée par la fenêtre. */
const LARGEUR = 288;

// useLayoutEffect avertit côté serveur : repli sur useEffect hors navigateur.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface InfoBulleProps {
  /** Libellé accessible de l'icône, ex. « En savoir plus sur l'aperçu du style ». */
  label: string;
  /** Titre facultatif affiché en tête du panneau. */
  titre?: string;
  /** Le contenu détaillé. */
  children: React.ReactNode;
  className?: string;
  /** Attribut `data-*` d'ancrage pour les tests / le banc (posé sur l'enveloppe). */
  marqueur?: string;
}

export default function InfoBulle({ label, titre, children, className = '', marqueur }: InfoBulleProps) {
  const [ouvert, setOuvert] = useState(false);
  const [decalage, setDecalage] = useState(0);
  const id = useId();
  const panneauId = `infobulle-${id.replace(/:/g, '')}`;
  const enveloppeRef = useRef<HTMLSpanElement | null>(null);
  const boutonRef = useRef<HTMLButtonElement | null>(null);
  const panneauRef = useRef<HTMLSpanElement | null>(null);
  /** Horodatage de la dernière bascule au clavier : le `click` natif qui suit est ignoré. */
  const basculeClavierRef = useRef(0);

  const fermer = useCallback((rendreFocus: boolean) => {
    setOuvert(false);
    if (rendreFocus) boutonRef.current?.focus();
  }, []);

  const basculer = useCallback(() => setOuvert((o) => !o), []);

  // Échap et clic extérieur, seulement tant que le panneau est ouvert.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fermer(true); }
    };
    const surPointeur = (e: Event) => {
      const cible = e.target as Node | null;
      if (cible && enveloppeRef.current?.contains(cible)) return;
      fermer(false);
    };
    document.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', surPointeur);
    document.addEventListener('touchstart', surPointeur);
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('mousedown', surPointeur);
      document.removeEventListener('touchstart', surPointeur);
    };
  }, [ouvert, fermer]);

  // À l'ouverture : le panneau reste dans la fenêtre, puis reçoit le focus.
  useIsoLayoutEffect(() => {
    if (!ouvert) { setDecalage(0); return; }
    const panneau = panneauRef.current;
    const enveloppe = enveloppeRef.current;
    if (panneau && enveloppe && typeof window !== 'undefined') {
      const largeurFenetre = window.innerWidth || document.documentElement.clientWidth || 0;
      const ancre = enveloppe.getBoundingClientRect();
      const largeur = panneau.getBoundingClientRect().width || Math.min(LARGEUR, largeurFenetre - 2 * MARGE);
      // Position naturelle : bord gauche du panneau aligné sur l'icône.
      let gauche = ancre.left;
      if (gauche + largeur > largeurFenetre - MARGE) gauche = largeurFenetre - MARGE - largeur;
      if (gauche < MARGE) gauche = MARGE;
      setDecalage(Math.round(gauche - ancre.left));
    }
    panneau?.focus();
  }, [ouvert]);

  return (
    <span
      ref={enveloppeRef}
      className={`relative inline-flex align-middle ${className}`}
      data-infobulle={marqueur ?? ''}
      data-infobulle-etat={ouvert ? 'ouverte' : 'fermee'}
    >
      <button
        ref={boutonRef}
        type="button"
        aria-label={label}
        aria-expanded={ouvert}
        aria-controls={panneauId}
        title={label}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            basculeClavierRef.current = Date.now();
            basculer();
          }
        }}
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
        onClick={() => {
          // Le navigateur peut émettre un `click` après Entrée / Espace :
          // la bascule clavier a déjà eu lieu.
          if (Date.now() - basculeClavierRef.current < 400) return;
          basculer();
        }}
        className={`inline-flex items-center justify-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-studiio-primary ${
          ouvert ? 'text-white bg-white/10' : 'text-gray-500 hover:text-gray-200'
        }`}
        data-infobulle-bouton
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <span
        ref={panneauRef}
        id={panneauId}
        // Rôle posé seulement ouvert : un panneau caché ne doit pas passer
        // pour une fenêtre de dialogue (sélecteurs `[role="dialog"]`).
        role={ouvert ? 'dialog' : undefined}
        aria-label={titre ?? label}
        tabIndex={-1}
        hidden={!ouvert}
        data-infobulle-panneau
        className="absolute top-full z-50 block mt-1.5 rounded-xl border border-white/10 bg-gray-900/95 p-3 pr-8 text-left text-[11px] font-normal normal-case tracking-normal leading-relaxed text-gray-300 shadow-xl shadow-black/40 backdrop-blur-md focus:outline-none"
        style={{ left: decalage, width: LARGEUR, maxWidth: `calc(100vw - ${2 * MARGE}px)` }}
      >
        {titre ? <span className="mb-1 block text-xs font-semibold text-white">{titre}</span> : null}
        <span className="block space-y-1.5">{children}</span>
        <button
          type="button"
          onClick={() => fermer(true)}
          aria-label="Fermer"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-gray-500 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-studiio-primary"
          data-infobulle-fermer
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </span>
    </span>
  );
}
