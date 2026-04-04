'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface CreatorPreferences {
  // Infographic
  format?: '9:16' | '16:9';
  selectedTheme?: string;
  destination?: string;
  // Sequence durations
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  // Branding
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  watermarkText?: string;
  borderColor?: string;
  borderEnabled?: boolean;
  // Media (persistent Supabase URLs)
  savedLogoUrl?: string;
  savedLogoName?: string;
  // Audio Studio
  musicVolume?: number;
  voiceVolume?: number;
  exportDest?: string;
}

const STORAGE_KEY = 'studiio_creator_prefs';
const SAVE_DEBOUNCE_MS = 1500;

export function useCreatorPreferences() {
  const [prefs, setPrefsState] = useState<CreatorPreferences>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPrefsRef = useRef<CreatorPreferences>({});

  // Load preferences: localStorage first (instant), then server (authoritative)
  useEffect(() => {
    // 1. Load from localStorage immediately
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setPrefsState(parsed);
        latestPrefsRef.current = parsed;
      }
    } catch {
      // ignore
    }

    // 2. Load from server (may override localStorage)
    fetch('/api/user/preferences')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.preferences) {
          const merged = { ...latestPrefsRef.current, ...data.preferences };
          setPrefsState(merged);
          latestPrefsRef.current = merged;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Save to localStorage + server (debounced)
  const saveToServer = useCallback((newPrefs: CreatorPreferences) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPrefs),
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Update preferences (partial merge)
  const updatePrefs = useCallback((updates: Partial<CreatorPreferences>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...updates };
      latestPrefsRef.current = next;
      // Save to localStorage immediately
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      // Debounced save to server
      saveToServer(next);
      return next;
    });
  }, [saveToServer]);

  return { prefs, updatePrefs, loaded };
}
