'use client';

import { useState, useEffect, useCallback } from 'react';

export interface BrandingSettings {
  watermarkText: string;
  borderColor: string;
  borderEnabled: boolean;
  ctaText: string;
  ctaSubText: string;
  accentColor: string;
}

const DEFAULT_BRANDING: BrandingSettings = {
  watermarkText: '',
  borderColor: '#D91CD2',
  borderEnabled: false,
  ctaText: 'CHAT POUR PLUS D\'INFOS',
  ctaSubText: 'LIEN EN BIO',
  accentColor: '#D91CD2',
};

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
