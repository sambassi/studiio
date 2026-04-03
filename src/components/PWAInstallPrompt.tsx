'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
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

    // Check if it's iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Firefox/.test(navigator.userAgent);

    let iosTimeout: ReturnType<typeof setTimeout> | null = null;

    // Show iOS instructions if applicable
    if (isIOS && isSafari && !dismissedRef.current) {
      iosTimeout = setTimeout(() => {
        setShowIOSPrompt(true);
      }, 2000);
    }

    // Listen for beforeinstallprompt event (Android Chrome, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;

      if (!dismissedRef.current) {
        setTimeout(() => {
          setShowPrompt(true);
        }, 1000);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      if (iosTimeout) clearTimeout(iosTimeout);
    };
  }, []);

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
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowIOSPrompt(false);
    dismissedRef.current = true;
  };

  // Standard PWA install prompt
  if (showPrompt) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 py-4 shadow-lg z-50">
        <div className="max-w-md mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <Download className="w-5 h-5 text-purple-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Installer Studiio</p>
              <p className="text-xs text-gray-400 truncate">
                Accédez rapidement à votre app préférée
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded transition-colors"
            >
              Installer
            </button>
            <button
              onClick={handleDismiss}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // iOS Safari instructions
  if (showIOSPrompt) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 py-4 shadow-lg z-50">
        <div className="max-w-md mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <Smartphone className="w-5 h-5 text-purple-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Ajouter à l'écran d'accueil</p>
              <p className="text-xs text-gray-400 truncate">
                Touchez Partager, puis "Sur l'écran d'accueil"
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-2 text-gray-400 hover:text-white transition-colors flex-shrink-0"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
