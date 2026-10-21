import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import InfoBulle from '@/components/ui/InfoBulle';

/**
 * InfoBulle — le détail à la demande (docs/UX-PREMIUM.md, règles 5-6) :
 * aria complet, clavier (Entrée / Espace / Échap), clic extérieur, bouton
 * Fermer, focus, et un panneau qui ne déborde pas d'un écran de 390 px.
 */
afterEach(cleanup);

function monter() {
  return render(
    <div>
      <p data-testid="dehors">Ailleurs dans la page</p>
      <InfoBulle label="En savoir plus sur l'aperçu" titre="Aperçu" marqueur="test">
        <span className="block">Le détail qui n'encombre plus l'écran.</span>
      </InfoBulle>
    </div>,
  );
}
const bouton = () => screen.getByRole('button', { name: "En savoir plus sur l'aperçu" });
const panneau = () => document.querySelector('[data-infobulle-panneau]') as HTMLElement;

describe('InfoBulle', () => {
  it('fermée par défaut : aria-expanded=false, aria-controls vise le panneau (monté mais caché)', () => {
    monter();
    const b = bouton();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    const id = b.getAttribute('aria-controls')!;
    expect(id).toBeTruthy();
    expect(document.getElementById(id)).toBe(panneau());
    expect(panneau().hidden).toBe(true);
    // ⚠️ La CLASSE aussi : une classe `block` l'emporterait sur l'attribut seul
    // (bug vu au banc : panneau « caché » mais affiché).
    expect(panneau().classList.contains('hidden')).toBe(true);
    expect(panneau().classList.contains('block')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('s’ouvre au clic, montre son contenu et prend le focus', () => {
    monter();
    fireEvent.click(bouton());
    expect(bouton().getAttribute('aria-expanded')).toBe('true');
    const dlg = screen.getByRole('dialog', { name: 'Aperçu' });
    expect(dlg.textContent).toContain("Le détail qui n'encombre plus l'écran.");
    expect(document.activeElement).toBe(dlg);
    expect(document.querySelector('[data-infobulle="test"]')!.getAttribute('data-infobulle-etat')).toBe('ouverte');
  });

  it('s’ouvre à Entrée et à Espace (une seule bascule, même si un click natif suit)', () => {
    monter();
    fireEvent.keyDown(bouton(), { key: 'Enter' });
    fireEvent.click(bouton()); // le click que le navigateur émet après Entrée
    expect(bouton().getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(bouton(), { key: 'Enter' });
    expect(bouton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(bouton(), { key: ' ' });
    expect(bouton().getAttribute('aria-expanded')).toBe('true');
  });

  it('Échap ferme et rend le focus à l’icône', () => {
    monter();
    fireEvent.click(bouton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bouton().getAttribute('aria-expanded')).toBe('false');
    expect(panneau().hidden).toBe(true);
    expect(document.activeElement).toBe(bouton());
  });

  it('un clic à l’extérieur ferme ; un clic dans le panneau ne ferme pas', () => {
    monter();
    fireEvent.click(bouton());
    fireEvent.mouseDown(panneau());
    expect(bouton().getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(screen.getByTestId('dehors'));
    expect(bouton().getAttribute('aria-expanded')).toBe('false');
  });

  it('un tap à l’extérieur ferme aussi (mobile)', () => {
    monter();
    fireEvent.click(bouton());
    fireEvent.touchStart(screen.getByTestId('dehors'));
    expect(bouton().getAttribute('aria-expanded')).toBe('false');
  });

  it('le bouton « Fermer » du panneau ferme et rend le focus', () => {
    monter();
    fireEvent.click(bouton());
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(bouton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bouton());
  });

  it('à 390 px, une icône au bord droit décale le panneau pour qu’il reste dans la fenêtre', () => {
    const avant = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      monter();
      const env = document.querySelector('[data-infobulle="test"]') as HTMLElement;
      env.getBoundingClientRect = () => ({ left: 360, right: 380, top: 0, bottom: 20, width: 20, height: 20, x: 360, y: 0, toJSON() {} }) as DOMRect;
      panneau().getBoundingClientRect = () => ({ left: 0, right: 288, top: 0, bottom: 100, width: 288, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
      act(() => { fireEvent.click(bouton()); });
      const gauche = parseFloat(panneau().style.left);
      // Bord droit du panneau = 360 + décalage + 288 ≤ 390 − 12.
      expect(360 + gauche + 288).toBeLessThanOrEqual(378);
      expect(360 + gauche).toBeGreaterThanOrEqual(12);
      expect(panneau().style.maxWidth).toContain('100vw');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: avant });
    }
  });

  it('aucun emoji, une icône lucide (svg) seulement', () => {
    monter();
    expect(bouton().querySelector('svg')).toBeTruthy();
    expect(/\p{Extended_Pictographic}/u.test(document.body.textContent ?? '')).toBe(false);
  });
});
