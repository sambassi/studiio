'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mesure le cadre d'aperçu et rend le facteur de réduction du plateau.
 *
 * ⚠️ CE HOOK EXISTE PARCE QU'UNE `useRef` NE RÉVEILLE RIEN. C'est la cause
 * exacte de l'aperçu vide en production : le cadre de l'assistant n'est monté
 * qu'après le clic sur « Commencer » (PR #326 l'a placé dans une branche
 * `{!started ? … : …}`), alors que l'effet de mesure, lui, tournait au montage
 * de l'écran — `frameRef.current` valait `null`, l'effet sortait aussitôt, et
 * ses dépendances `[format]` ne changeant jamais, il ne repassait plus JAMAIS.
 *
 * `displayScale` restait donc à 0, le plateau recevait `transform: scale(0)`,
 * et tout ce qu'il contient mesurait 0 × 0 : affiche, titre, cartes et CTA
 * étaient dans le DOM, correctement stylés, et invisibles. Aucune erreur en
 * console — un `scale(0)` est une mise en page valide.
 *
 * ⚠️ D'OÙ UNE `ref` DE RAPPEL, ET NON UNE `useRef`. React APPELLE une ref de
 * rappel au moment exact où le nœud s'attache, quel que soit l'ordre de
 * montage. La mesure ne dépend plus de l'instant où l'écran se monte — le
 * piège se referme au lieu d'être contourné.
 *
 * `frameRef` reste rendue pour les appelants qui lisent le nœud
 * (`getBoundingClientRect` du bornage de glissement).
 */
export function useFrameScale(videoWidth: number) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  /**
   * Le nœud EN ÉTAT, et pas seulement en `ref`.
   *
   * C'est lui qui relance l'effet de mesure : une `ref` mutée ne déclenche
   * aucun rendu, donc aucun effet.
   */
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const [displayScale, setDisplayScale] = useState(0);

  const setFrame = useCallback((el: HTMLDivElement | null) => {
    frameRef.current = el;
    setFrameEl(el);
  }, []);

  useEffect(() => {
    if (!frameEl) return;
    const apply = () => {
      const w = frameEl.clientWidth;
      if (w > 0) setDisplayScale(w / videoWidth);
    };
    apply();
    // `ResizeObserver` manque à jsdom et au rendu serveur : sans ce garde, un
    // composant monté dans un test tomberait sur un `ReferenceError` au lieu
    // de rendre.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(frameEl);
    return () => ro.disconnect();
  }, [frameEl, videoWidth]);

  return { frameRef, setFrame, displayScale };
}
