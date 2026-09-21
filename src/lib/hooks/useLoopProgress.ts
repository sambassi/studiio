'use client';

import { useEffect, useState } from 'react';

/**
 * Une progression de 0 à 1 qui boucle, pour les vignettes animées.
 *
 * Tant que `playing` est vrai : monte de 0 à 1 en `durationMs`, se tient à 1
 * pendant `holdMs`, se tient à 0 pendant `holdMs`, et recommence. Sinon,
 * rend `idle` — l'image fixe qui représente l'effet (le milieu, en général).
 *
 * `requestAnimationFrame` et non `setInterval` : la cadence suit l'écran, et
 * un onglet en arrière-plan ne consomme rien. La boucle est annulée dès que
 * `playing` retombe ou que le composant se démonte.
 */
export function useLoopProgress(
  playing: boolean,
  durationMs: number,
  holdMs: number,
  idle: number,
): number {
  const [progress, setProgress] = useState(idle);

  useEffect(() => {
    if (!playing || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setProgress(idle);
      return;
    }
    const cycle = durationMs + 2 * holdMs;
    let start: number | null = null;
    let raf = 0;
    const tick = (now: number) => {
      if (start === null) start = now;
      const dansLeCycle = (now - start) % cycle;
      // Pause à 0, montée, pause à 1.
      const p = dansLeCycle < holdMs
        ? 0
        : Math.min(1, (dansLeCycle - holdMs) / durationMs);
      setProgress(p);
      raf = window.requestAnimationFrame(tick);
    };
    setProgress(0);
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, durationMs, holdMs, idle]);

  return progress;
}
