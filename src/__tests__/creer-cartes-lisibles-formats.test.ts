/**
 * Créer — cartes lisibles en 16:9 et 1:1 (projets v2) : texte ≥ 2,6 % de la
 * hauteur vidéo. Mesuré sur la démo « LE SPORT » 16:9 avant correctif :
 * 26,25 px de corps (capitales 19 px = 1,76 % de 1080).
 *
 * Default safe : sans `plancherHauteurVideo` (Remotion / Autopilote, anciens
 * posts), le DOM est identique au caractère près.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SequenceCards, { LISIBILITE_HAUTEUR, ratiosLisiblesHauteur } from '@/components/creer/SequenceCards';
import { cardRatios } from '@/lib/creer/designSpec';
import { planFondEnchaine } from '@/lib/video-composer';

const CARTES = [
  { id: 'a', icon: 'HeartPulse', title: 'CARDIO COMPLET', value: '3-en-1' },
  { id: 'b', icon: 'Bone', title: 'OS RENFORCÉS', value: '+2 %/an' },
];
const tailles = (html: string) => Array.from(html.matchAll(/font-size:([\d.]+)px/g)).map((m) => Number(m[1]));
const icones = (html: string) => Array.from(html.matchAll(/<svg[^>]* width="([\d.]+)"/g)).map((m) => Number(m[1]));
const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(React.createElement(SequenceCards, { cards: CARTES, valueColor: '#EC4899', ...p } as never));

describe('cartes : plancher de lisibilité proportionné à la hauteur (16:9, 1:1)', () => {
  it('16:9 : texte 26,25 px → ≥ 2,6 % de 1080 (28,1 px) ; valeur et icône du même facteur', () => {
    const avant = rendre({ containerWidth: 1920, landscape: true });
    const apres = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080 });
    expect(Math.min(...tailles(avant))).toBeCloseTo(1920 * 7 / 512, 3);
    expect(Math.min(...tailles(apres))).toBeGreaterThanOrEqual(1080 * LISIBILITE_HAUTEUR - 1e-6);
    const k = Math.min(...tailles(apres)) / Math.min(...tailles(avant));
    expect(Math.max(...tailles(apres)) / Math.max(...tailles(avant))).toBeCloseTo(k, 6);
    expect(icones(apres)[0]).toBeGreaterThan(icones(avant)[0]);
  });
  it('échelle choisie par l’utilisateur : facteur AU-DESSUS du plancher ; police et couleurs gardées', () => {
    const base = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080, typography: { font: 'Anton' } });
    const x15 = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080, typography: { font: 'Anton', scale: 1.5 } });
    expect(Math.min(...tailles(x15)) / Math.min(...tailles(base))).toBeCloseTo(1.5, 6);
    expect(x15).toContain('Anton');
    expect(x15).toContain('#EC4899');
  });
  it('1:1 : déjà au-dessus du plancher (29,5 px ≥ 28,1) → inchangé', () => {
    expect(rendre({ containerWidth: 1080, landscape: false, plancherHauteurVideo: 1080 })).toBe(rendre({ containerWidth: 1080, landscape: false }));
    expect(ratiosLisiblesHauteur(cardRatios(false), 1080, 1080)).toEqual(cardRatios(false));
  });
  it('Default safe : sans plancher, mode libre, badge ou 9:16 → DOM d’avant', () => {
    expect(rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: null })).toBe(rendre({ containerWidth: 1920, landscape: true }));
    const boites = { a: { x: 10, y: 10, w: 30, h: 10 }, b: { x: 10, y: 30, w: 30, h: 10 } };
    expect(rendre({ containerWidth: 1920, landscape: true, cardBoxes: boites, plancherHauteurVideo: 1080 })).toBe(rendre({ containerWidth: 1920, landscape: true, cardBoxes: boites }));
    expect(rendre({ containerWidth: 1080, landscape: false, zoneSure916: true, plancherHauteurVideo: 1920, typography: { lisible916: true } }))
      .toBe(rendre({ containerWidth: 1080, landscape: false, zoneSure916: true, typography: { lisible916: true } }));
  });
  it('Remotion / Autopilote ne passe jamais le plancher ; Créer le passe pour les projets v2 hors 9:16', () => {
    const remotion = readFileSync(resolve(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf8');
    expect(remotion).not.toContain('plancherHauteurVideo');
    const plateau = readFileSync(resolve(process.cwd(), 'src/components/creer/PlateauSurimpression.tsx'), 'utf8');
    expect(plateau).not.toContain('plancherHauteurVideo');
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(w).toMatch(/plancherHauteurVideo=\{cardsTypography\?\.lisible916 && format !== '9:16'/);
  });
});

describe('compositeur : plan des passages enchaînés du fond Titre / CTA', () => {
  it('démo Titre 6 s : rush 1 (3,5 s) puis rush 2 (2,6 s) — aucune reprise du rush 1', () => {
    const p = planFondEnchaine([{ el: 'r1', depuis: 0.5, longueur: 3.5 }, { el: 'r2', depuis: 0.5, longueur: 2.6 }], 6);
    expect(p).toEqual([{ el: 'r1', debut: 0, fin: 3.5, depuis: 0.5 }, { el: 'r2', debut: 3.5, fin: 6, depuis: 0.5 }]);
  });
  it('fin de séquence < 0,2 s : pas de nouveau passage (pas de flash) ; matière épuisée : la chaîne est rejouée', () => {
    expect(planFondEnchaine([{ el: 'a', depuis: 0, longueur: 2.9 }, { el: 'b', depuis: 0, longueur: 1 }], 4).map((x) => x.el)).toEqual(['a', 'b']);
    expect(planFondEnchaine([{ el: 'a', depuis: 0, longueur: 1 }, { el: 'b', depuis: 0, longueur: 1 }], 3.5).map((x) => x.el)).toEqual(['a', 'b', 'a', 'b']);
  });
});
