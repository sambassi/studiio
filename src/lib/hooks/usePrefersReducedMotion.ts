'use client';

import { useEffect, useState } from 'react';

/** La requête média que ce hook écoute. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * L'utilisateur a-t-il demandé à réduire les animations ?
 *
 * Lu APRÈS le montage, jamais pendant le rendu : côté serveur `window`
 * n'existe pas, et le premier rendu client doit être identique au HTML servi.
 * Le défaut est donc `false` — l'état d'avant — et la préférence s'applique
 * dès le premier effet. Un changement en cours de route (réglage système
 * modifié) est suivi, sans rechargement.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const apply = () => setReduced(!!mql.matches);
    apply();
    // `addEventListener` est le standard ; `addListener` couvre les WebKit
    // plus anciens, qui n'ont que lui.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(apply);
      return () => mql.removeListener(apply);
    }
    return undefined;
  }, []);

  return reduced;
}
