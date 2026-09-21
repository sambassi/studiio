'use client';

import { useCallback, useState } from 'react';

/**
 * Quelle vignette d'une grille d'options doit s'animer.
 *
 * Une vignette joue quand son option est SÉLECTIONNÉE, SURVOLÉE (souris),
 * FOCALISÉE (clavier) ou ÉPINGLÉE par son bouton de lecture (mobile, où il
 * n'y a ni survol ni Tab). Quatre déclencheurs, une seule réponse — et la
 * réduction des animations les éteint tous : une préférence système n'a pas
 * à se négocier option par option.
 *
 * Un seul hook pour les deux grilles (transitions, animations de texte) :
 * chacune en tient une instance.
 */
export function useOptionPreview<T extends string>(reducedMotion: boolean) {
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);
  const [pinned, setPinned] = useState<T | null>(null);

  const isPlaying = useCallback(
    (key: T, selected: boolean) =>
      !reducedMotion && (selected || hovered === key || focused === key || pinned === key),
    [reducedMotion, hovered, focused, pinned],
  );

  /** Gestionnaires à poser sur le bouton d'option. */
  const bind = useCallback((key: T) => ({
    onPointerEnter: () => setHovered(key),
    onPointerLeave: () => setHovered((v) => (v === key ? null : v)),
    onFocus: () => setFocused(key),
    onBlur: () => setFocused((v) => (v === key ? null : v)),
  }), []);

  /** Le bouton de lecture explicite : épingle ou libère la vignette. */
  const togglePin = useCallback((key: T) => {
    setPinned((v) => (v === key ? null : key));
  }, []);

  return { isPlaying, bind, togglePin, pinned };
}
