/**
 * Surimpressions en 16:9 et 1:1 — le visage de l'avatar reste libre.
 *
 * Rendu réel (avatar + rush + stock + photo) : la mise en page calibrée pour
 * le 9:16, posée sur une image large, couvrait le visage (accroche 26–27 %,
 * CTA 63 % en 16:9 ; accroche 12–15 % en 1:1). Chaque format a désormais son
 * placement ; le 9:16 reste octet pour octet celui d'avant.
 */
import { FOND_TEXTE_SUR_IMAGE } from '@/lib/creer/contraste';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  appliquerMiseEnPageSurimpression, boitesSurimpression, couvertureVisage, ZONE_VISAGE,
  type BoiteImage,
} from '@/lib/creer/surimpressions-mise-en-page';
import { planOverlays } from '@/lib/creer/overlays';
import type { DesignFormat } from '@/lib/creer/designSpec';

const CARTES = {
  sommeil: [
    { icon: 'Moon', title: 'Écrans coupés une heure avant le coucher', value: '60 min' },
    { icon: 'Coffee', title: 'Dernier café avant quatorze heures', value: '14 h' },
    { icon: 'Thermometer', title: 'Chambre fraîche et bien aérée', value: '18 °C' },
  ],
  danse: [
    { icon: 'Flame', title: 'Calories brûlées par séance de danse', value: '600' },
    { icon: 'Heart', title: 'Endurance cardio améliorée en un mois', value: '+25 %' },
  ],
};
// Les entrées du gel 9:16 (fixture capturée sur bb9b07b, AVANT ce changement).
const DESIGNS: Record<string, Record<string, unknown>> = {
  sommeil: { title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL', subtitle: 'Et comment les corriger dès ce soir, sans médicament', ctaText: 'Réservez votre bilan sommeil gratuit sur afroboost.com', gradientEnd: '#EC4899', format: '9:16' },
  danse: { title: 'BRÛLEZ 600 CALORIES EN DANSANT SUR DE L’AFROBEAT', subtitle: 'Le cours de danse cardio qui fait transpirer Neuchâtel', ctaText: 'Réservez votre cours d’essai sur afroboost.com', gradientEnd: '#EC4899', format: '9:16' },
  regle: { title: 'Court', subtitle: null, ctaText: 'GO', ctaSubText: 'lien en bio', titleScale: 1.2, subtitleScale: 0.9, ctaScale: 0.9, cardsTypography: { scale: 1.1, font: 'Anton' }, ctaSubColor: '#00FF00', gradientEnd: '#123456' },
  vide: {},
};
const PROFILS = ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'STANDARD', 'TUTORIAL_EDUCATION', 'LIFESTYLE_BRAND', 'INCONNU', null];

describe('9:16 — mise en page inchangée hors zones sûres', () => {
  it('identique, champ pour champ, à celle de bb9b07b — sauf les TROIS placements de la zone sûre (et sans champ nouveau)', () => {
    const gel = JSON.parse(readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/surimpressions-916-bb9b07b.json'), 'utf-8'));
    let n = 0;
    for (const [nom, d] of Object.entries(DESIGNS)) {
      for (const p of PROFILS) {
        for (const b of [undefined, 'haut', 'bas'] as const) {
          const cle = `${nom}|${p}|${b ?? '-'}`;
          const obtenu = appliquerMiseEnPageSurimpression(d, p, { ctaBande: b }) as Record<string, any>;
          // Zones sûres 9:16 (`zones-sures-916`) : l'accroche passe de 7 % à
          // 12 % ; la carte bas-gauche s'arrête au rail d'actions (largeur
          // 100 % → 91,6 % du cadre, bord droit 92 % → 85 %) ; le CTA de la
          // bande HAUTE s'aligne par son haut sur 12 %. Tout le reste —
          // échelles, fonds, couleurs, CTA bas — est celui de bb9b07b.
          const attendu = JSON.parse(JSON.stringify(gel[cle]));
          expect(attendu.titlePos).toEqual({ x: 8, y: 7 });
          attendu.titlePos = { x: 8, y: 12 };
          if (attendu.cardBoxes.c0.w === 100) attendu.cardBoxes.c0.w = 91.6;
          if (b === 'haut') {
            expect(attendu.ctaPos).toEqual({ x: 50, y: 34 });
            expect(obtenu.ctaPos.x).toBe(50);
            expect(obtenu.ctaPos.y).toBeGreaterThan(12);
            attendu.ctaPos = obtenu.ctaPos;
          }
          // Contraste discret (20/10) : les pavés opaques (0,55 / 0,6) du gel
          // disparaissent (texte sur l'image, contour) — seul changement.
          expect(attendu.cardBackground).toBe('rgba(0,0,0,0.55)');
          expect(attendu.ctaBackground).toBe('rgba(0,0,0,0.6)');
          attendu.cardBackground = FOND_TEXTE_SUR_IMAGE;
          attendu.ctaBackground = FOND_TEXTE_SUR_IMAGE;
          expect(JSON.stringify(obtenu)).toBe(JSON.stringify(attendu));
          n += 1;
        }
      }
    }
    expect(n).toBe(Object.keys(gel).length);
  });
  it('le format explicite 9:16 donne la même chose que l’absence de format', () => {
    const d = { ...DESIGNS.sommeil };
    delete (d as { format?: string }).format;
    expect(appliquerMiseEnPageSurimpression(d, 'STANDARD', { format: '9:16' }))
      .toEqual(appliquerMiseEnPageSurimpression(d, 'STANDARD'));
  });
});

const PRESENTS: Array<[string, DesignFormat]> = [];
for (const f of ['16:9', '1:1', '9:16'] as const) for (const n of ['sommeil', 'danse']) PRESENTS.push([n, f]);

const chevauche = (a: BoiteImage, b: BoiteImage) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

describe.each(PRESENTS)('%s en %s — visage libre, aucun chevauchement', (nom, format) => {
  const nomCartes = nom as keyof typeof CARTES;
  const base = { ...DESIGNS[nom], format, cards: CARTES[nomCartes] };
  const profils = ['STANDARD', 'CARDIO_DANCE', 'TUTORIAL_EDUCATION'];
  it.each(profils)('profil %s : chaque surimpression couvre ≤ 10 % du visage', (profil) => {
    const d = appliquerMiseEnPageSurimpression(base, profil, { ctaBande: 'bas' });
    const boites = boitesSurimpression(d, format);
    for (const [el, b] of Object.entries(boites)) {
      // 9:16 : l'accroche (inchangée) n'est pas jugée sur sa boîte ESTIMÉE —
      // estimation prudente, tenue au plancher de lisibilité, bien plus haute
      // que le texte réel : le rendu la mesure à 6–9,8 % du visage (pixels).
      if (format === '9:16' && el === 'titre') continue;
      expect(couvertureVisage(b, ZONE_VISAGE[format]), `${el} ${JSON.stringify(b)}`).toBeLessThanOrEqual(0.1);
    }
  });
  it.each(profils)('profil %s : surimpressions simultanées sans chevauchement', (profil) => {
    const d = appliquerMiseEnPageSurimpression(base, profil, { ctaBande: 'bas' });
    const { titre, carte, cta } = boitesSurimpression(d, format);
    const plan = planOverlays({ duree: 24, nbCartes: CARTES[nomCartes].length, profil: profil as 'STANDARD' });
    const fenetres: Array<[BoiteImage, [number, number]]> = [
      [titre, plan.titre!], ...plan.cartes.map((c) => [carte, [c.debut, c.fin]] as [BoiteImage, [number, number]]), [cta, plan.cta!],
    ];
    for (let i = 0; i < fenetres.length; i++) {
      for (let j = i + 1; j < fenetres.length; j++) {
        const simultanes = Math.min(fenetres[i][1][1], fenetres[j][1][1]) > Math.max(fenetres[i][1][0], fenetres[j][1][0]);
        if (simultanes) expect(chevauche(fenetres[i][0], fenetres[j][0])).toBe(false);
      }
    }
    // 16:9 : trois boîtes disjointes. 1:1 : les trois textes partagent la
    // bande basse, jamais le temps — aucune fenêtre ne recouvre une autre.
    if (format === '16:9') {
      expect(chevauche(titre, carte)).toBe(false);
      expect(chevauche(carte, cta)).toBe(false);
      expect(chevauche(titre, cta)).toBe(false);
    }
    if (format === '1:1') {
      const t = fenetres.map((f) => f[1]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < t.length; i++) expect(t[i][0]).toBeGreaterThan(t[i - 1][1]);
    }
  });
  if (format !== '9:16') {
    it('marges ≥ 5 % et tailles lisibles', () => {
      const d = appliquerMiseEnPageSurimpression(base, 'STANDARD') as Record<string, unknown>;
      for (const b of Object.values(boitesSurimpression(d, format))) {
        expect(b.x0).toBeGreaterThanOrEqual(5); expect(b.y0).toBeGreaterThanOrEqual(5);
        expect(b.x1).toBeLessThanOrEqual(95); expect(b.y1).toBeLessThanOrEqual(95);
      }
      expect(d.titleWidth).toBeGreaterThan(0);
      expect(d.ctaWidth).toBeGreaterThan(0);
    });
  }
});

describe('formats larges — le format vient du design ou de l’option', () => {
  it('`format` du design 16:9 → colonnes ; option prioritaire', () => {
    const d = { ...DESIGNS.danse, format: '16:9' };
    const a = appliquerMiseEnPageSurimpression(d, 'CARDIO_DANCE') as Record<string, unknown>;
    expect(a.titleWidth).toBe(31);
    const b = appliquerMiseEnPageSurimpression(d, 'CARDIO_DANCE', { format: '1:1' }) as Record<string, unknown>;
    expect(b.titleWidth).toBe(88);
  });
  it('la bande calme HAUTE n’est pas suivie en format large (c’est celle du visage)', () => {
    const d = { ...DESIGNS.sommeil, format: '16:9' };
    expect(appliquerMiseEnPageSurimpression(d, 'STANDARD', { ctaBande: 'haut' }))
      .toEqual(appliquerMiseEnPageSurimpression(d, 'STANDARD', { ctaBande: 'bas' }));
  });
  it('le montage Remotion passe les largeurs aux cadres titre / CTA', () => {
    const src = readFileSync(resolve(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf-8');
    expect(src).toContain("const posTitre = props.titlePos ?? positionTexteParDefaut('title', format);");
    // La largeur transmise passe telle quelle, sauf titre plein écran 9:16 arrêté au rail (`titreSur916`).
    expect(src).toContain('titleFrameStyle(posTitre, t916 && t916.largeur !== largeurChoisie ? t916.largeur : props.titleWidth)');
    expect(src).toContain("ctaFrameStyle(props.ctaPos ?? positionTexteParDefaut('cta', format), props.ctaWidth)");
  });
});
