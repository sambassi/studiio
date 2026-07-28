'use client';

import { useState, useEffect, useCallback } from 'react';

export interface BrandingSettings {
  watermarkText: string;
  borderColor: string;
  borderEnabled: boolean;
  ctaText: string;
  ctaSubText: string;
  accentColor: string;
  /** Debut du degrade de fond. Kit de marque (F7). */
  gradientColor1: string;
  /** Fin du degrade de fond. */
  gradientColor2: string;
  /** Opacite du calque de degrade, 0 a 1. */
  gradientOpacity: number;
}

/**
 * Defauts NEUTRES studiio.pro.
 *
 * `accentColor` valait `#D91CD2` — le magenta d'Afroboost. Le produit demande
 * un defaut neutre : violet #7C3AED / rose #EC4899, les couleurs de la charte
 * studiio.pro (cf. CLAUDE.md, Conventions de code).
 *
 * ⚠️ Portee du changement : ce defaut ne s'applique qu'aux comptes dont le
 * localStorage `studiio_branding` est VIDE, c'est-a-dire qui n'ont jamais
 * ouvert Reglages -> Branding. Toute valeur deja enregistree l'emporte
 * (merge `{ ...DEFAULT_BRANDING, ...parsed }`), et aucun post existant n'est
 * affecte : ils portent leurs couleurs dans `metadata.design`.
 */
const DEFAULT_BRANDING: BrandingSettings = {
  watermarkText: '',
  borderColor: '#7C3AED',
  borderEnabled: false,
  ctaText: 'CHAT POUR PLUS D\'INFOS',
  ctaSubText: 'LIEN EN BIO',
  accentColor: '#7C3AED',
  gradientColor1: '#7C3AED',
  gradientColor2: '#EC4899',
  gradientOpacity: 0.5,
};

/** Reexporte pour que les consommateurs partagent le meme repli neutre. */
export const NEUTRAL_BRANDING = DEFAULT_BRANDING;

const STORAGE_KEY = 'studiio_branding';

export function useBranding() {
  const [branding, setBrandingState] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setBrandingState({ ...DEFAULT_BRANDING, ...parsed });
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  // Save to localStorage on change
  const setBranding = useCallback((updates: Partial<BrandingSettings>) => {
    setBrandingState((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { branding, setBranding, loaded };
}
