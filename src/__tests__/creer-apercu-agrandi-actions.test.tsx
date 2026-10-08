/**
 * Aperçu agrandi : une VRAIE fenêtre quasi plein écran (jamais plus petite
 * que l'aperçu latéral), au ratio de la vidéo. Actions de l'aperçu : une
 * ligne d'icônes compactes, chacune accessible (aria-label, texte sr-only,
 * infobulle). Onglets : aucun débordement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { geometrieAgrandie, geometrieCible } from '@/lib/creer/apercuAgrandi';

const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf-8');
const R916 = 9 / 16;

describe('16-17. fenêtre agrandie : grande, centrée, au ratio 9:16', () => {
  it.each([[1920, 1080], [1440, 900], [1280, 720], [2560, 1440]])('écran %dx%d : utilise la majorité de la hauteur, tient dans l’écran', (vw, vh) => {
    const g = geometrieCible(vw, vh, R916);
    expect(g.h).toBeGreaterThanOrEqual(vh * 0.9);
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.x + g.w).toBeLessThanOrEqual(vw);
    expect(g.y + g.h).toBeLessThanOrEqual(vh);
    // Centrée.
    expect(Math.abs(g.x - (vw - g.x - g.w))).toBeLessThanOrEqual(1);
    // Le plateau 9:16 qu'elle contient est bien plus grand que l'aperçu
    // latéral (borné à (100vh − 20rem) · 9/16 par `.apercu-cadre`).
    const plateau = Math.min(g.w - 48, (g.h - 130) * R916);
    const lateral = ((vh - 320) * 9) / 16;
    expect(plateau).toBeGreaterThan(lateral * 1.1);
  });

  it('une taille mémorisée TROP PETITE (ancien défaut 420×640) n’est plus reprise', () => {
    expect(geometrieAgrandie({ x: 120, y: 90, w: 420, h: 640 }, 1920, 1080, R916)).toEqual(geometrieCible(1920, 1080, R916));
  });

  it('une taille mémorisée AU MOINS aussi grande que la cible est gardée, ramenée dans l’écran', () => {
    const g = geometrieAgrandie({ x: 1700, y: -50, w: 900, h: 1100 }, 1920, 1080, R916);
    expect(g.w).toBe(900);
    expect(g.h).toBe(1080 - 32);
    expect(g.x + g.w).toBeLessThanOrEqual(1920 - 16);
    expect(g.y).toBeGreaterThanOrEqual(16);
  });

  it('la borne de largeur de la colonne latérale ne s’applique plus dans la fenêtre agrandie', () => {
    expect(css).toMatch(/\.apercu-agrandi \.apercu-cadre \{\s*width: 100%;/);
    expect(wizard).toContain('className="apercu-agrandi h-full w-full flex items-start justify-center"');
  });

  it('fermeture claire : fond cliquable et touche Échap', () => {
    expect(wizard).toContain('data-fond-apercu-agrandi');
    expect(wizard).toContain("if (e.key === 'Escape') setEnlargedOpen(false);");
  });
});

describe('20. actions de l’aperçu : compactes et accessibles', () => {
  const barre = wizard.slice(wizard.indexOf("ACTIONS DE L'APERÇU"), wizard.indexOf('LÉGENDE DU RENDU'));
  it('une seule ligne d’icônes (role="toolbar"), aucune fonction retirée', () => {
    expect(barre).toContain('role="toolbar"');
    for (const action of ['basculerAgrandi', "downloadPoster('png')", "downloadPoster('jpeg')", 'setElementPickerOpen', 'resetLayout']) {
      expect(barre, action).toContain(action);
    }
  });
  it('chaque bouton a un aria-label et une infobulle', () => {
    const boutons = barre.split('<button').slice(1);
    expect(boutons.length).toBe(5);
    for (const b of boutons) {
      expect(b).toMatch(/aria-label=/);
      expect(b).toMatch(/title=/);
    }
  });
});

describe('19. onglets : aucun débordement', () => {
  it('rangée défilable, onglets rétrécissables sans passer à la ligne', () => {
    expect(wizard).toContain('className="flex gap-1 mb-3 min-w-0 overflow-x-auto" role="tablist"');
    expect(wizard).toContain('flex-1 min-w-0 justify-center whitespace-nowrap');
  });
});
