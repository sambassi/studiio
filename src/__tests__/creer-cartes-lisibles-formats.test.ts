/**
 * Créer — cartes lisibles en 16:9 et 1:1 (projets v2) : texte ≈ 4 % de la
 * hauteur en 16:9, ≈ 3,4 % en 1:1, valeur ≥ 1,2 × texte, sans jamais sortir
 * de la carte ni du cadre. Mesuré sur la démo « LE SPORT » 16:9 avant :
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
import SequenceCards from '@/components/creer/SequenceCards';
import { taillesCartesLisibles, CIBLE_TEXTE_CARTE, RAPPORT_VALEUR } from '@/lib/creer/cartes-lisibles-formats';
import { cardRatios } from '@/lib/creer/designSpec';
import { planFondEnchaine } from '@/lib/video-composer';

const DEMO = [
  { id: 'a', icon: 'HeartPulse', title: 'CARDIO COMPLET', value: '3-en-1' },
  { id: 'b', icon: 'Bone', title: 'OS RENFORCÉS', value: '+2 %/an' },
  { id: 'c', icon: 'Sparkles', title: 'ANTI-ÂGE', value: '-10 ans' },
  { id: 'd', icon: 'Dumbbell', title: '300+ MUSCLES', value: '300+' },
  { id: 'e', icon: 'ShieldCheck', title: 'RISQUE RÉDUIT', value: '-76 %' },
];
const LONGS = [
  { id: 'a', icon: 'Moon', title: 'MÉLATONINE NATURELLE', value: '+30 %' },
  { id: 'b', icon: 'Dumbbell', title: 'RENFORCEMENT MUSCULAIRE', value: '300+' },
  { id: 'c', icon: 'HeartPulse', title: 'ENDURANCE CARDIOVASCULAIRE', value: '-76 %' },
  { id: 'd', icon: 'Brain', title: 'CONCENTRATION AMÉLIORÉE', value: '+2 %/an' },
  { id: 'e', icon: 'ShieldCheck', title: 'IMMUNITÉ RENFORCÉE', value: '-10 ans' },
];
const tailles = (html: string) => Array.from(html.matchAll(/font-size:([\d.]+)px/g)).map((m) => Number(m[1]));
const rendre = (p: Record<string, unknown>, cards = DEMO) => renderToStaticMarkup(React.createElement(SequenceCards, { cards, valueColor: '#EC4899', ...p } as never));

describe('cartes lisibles en 16:9 et 1:1 (Créer v2)', () => {
  it('16:9 démo : texte ≈ 4 % de la hauteur (≥ 3,5 %), valeur = 1,2 × texte, icône à gauche', () => {
    const t = taillesCartesLisibles({ paysage: true, largeur: 1920, hauteur: 1080, cartes: DEMO })!;
    expect(t.ratios.text * 1920).toBeGreaterThanOrEqual(1080 * 0.035);
    expect(t.ratios.text * 1920).toBeLessThanOrEqual(1080 * CIBLE_TEXTE_CARTE.paysage + 1e-6);
    expect(t.ratios.value / t.ratios.text).toBeCloseTo(RAPPORT_VALEUR, 6);
    expect(t.empile).toBe(true);
    const html = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080 });
    expect(Math.min(...tailles(html))).toBeCloseTo(t.ratios.text * 1920, 3);
    expect(html).toContain('flex-direction:row');
    expect(html).not.toContain('text-overflow:ellipsis');
  });
  it('1:1 démo : texte ≈ 3,4 % de la hauteur (≥ 3 %), mots entiers', () => {
    const t = taillesCartesLisibles({ paysage: false, largeur: 1080, hauteur: 1080, cartes: DEMO })!;
    expect(t.ratios.text * 1080).toBeGreaterThanOrEqual(1080 * 0.03);
    expect(t.ratios.text * 1080).toBeLessThanOrEqual(1080 * CIBLE_TEXTE_CARTE.carre + 1e-6);
    const html = rendre({ containerWidth: 1080, landscape: false, plancherHauteurVideo: 1080 });
    expect(html).toContain('word-break:keep-all');
  });
  it('titres longs (5 cartes) : plus grand qu’avant, mais réduit pour tenir (jamais au-dessus de la cible)', () => {
    for (const [paysage, W, H] of [[true, 1920, 1080], [false, 1080, 1080]] as const) {
      const t = taillesCartesLisibles({ paysage, largeur: W, hauteur: H, cartes: LONGS });
      expect(t, `${W}x${H}`).not.toBeNull();
      expect(t!.ratios.text).toBeGreaterThan(cardRatios(paysage).text);
    }
  });
  it('rien ne tient (police très large, mot énorme) : null → rendu d’avant', () => {
    const t = taillesCartesLisibles({ paysage: true, largeur: 1920, hauteur: 1080, cartes: [{ title: 'ANTICONSTITUTIONNELLEMENTISSIME', value: '1' }], police: 'Rubik Mono One' });
    expect(t).toBeNull();
  });
  it('échelle de l’utilisateur : facteur AU-DESSUS ; police et couleurs gardées', () => {
    const base = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080, typography: { font: 'Anton' } });
    const x15 = rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: 1080, typography: { font: 'Anton', scale: 1.5 } });
    expect(Math.min(...tailles(x15)) / Math.min(...tailles(base))).toBeCloseTo(1.5, 6);
    expect(x15).toContain('Anton');
    expect(x15).toContain('#EC4899');
  });
  it('Default safe : sans plancher, mode libre, badge ou 9:16 → DOM d’avant', () => {
    expect(rendre({ containerWidth: 1920, landscape: true, plancherHauteurVideo: null })).toBe(rendre({ containerWidth: 1920, landscape: true }));
    const boites = Object.fromEntries(DEMO.map((c, i) => [c.id, { x: 10, y: 10 + i * 12, w: 30, h: 10 }]));
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
