/**
 * SURIMPRESSIONS 16:9 (1920 × 1080) ET 1:1 (1080 × 1080) — UNE géométrie
 * pour Créer et pour l'Autopilote (Remotion, rendu hybride).
 *
 * Mesuré AVANT dans Chromium (balisage réel rendu hors ligne, boîtes DOM) :
 *   - Créer posait sur l'image large la mise en page du 9:16 : CTA long de la
 *     bande haute de −15,4 % à 34 % en 16:9 (COUPÉ par le haut de l'image),
 *     accroche longue sur 8–90 % de la largeur au milieu de l'image (16:9) ou
 *     sur 6–40 % de la hauteur (1:1), cartes à 30 px de texte en 1:1 — et
 *     rien de tout cela au même endroit que l'Autopilote pour le même format ;
 *   - Autopilote / hybride : le panneau du CTA (bas à 92 %) recouvrait le
 *     filigrane sur 50 px en 16:9, et le touchait (3 px) en 1:1 (bas à 93 %).
 *
 * Après : Créer lit la mise en page LARGE (`miseEnPageSurimpression` +
 * `echellesSurimpressionLarge`, les mêmes que `appliquerMiseEnPageSurimpression`)
 * et le CTA se pose au-dessus du filigrane. Le 9:16 est gelé à part
 * (`surimpressions-916-gel-550.test.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

const DIM = { w: 1920, h: 1080 };
vi.mock('remotion', () => {
  const Div = ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => React.createElement('div', { style }, children);
  return {
    AbsoluteFill: Div, Audio: () => null, Img: () => null, OffthreadVideo: () => null,
    Sequence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useVideoConfig: () => ({ fps: 30, width: DIM.w, height: DIM.h, durationInFrames: 900 }),
    useCurrentFrame: () => 0, delayRender: () => 0, continueRender: () => undefined, interpolate: () => 0,
  };
});
vi.mock('@remotion/transitions', () => {
  const TS = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Sequence = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Transition = () => null;
  return { TransitionSeries: TS, linearTiming: () => ({}) };
});
vi.mock('@remotion/transitions/fade', () => ({ fade: () => ({}) }));
vi.mock('@remotion/transitions/slide', () => ({ slide: () => ({}) }));
vi.mock('@remotion/transitions/wipe', () => ({ wipe: () => ({}) }));
vi.mock('@remotion/transitions/iris', () => ({ iris: () => ({}) }));
vi.mock('@remotion/media-utils', () => ({ getAudioDurationInSeconds: async () => 1 }));

import { CreerSimpleMontage } from '../../remotion/CreerSimpleMontage';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';
import {
  appliquerMiseEnPageSurimpression, miseEnPageSurimpression, boitesSurimpression, echellesSurimpressionLarge,
  couvertureVisage, ZONE_VISAGE, type BoiteImage,
} from '@/lib/creer/surimpressions-mise-en-page';
import { VIDEO_SIZE, editorViewportPx } from '@/lib/creer/designSpec';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

const CINQ = [
  { icon: 'Zap', title: 'Énergie', value: '+60%' },
  { icon: 'Brain', title: 'Cerveau boosté', value: '+15%' },
  { icon: 'Flame', title: 'Calories brûlées par séance de danse', value: '600' },
  { icon: 'Heart', title: 'Endurance cardio', value: '+25 %' },
  { icon: 'Moon', title: 'Sommeil réparateur', value: '8 h' },
];
const TITRES = {
  court: { title: 'DANSE CARDIO', subtitle: 'Brûle 600 kcal' },
  long: { title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL ET VOTRE ÉNERGIE', subtitle: 'Et comment les corriger dès ce soir, sans médicament' },
};
const CARTES = { une: CINQ.slice(0, 1), plusieurs: CINQ };
const CTAS = {
  court: { ctaText: 'ESSAI GRATUIT', ctaSubText: 'LIEN EN BIO' },
  long: { ctaText: 'Réservez votre bilan sommeil gratuit sur afroboost.com', ctaSubText: 'LIEN EN BIO' },
};
const FORMATS = ['16:9', '1:1'] as const;
const BANDES = ['haut', 'bas', undefined] as const;
// Profils dynamiques (Créer + Autopilote) et profils de l'avatar (Autopilote).
const PROFILS_AUTO = ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'STANDARD', 'TUTORIAL_EDUCATION', 'LIFESTYLE_BRAND', null];

const TYPO_T = { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 };
const TYPO_C = { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 };

type Cas = { format: (typeof FORMATS)[number]; titre: keyof typeof TITRES; cartes: keyof typeof CARTES; cta: keyof typeof CTAS; bande: (typeof BANDES)[number] };
const CAS: Cas[] = [];
for (const format of FORMATS) for (const titre of ['court', 'long'] as const) for (const cartes of ['une', 'plusieurs'] as const) for (const cta of ['court', 'long'] as const) for (const bande of BANDES) CAS.push({ format, titre, cartes, cta, bande });
const nomCas = (c: Cas) => `${c.format} titre ${c.titre}, ${c.cartes === 'une' ? '1 carte' : '5 cartes'}, CTA ${c.cta} (${c.bande ?? 'sans mesure'})`;

const designDe = (c: Cas) => ({ ...TITRES[c.titre], cards: CARTES[c.cartes], ...CTAS[c.cta], format: c.format, gradientEnd: '#EC4899' });

/** Le cadre de chaque élément, tel que rendu (style + contenu), pour comparer Créer et Remotion. */
function cadres(container: HTMLElement) {
  const titre = container.querySelector('[data-subtitle-block]')?.parentElement ?? null;
  const cartes = container.querySelector('[data-cards-grid]');
  const cta = [...container.querySelectorAll('div')].find((d) => d.style.transform === 'translate(-50%, -100%)') ?? null;
  return { titre: titre?.outerHTML ?? null, cartes: cartes?.outerHTML ?? null, cta: cta?.outerHTML ?? null };
}

describe.each(CAS.map((c) => [nomCas(c), c] as const))('%s', (_n, c) => {
  const { w: W, h: H } = VIDEO_SIZE[c.format];

  it('Créer pose chaque élément EXACTEMENT comme l’Autopilote (même balisage : position, largeur, échelle)', () => {
    DIM.w = W; DIM.h = H;
    const d = designDe(c);
    const auto = appliquerMiseEnPageSurimpression({ ...d, titleFont: 'Inter', ctaFont: 'Inter', titleColor: '#FFFFFF', ctaColor: '#FFFFFF', ctaSubColor: '#EC4899' }, 'CARDIO_DANCE', { ctaBande: c.bande });
    const m = miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: c.bande, format: c.format, cta: { texte: d.ctaText, sousTexte: d.ctaSubText, echelle: 1 } })!;
    const base = {
      miseEnPage: m, format: c.format, largeur: W, hauteur: H,
      titre: { title: d.title, subtitle: d.subtitle, typography: TYPO_T, subtitleTypography: { font: null, color: null, scale: 1 } },
      cartes: { cards: d.cards, valueColor: '#EC4899' },
      cta: { text: d.ctaText, subText: d.ctaSubText, typography: TYPO_C },
    };
    const elements: Array<[keyof ReturnType<typeof cadres>, React.ComponentProps<typeof PlateauSurimpression>['element']]> = [
      ['titre', 'titre'], ['cta', 'cta'], ...d.cards.map((_k, i) => ['cartes', { carte: i }] as [keyof ReturnType<typeof cadres>, { carte: number }]),
    ];
    for (const [cle, e] of elements) {
      const creer = cadres(render(<PlateauSurimpression {...base} element={e} />).container);
      cleanup();
      const remotion = cadres(render(<CreerSimpleMontage {...(auto as unknown as React.ComponentProps<typeof CreerSimpleMontage>)} stillSurimpression={e} />).container);
      cleanup();
      expect(creer[cle], `${cle} ${JSON.stringify(e)}`).toBeTruthy();
      expect(creer[cle], `${cle} ${JSON.stringify(e)}`).toBe(remotion[cle]);
    }
  });

  it.each(PROFILS_AUTO)('profil %s : tout dans l’image (marges ≥ 5 %), visage libre, CTA au-dessus des filigranes', (profil) => {
    const d = appliquerMiseEnPageSurimpression(designDe(c), profil, { ctaBande: c.bande }) as Record<string, any>;
    const boites = boitesSurimpression(d, c.format);
    for (const [el, b] of Object.entries(boites) as Array<[string, BoiteImage]>) {
      expect(b.x0, el).toBeGreaterThanOrEqual(5); expect(b.y0, el).toBeGreaterThanOrEqual(5);
      expect(b.x1, el).toBeLessThanOrEqual(95); expect(b.y1, el).toBeLessThanOrEqual(95);
      expect(couvertureVisage(b, ZONE_VISAGE[c.format]), el).toBeLessThanOrEqual(0.1);
    }
    // 16:9 : trois colonnes / bandes disjointes. 1:1 : jamais affichés ensemble (`planOverlays`).
    if (c.format === '16:9') {
      const chevauche = (a: BoiteImage, b: BoiteImage) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
      expect(chevauche(boites.titre, boites.carte)).toBe(false);
      expect(chevauche(boites.carte, boites.cta)).toBe(false);
      expect(chevauche(boites.titre, boites.cta)).toBe(false);
    }
    // Bas du panneau CTA ≥ 18 px au-dessus du haut de la ligne du filigrane
    // Remotion (`Filigrane` : bas à 24 px éditeur, 11 px de corps, interligne
    // normal ≤ 1,25) et des glyphes du `siteText` de Créer (ligne de base 96 %,
    // 40,5 px, ascendante ≤ 0,75 em + 1,5 px de contour). Mesuré : 18,6 / 20,5 /
    // 22 px.
    const echelle = W / editorViewportPx(false);
    const hautFiligraneRemotion = H - 24 * echelle - 11 * echelle * 1.25;
    const hautSiteTextCreer = 0.96 * H - 40.5 * 0.75 - 1.5;
    const basCta = (d.ctaPos.y / 100) * H;
    expect(Math.min(hautFiligraneRemotion, hautSiteTextCreer) - basCta).toBeGreaterThanOrEqual(10);
  });
});

describe('source unique des formats larges', () => {
  it('la mise en page de Créer = celle de l’Autopilote (positions, largeurs, échelles), bande haute comprise', () => {
    for (const f of FORMATS) for (const bande of BANDES) for (const [nc, cta] of Object.entries(CTAS)) {
      const d = { ...TITRES.long, ...cta, format: f };
      const auto = appliquerMiseEnPageSurimpression(d, 'CARDIO_DANCE', { ctaBande: bande }) as Record<string, any>;
      const m = miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: bande, format: f, cta: { texte: cta.ctaText, sousTexte: cta.ctaSubText, echelle: 1 } })!;
      const e = echellesSurimpressionLarge(f, { titre: d.title, sousTitre: d.subtitle, cta: cta.ctaText, sousTexteCta: cta.ctaSubText });
      const k = `${f} ${bande} ${nc}`;
      expect(m.titlePos, k).toEqual(auto.titlePos);
      expect(m.titleWidth, k).toBe(auto.titleWidth);
      expect(m.ctaPos, k).toEqual(auto.ctaPos);
      expect(m.ctaWidth, k).toBe(auto.ctaWidth);
      expect({ c0: m.carte }, k).toEqual(auto.cardBoxes);
      expect(m.carteScale, k).toBe(auto.cardsTypography.scale);
      expect(e.titleScale, k).toBe(auto.titleScale);
      expect(e.subtitleScale, k).toBe(auto.subtitleScale);
      expect(e.ctaScale, k).toBe(auto.ctaScale);
    }
  });
  it('bas du CTA : 85 % en 16:9, 91 % en 1:1 (au-dessus des filigranes) ; le reste inchangé', () => {
    expect(miseEnPageSurimpression('CARDIO_DANCE', { format: '16:9' })!.ctaPos).toEqual({ x: 50, y: 85 });
    expect(miseEnPageSurimpression('CARDIO_DANCE', { format: '1:1' })!.ctaPos).toEqual({ x: 50, y: 91 });
  });
  it('profils hors surimpression : la porte de Créer reste fermée en format large aussi', () => {
    for (const f of FORMATS) expect(miseEnPageSurimpression('STANDARD', { format: f })).toBeNull();
  });
});
