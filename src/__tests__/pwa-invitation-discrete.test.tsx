import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import PWAInstallPrompt, {
  CLE_MASQUE_JUSQUA,
  CLE_VUE_SESSION,
  DUREE_MASQUE_MS,
  RETRAIT_AUTO_MS,
  invitationAutorisee,
} from '@/components/PWAInstallPrompt';

/**
 * Invitation « Installer Studiio » — discrète (docs/UX-PREMIUM.md, règle 11) :
 * fermeture mémorisée 30 jours, une seule apparition par session, retrait
 * automatique, et jamais un bandeau pleine largeur.
 */
function evenementInstallation() {
  const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome: 'dismissed' });
  return e;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function monterEtDeclencher() {
  render(<PWAInstallPrompt />);
  act(() => { window.dispatchEvent(evenementInstallation()); });
  act(() => { vi.advanceTimersByTime(1100); });
}

describe('Invitation à installer — discrète et mémorisée', () => {
  it('apparaît compacte, sans bandeau pleine largeur, à gauche du bouton d’assistant', () => {
    monterEtDeclencher();
    const inv = document.querySelector('[data-pwa-invitation="installer"]') as HTMLElement;
    expect(inv).toBeTruthy();
    expect(inv.className).not.toContain('left-0');
    expect(inv.className).not.toContain('right-0');
    expect(inv.style.right).toBe('88px');
    expect(inv.style.maxWidth).toContain('100vw');
    expect(screen.getByText('Installer Studiio')).toBeTruthy();
  });

  it('la fermeture est mémorisée 30 jours', () => {
    const maintenant = Date.now();
    monterEtDeclencher();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer l’invitation à installer' }));
    expect(document.querySelector('[data-pwa-invitation]')).toBeNull();
    const jusqua = Number(window.localStorage.getItem(CLE_MASQUE_JUSQUA));
    expect(jusqua).toBeGreaterThanOrEqual(maintenant + DUREE_MASQUE_MS - 1000);
    // Nouvelle session (sessionStorage vide) : toujours masquée.
    window.sessionStorage.clear();
    expect(invitationAutorisee()).toBe(false);
    cleanup();
    monterEtDeclencher();
    expect(document.querySelector('[data-pwa-invitation]')).toBeNull();
    // Après 30 jours, elle peut revenir.
    expect(invitationAutorisee(jusqua + 1)).toBe(true);
  });

  it('une seule apparition par session : pas à chaque page', () => {
    monterEtDeclencher();
    expect(window.sessionStorage.getItem(CLE_VUE_SESSION)).toBe('1');
    cleanup();
    monterEtDeclencher();
    expect(document.querySelector('[data-pwa-invitation]')).toBeNull();
  });

  it('se retire seule sans être comptée comme un refus de 30 jours', () => {
    monterEtDeclencher();
    act(() => { vi.advanceTimersByTime(RETRAIT_AUTO_MS + 10); });
    expect(document.querySelector('[data-pwa-invitation]')).toBeNull();
    expect(window.localStorage.getItem(CLE_MASQUE_JUSQUA)).toBeNull();
  });

  it('stockage bloqué : aucune exception, l’invitation reste fermable', () => {
    const lire = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqué'); });
    const ecrire = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqué'); });
    try {
      expect(invitationAutorisee()).toBe(true);
      monterEtDeclencher();
      fireEvent.click(screen.getByRole('button', { name: 'Fermer l’invitation à installer' }));
      expect(document.querySelector('[data-pwa-invitation]')).toBeNull();
    } finally {
      lire.mockRestore();
      ecrire.mockRestore();
    }
  });
});
