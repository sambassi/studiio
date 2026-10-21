'use client';

/**
 * Invitation à installer Studiio (PWA) — DISCRÈTE (docs/UX-PREMIUM.md, règle 11).
 *
 *  - fermeture MÉMORISÉE 30 jours (localStorage, lecture/écriture sous
 *    try/catch : navigation privée ou stockage bloqué → l'invitation reste
 *    simplement fermable) ;
 *  - une seule apparition par session (sessionStorage) : jamais à chaque page ;
 *  - compacte, flottante en bas à droite mais À GAUCHE du bouton d'assistant
 *    (56 px + marges), sans bandeau pleine largeur sur le contenu ;
 *  - se retire seule après quelques secondes sans être mémorisée comme refus.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Clé de la fermeture mémorisée : horodatage (ms) jusqu'auquel ne plus inviter. */
export const CLE_MASQUE_JUSQUA = 'studiio:pwa-install:masque-jusqua';
/** Clé de session : l'invitation a déjà été montrée dans cet onglet. */
export const CLE_VUE_SESSION = 'studiio:pwa-install:vue';
export const DUREE_MASQUE_MS = 30 * 24 * 60 * 60 * 1000;
/** Retrait automatique (non mémorisé) pour ne pas rester sur le contenu. */
export const RETRAIT_AUTO_MS = 20_000;

/** L'invitation peut-elle s'afficher maintenant ? (stockage illisible → oui, une fois) */
export function invitationAutorisee(maintenant = Date.now()): boolean {
  try {
    const jusqua = Number(window.localStorage.getItem(CLE_MASQUE_JUSQUA) ?? '0');
    if (Number.isFinite(jusqua) && jusqua > maintenant) return false;
  } catch { /* stockage indisponible */ }
  try {
    if (window.sessionStorage.getItem(CLE_VUE_SESSION)) return false;
  } catch { /* stockage indisponible */ }
  return true;
}

function noterVueSession() {
  try { window.sessionStorage.setItem(CLE_VUE_SESSION, '1'); } catch { /* stockage indisponible */ }
}

function memoriserFermeture(maintenant = Date.now()) {
  try { window.localStorage.setItem(CLE_MASQUE_JUSQUA, String(maintenant + DUREE_MASQUE_MS)); } catch { /* stockage indisponible */ }
}

export default function PWAInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    // Register service worker with forced update check
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.log('[PWA] Service Worker registration failed:', err);
        });
    }

    // Fermée récemment, ou déjà montrée dans cette session : on n'invite pas.
    if (!invitationAutorisee()) dismissedRef.current = true;

    // Check if it's iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Firefox/.test(navigator.userAgent);

    let iosTimeout: ReturnType<typeof setTimeout> | null = null;
    let showTimeout: ReturnType<typeof setTimeout> | null = null;

    // Show iOS instructions if applicable
    if (isIOS && isSafari && !dismissedRef.current) {
      iosTimeout = setTimeout(() => {
        noterVueSession();
        setShowIOSPrompt(true);
      }, 2000);
    }

    // Listen for beforeinstallprompt event (Android Chrome, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;

      if (!dismissedRef.current) {
        if (showTimeout) clearTimeout(showTimeout);
        showTimeout = setTimeout(() => {
          noterVueSession();
          setShowPrompt(true);
        }, 1000);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      if (iosTimeout) clearTimeout(iosTimeout);
      if (showTimeout) clearTimeout(showTimeout);
    };
  }, []);

  // Retrait automatique : l'invitation ne reste pas sur le contenu.
  const visible = showPrompt || showIOSPrompt;
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => {
      setShowPrompt(false);
      setShowIOSPrompt(false);
      dismissedRef.current = true;
    }, RETRAIT_AUTO_MS);
    return () => clearTimeout(id);
  }, [visible]);

  const handleInstallClick = async () => {
    if (!deferredPromptRef.current) return;

    deferredPromptRef.current.prompt();
    const { outcome } = await deferredPromptRef.current.userChoice;

    if (outcome === 'accepted') {
      console.log('[PWA] App installed');
    }

    setShowPrompt(false);
    deferredPromptRef.current = null;
    dismissedRef.current = true;
    memoriserFermeture();
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowIOSPrompt(false);
    dismissedRef.current = true;
    memoriserFermeture();
  };

  if (!visible) return null;

  // Compacte, à gauche du bouton d'assistant (bottom-4 right-4, 56 px).
  return (
    <div
      role="region"
      aria-label={showPrompt ? 'Installer Studiio' : 'Ajouter Studiio à l’écran d’accueil'}
      data-pwa-invitation={showPrompt ? 'installer' : 'ios'}
      className="fixed z-40 flex items-center gap-2 rounded-xl border border-white/10 bg-gray-900/95 py-0.5 pl-3 pr-0.5 shadow-lg shadow-black/40 backdrop-blur-md"
      style={{ bottom: 20, right: 88, maxWidth: 'calc(100vw - 104px)' }}
    >
      {showPrompt ? (
        <Download className="w-4 h-4 text-purple-400 flex-shrink-0" aria-hidden="true" />
      ) : (
        <Smartphone className="w-4 h-4 text-purple-400 flex-shrink-0" aria-hidden="true" />
      )}
      <p className="min-w-0 truncate text-xs text-gray-200" title={showPrompt ? undefined : 'Touchez Partager, puis « Sur l’écran d’accueil »'}>
        {showPrompt ? 'Installer Studiio' : 'Partager › Sur l’écran d’accueil'}
      </p>
      {showPrompt && (
        <button
          onClick={handleInstallClick}
          className="flex-shrink-0 rounded-lg bg-studiio-primary px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-purple-700"
          data-pwa-installer
        >
          Installer
        </button>
      )}
      <button
        onClick={handleDismiss}
        // Cible tactile ≥ 44 px (WCAG 2.5.5) ; l'icône reste petite.
        className="flex flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-white"
        style={{ minWidth: 44, minHeight: 44 }}
        aria-label="Fermer l’invitation à installer"
        data-pwa-fermer
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
