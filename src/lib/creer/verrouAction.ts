'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Un verrou SYNCHRONE par action, pour que deux clics ne lancent pas deux
 * rendus.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN `useRef` ET PAS UN `useState`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les ecrans avaient deja `regenerating`, `saving`, `isExporting`... et ces
 * drapeaux SUFFISENT a griser un bouton. Ils ne suffisent pas a bloquer un
 * second appel : `setSaving(true)` ne change pas `saving` dans le tour
 * courant. Deux clics dans le meme tick lisent tous les deux `false`, entrent
 * tous les deux dans le gestionnaire, et ouvrent DEUX tentatives serveur.
 *
 * L'idempotence du socle ne rattrape pas ce cas : elle garantit un seul debit
 * par tentative, pas une seule tentative par intention. Deux tentatives, deux
 * rendus reellement produits, deux debits legitimes du point de vue du
 * serveur -- et un utilisateur qui a clique une fois de trop.
 *
 * Un `ref` est ecrit et relu dans le meme tour. C'est la seule structure qui
 * ferme la fenetre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET UN ETAT EN MIROIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le `ref` ne provoque aucun rendu : un bouton ne saurait pas qu'il doit se
 * griser. `actif()` lit un `Set` d'etat tenu a jour en parallele, uniquement
 * pour l'affichage. La DECISION reste celle du `ref`.
 *
 * Le verrou est rendu dans un `finally` : une exception ne doit pas laisser
 * une action definitivement inutilisable. Une fois rendu, relancer
 * volontairement le meme rendu redevient possible -- c'est le double clic
 * qu'on refuse, pas la seconde tentative deliberee.
 */
export interface Verrous {
  /**
   * Tente de prendre le verrou.
   *
   * Rend `true` si l'appelant peut continuer, `false` si l'action est deja
   * en cours -- auquel cas il doit rendre la main IMMEDIATEMENT, sans
   * toucher a quoi que ce soit.
   */
  prendre: (cle: string) => boolean;
  /** Rend le verrou. A appeler dans un `finally`, jamais ailleurs. */
  rendre: (cle: string) => void;
  /** Pour l'affichage seulement : cette action est-elle en cours ? */
  actif: (cle: string) => boolean;
}

export function useVerrous(): Verrous {
  const pris = useRef<Set<string>>(new Set());
  const [miroir, setMiroir] = useState<string[]>([]);

  const prendre = useCallback((cle: string): boolean => {
    if (pris.current.has(cle)) return false;
    pris.current.add(cle);
    setMiroir(Array.from(pris.current));
    return true;
  }, []);

  const rendre = useCallback((cle: string) => {
    if (!pris.current.delete(cle)) return;
    setMiroir(Array.from(pris.current));
  }, []);

  const actif = useCallback((cle: string) => miroir.includes(cle), [miroir]);

  return { prendre, rendre, actif };
}

/** Les cles utilisees, nommees une fois pour ne pas diverger d'un ecran a l'autre. */
export const VERROU = {
  regenerer: 'rendu:regenerer',
  programmer: 'rendu:programmer',
  publier: 'rendu:publier',
  exporter: 'rendu:exporter',
  infographieExport: 'rendu:infographie-export',
  agentIA: 'rendu:agent-ia',
} as const;
