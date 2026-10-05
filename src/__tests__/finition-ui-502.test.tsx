/**
 * #502 — FINITION UI CARDIO_DANCE : accroche bornée, anti-répétition flash
 * (3 s), CTA lisible (panneau + bande calme MESURÉE). Référence DANSE.
 * Aucune détection de visage ou de corps : mesures d'image seulement.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { planMontage, mesuresSegments, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan, FENETRE_FLASH_S, prolonge } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';
import {
  miseEnPageSurimpression, appliquerMiseEnPageSurimpression, ajusterAccroche, eclaircir, ACCROCHE_HAUTEUR_MAX,
} from '@/lib/creer/surimpressions-mise-en-page';
import { zoneCalmeSortie, activiteBandes } from '@/lib/creer/zone-calme';
import { FONT_RATIO } from '@/lib/creer/designSpec';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';

const analyses = danse.analyses as AnalyseRush[];
const contexte = contexteMontageDepuis({
  theme: 'danse', titre: 'DANSE', sousTitre: 'Danser active plus de muscles que la plupart des sports',
  cartes: [{ title: 'MÉMOIRE BOOSTÉE' }, { title: 'CARDIO COMPLET' }, { title: 'OS RENFORCÉS' }, { title: 'ANTI-ÂGE' }, { title: '300+ MUSCLES' }],
});
const SOUS_TITRE = 'Danser active plus de muscles que la plupart des sports';

// ── 1. ACCROCHE ───────────────────────────────────────────────────────────
describe('accroche : ≤ 14 % de la hauteur, toujours lisible', () => {
  const base = { titre: 'DANSE', sousTitre: SOUS_TITRE, largeur: 1080, hauteur: 1920, ratioTitre: FONT_RATIO['9:16'].title, ratioSousTitre: FONT_RATIO['9:16'].subtitle };

  it('échelle par défaut : inchangée (1,9) ; échelle utilisateur grande : plafonnée', () => {
    expect(ajusterAccroche({ ...base, echelleTitre: 1.9, echelleSousTitre: 0.7 }).echelleTitre).toBe(1.9);
    const grand = ajusterAccroche({ ...base, echelleTitre: 2.5 * 1.9, echelleSousTitre: 0.7 });
    expect(grand.echelleTitre).toBeLessThan(2.5 * 1.9);
    // Lisible : titre ≥ 64 px, sous-titre ≥ 34 px.
    expect(1080 * FONT_RATIO['9:16'].title * grand.echelleTitre).toBeGreaterThanOrEqual(64);
    expect(1080 * FONT_RATIO['9:16'].subtitle * grand.echelleTitre * 0.7).toBeGreaterThanOrEqual(34);
  });

  it('Créer et Autopilote : la MÊME règle (plateau et design Remotion)', () => {
    const d = appliquerMiseEnPageSurimpression({ title: 'DANSE', subtitle: SOUS_TITRE, titleScale: 2.5 }, 'CARDIO_DANCE') as { titleScale: number };
    expect(d.titleScale).toBeCloseTo(ajusterAccroche({ ...base, echelleTitre: 2.5 * 1.9, echelleSousTitre: 0.7 }).echelleTitre, 6);
    expect(readFileSync(resolve(process.cwd(), 'src/components/creer/PlateauSurimpression.tsx'), 'utf-8')).toContain('const accroche = ajusterAccroche({');
    expect(ACCROCHE_HAUTEUR_MAX).toBe(0.14);
  });
});

// ── 2. ANTI-RÉPÉTITION FLASH ──────────────────────────────────────────────
describe.each([21.45, 24.288, 30.3])('anti-répétition 3 s — DANSE %s s', (cible) => {
  const plan = planMontage(analyses, cible, { rythme: danse.rythme, contexte })!;
  const r = rapportPlan('CARDIO_DANCE', mesuresSegments(plan, analyses)!, danse.rythme);
  it('RECENT_DUPLICATE_EXACT_COUNT = 0, RECENT_DUPLICATE_SIMILAR_COUNT = 0', () => {
    expect(FENETRE_FLASH_S).toBe(3);
    expect(r.RECENT_DUPLICATE_EXACT_COUNT).toBe(0);
    expect(r.RECENT_DUPLICATE_SIMILAR_COUNT).toBe(0);
  });
});

describe('anti-répétition : la règle', () => {
  it('un plan CONTINU coupé en deux n’est pas une répétition', () => {
    expect(prolonge({ cle: 'a', depuis: 2, jusqua: 3, empreinte: null }, { cle: 'a', depuis: 3.1, jusqua: 4, empreinte: null })).toBe(true);
    expect(prolonge({ cle: 'a', depuis: 2, jusqua: 3, empreinte: null }, { cle: 'a', depuis: 8, jusqua: 9, empreinte: null })).toBe(false);
  });

  it('même matière à moins de 3 s : comptée ; plus loin : non', () => {
    const seg = (debut: number, fin: number, depuis: number) => ({ cle: 'a', depuis, jusqua: depuis + (fin - debut), debut, fin, phase: null, empreinte: null, saturation: null, luminosite: null, energie: null });
    expect(rapportPlan('CARDIO_DANCE', [seg(0, 1, 5), seg(1, 2, 20), seg(2, 3, 5.2)]).RECENT_DUPLICATE_EXACT_COUNT).toBe(1);
    expect(rapportPlan('CARDIO_DANCE', [seg(0, 1, 5), seg(1, 4, 20), seg(4, 5, 5.2)]).RECENT_DUPLICATE_EXACT_COUNT).toBe(0);
  });
});

// ── 3. CTA LISIBLE ────────────────────────────────────────────────────────
describe('CTA : panneau, contraste, bande calme mesurée', () => {
  const m = miseEnPageSurimpression('CARDIO_DANCE')!;
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const alpha = Number(/,\s*([\d.]+)\)$/.exec(m.ctaFond)![1]);
  // PIRE cas : un plan blanc derrière le panneau.
  const gris = 1 - alpha;
  const fondPire = gris <= 0.04045 ? gris / 12.92 : ((gris + 0.055) / 1.055) ** 2.4;

  it('CTA_CONTRAST_OK : titre blanc et ligne d’action éclaircie ≥ 3:1 même sur un plan blanc', () => {
    expect(ratio(1, fondPire)).toBeGreaterThanOrEqual(3);
    expect(ratio(lum(eclaircir('#EC4899', m.ctaActionEclaircie)!), fondPire)).toBeGreaterThanOrEqual(3);
  });

  it('CTA_BACKGROUND_PANEL : le plateau du CTA porte le panneau ; textes du CTA inchangés (#500)', () => {
    const html = renderToStaticMarkup(
      <PlateauSurimpression
        element="cta" miseEnPage={m} format="9:16" largeur={1080} hauteur={1920}
        titre={{ title: 'DANSE', typography: {} as never, subtitleTypography: {} as never }}
        cartes={{ cards: [], valueColor: '#882591' }}
        cta={{ text: 'LE SPORT LE PLUS COMPLET', subText: 'Réservez votre cours d’essai sur afroboost.com.', typography: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } as never }}
      />,
    );
    expect(html).toContain('data-cta-fond');
    expect(html).toContain('background-color:rgba(0,0,0,0.6)');
    expect(html).toContain('LE SPORT LE PLUS COMPLET');
    expect(html).toContain('Réservez votre cours d’essai sur afroboost.com.');
  });

  it('bande calme : mesurée sur les plans de sortie DANSE, CTA en haut ou en bas (jamais au centre)', () => {
    const plan = planMontage(analyses, 24.288, { rythme: danse.rythme, contexte })!;
    const debutCta = planOverlays({ duree: 24.288, nbCartes: 5, finHook: 1, profil: 'CARDIO_DANCE' }).cta![0];
    const z = zoneCalmeSortie(plan, analyses, debutCta)!;
    expect(z).not.toBeNull();
    expect(['haut', 'bas']).toContain(z.bande);
    expect(z.score).toBeGreaterThanOrEqual(0);
    expect(z.activite[z.bande]).toBeLessThanOrEqual(Math.max(z.activite.haut, z.activite.bas));
    expect(miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: z.bande })!.ctaPos.y).toBe(z.bande === 'haut' ? 34 : 76);
  });

  it('rien de mesurable : le CTA reste en bas, comme avant', () => {
    expect(activiteBandes({ url: 'x', duree: 5, echantillons: [{ t: 1, mouvement: 0, luminosite: 0.5, nettete: 0.1, audio: 0 }] }, 0, 5)).toBeNull();
    expect(miseEnPageSurimpression('CARDIO_DANCE')!.ctaPos).toEqual({ x: 50, y: 76 });
  });

  it('Créer et Autopilote : même mesure, même mise en page', () => {
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    const a = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(w).toContain('zoneCalmeSortie(planMontageRushs, montageInfos.analyses, overlaysCreer.cta[0])');
    expect(a).toContain('zoneCalmeSortie(planMontageRushs, analysesRushs, overlays.cta[0])');
    expect(a).toContain('appliquerMiseEnPageSurimpression(design, profilVideo, { ctaBande: zoneCta?.bande })');
    expect(readFileSync(resolve(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf-8')).toContain('fond={props.ctaBackground ?? null}');
  });
});
