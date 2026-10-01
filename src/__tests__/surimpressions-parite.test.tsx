/**
 * #494 — PARITÉ DES TEXTES EN SURIMPRESSION, CRÉER + AUTOPILOTE.
 *
 * Une seule mise en page (`surimpressions-mise-en-page.ts`), une seule
 * logique de fenêtres (`planOverlays` + `TEXTES_PROFILS`), les mêmes
 * composants (`PlateauSurimpression` = ceux de Remotion), et le même
 * fondu / glissement / voile côté compositeur (`dessinerSurimpressions`).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { planMontage, profilMontageDuContexte, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, TEXTES_PROFILS } from '@/lib/creer/smart-montage-regles';
import { planOverlays, profilEnSurimpression } from '@/lib/creer/overlays';
import { miseEnPageSurimpression, appliquerMiseEnPageSurimpression, eclaircir } from '@/lib/creer/surimpressions-mise-en-page';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';
import { dessinerSurimpressions, type SurimpressionsComposer } from '@/lib/video-composer';

const analyses = danse.analyses as AnalyseRush[];
const TEXTES = { sousTitre: 'Danser active plus de muscles que la plupart des sports', cartes: [{ title: 'MÉMOIRE BOOSTÉE' }, { title: 'CARDIO COMPLET' }, { title: 'OS RENFORCÉS' }, { title: 'ANTI-ÂGE' }, { title: '300+ MUSCLES' }] };
const cCreer = contexteMontageDepuis({ theme: 'danse', titre: 'DANSE', ...TEXTES });
const cAuto = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', ...TEXTES });
const profil = profilMontageDuContexte(cCreer).profil;
const plan = planMontage(analyses, 24.288, { rythme: danse.rythme, contexte: cCreer })!;
const dureeVideo = plan.at(-1)!.fin;
const finHook = plan.filter((s) => s.phase === 'HOOK').at(-1)!.fin;

describe('CARDIO_DANCE : mêmes fenêtres de textes des deux côtés', () => {
  it('CREATE_PROFILE = AUTOPILOT_PROFILE = CARDIO_DANCE, en surimpression', () => {
    expect(profil).toBe('CARDIO_DANCE');
    expect(profilMontageDuContexte(cAuto).profil).toBe('CARDIO_DANCE');
    expect(profilEnSurimpression(profil)).toBe(true);
  });

  it('HOOK → BENEFITS → CTA : accroche ≤ 3 s dès 0, cartes ≥ 3 s (proportionnel sous 30 s), CTA en fin', () => {
    // Créer et Autopilote appellent la MÊME fonction avec les mêmes entrées.
    const o = planOverlays({ duree: dureeVideo, nbCartes: 5, finHook, profil });
    expect(o.titre![0]).toBe(0);
    expect(o.titre![1]).toBeLessThanOrEqual(TEXTES_PROFILS.CARDIO_DANCE.accroche.dureeMax + 1e-6);
    o.cartes.forEach((c) => {
      expect(c.debut).toBeGreaterThan(o.titre![1]);
      expect(c.fin).toBeLessThan(o.cta![0]);
      expect(c.fin - c.debut).toBeGreaterThanOrEqual(3 * Math.min(1, dureeVideo / 30) - 1e-6);
    });
    expect(o.cta![1]).toBeCloseTo(dureeVideo, 3);
    // Une carte de 3 s traverse plusieurs plans de 1–2 s.
    const c0 = o.cartes[0];
    expect(plan.filter((s) => s.fin > c0.debut && s.debut < c0.fin).length).toBeGreaterThanOrEqual(2);
  });
});

describe('mise en page partagée', () => {
  const m = miseEnPageSurimpression('CARDIO_DANCE')!;
  it('accroche en HAUT, carte en BAS-GAUCHE, CTA plus central qu\'avant (92 % → 76 %)', () => {
    expect(m.titlePos.y).toBeLessThanOrEqual(10);
    expect(m.carte.x).toBe(0);
    // Cadre des cartes 30 %–78 % : la carte commence sous 60 % de l'image.
    expect(0.30 + (m.carte.y / 100) * 0.48).toBeGreaterThan(0.6);
    expect(m.ctaPos.y).toBeLessThan(92);
    expect(m.ctaPos.y).toBeGreaterThan(50);
  });

  it('profil sans surimpression : design inchangé ; sinon échelles MULTIPLIÉES (jamais écrasées)', () => {
    const d = { title: 't', titleScale: 1.2, ctaScale: 1, gradientEnd: '#882591' };
    expect(appliquerMiseEnPageSurimpression(d, 'STANDARD')).toBe(d);
    const a = appliquerMiseEnPageSurimpression(d, 'CARDIO_DANCE') as Record<string, unknown>;
    expect(a.titleScale).toBeCloseTo(1.2 * m.titleScale);
    expect(a.cardBoxes).toEqual({ c0: m.carte });
    expect(a.cardBackground).toBe(m.carteFond);
    expect(a.cardValueColor).toBe(eclaircir('#882591', m.valeurEclaircie));
    expect(eclaircir('#000000', 0.5)).toBe('#808080');
  });

  it('le plateau de Créer rend les MÊMES composants avec ces valeurs', () => {
    const base = {
      miseEnPage: m, format: '9:16' as const, largeur: 1080, hauteur: 1920,
      titre: { title: 'DANSE', subtitle: 'x', typography: { font: 'Inter', color: '#fff', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 }, subtitleTypography: { font: null, color: null, scale: 1 } },
      cartes: { cards: [{ icon: 'Brain', title: 'MÉMOIRE', value: '-76%' }], valueColor: '#882591' },
      cta: { text: 'Rejoins la session', typography: { font: 'Inter', color: '#fff', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } },
    };
    const carte = renderToStaticMarkup(<PlateauSurimpression {...base} element={{ carte: 0 }} />);
    expect(carte).toContain('background-color:rgba(0,0,0,0.55)');
    expect(carte).toContain(`left:${m.carte.x}%;top:${m.carte.y}%`);
    expect(carte).toContain('MÉMOIRE');
    const cta = renderToStaticMarkup(<PlateauSurimpression {...base} element="cta" />);
    expect(cta).toContain(`top:${m.ctaPos.y}%`);
    const titre = renderToStaticMarkup(<PlateauSurimpression {...base} element="titre" />);
    expect(titre).toContain(`top:${m.titlePos.y}%`);
    expect(titre).not.toContain('MÉMOIRE');
  });
});

describe('compositeur : même fondu / glissement / voile que Remotion', () => {
  const appels: Array<{ alpha: number; y?: number }> = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    save() {}, restore() { this.globalAlpha = 1; },
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    drawImage(_i: unknown, _x: number, y: number) { appels.push({ alpha: this.globalAlpha, y }); },
  };
  const img = {} as CanvasImageSource;
  const s: SurimpressionsComposer = {
    fenetres: { titre: [0, 3], cartes: [{ index: 0, debut: 4, fin: 7 }], cta: [21, 24], voix: {} },
    images: { titre: img, cartes: { 0: img }, cta: img },
  };
  const a = (t: number) => { appels.length = 0; dessinerSurimpressions(ctx as unknown as CanvasRenderingContext2D, 1080, 1920, t, s, 30); return appels.slice(); };

  it('entrée : opacité 0 → 1 sur 9 images, texte qui monte de 24 px', () => {
    expect(a(0)).toEqual([]);                          // image 0 : opacité 0
    expect(a(3 / 30)[0]).toEqual({ alpha: 1 / 3, y: 16 });
    expect(a(9 / 30)[0]).toEqual({ alpha: 1, y: 0 });
  });
  it('sortie : fondu sur les 9 dernières images, hors fenêtre rien', () => {
    expect(a(3.5)).toEqual([]);
    expect(a(4 + 85 / 30)[0].alpha).toBeCloseTo(5 / 9, 5);
    expect(a(10)).toEqual([]);
  });
});

describe('source unique, aucune règle recopiée', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');
  it('Autopilote : mise en page partagée appliquée au design Remotion / hybride', () => {
    const p = src('src/lib/autopilot/produire.ts');
    expect(p).toContain('if (overlays) design = appliquerMiseEnPageSurimpression(design, profilVideo);');
    expect(p).toContain('profil: profilVideo,');
  });
  it('Créer : mêmes fenêtres, même mise en page, mêmes composants', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain('overlaysCreer = planOverlays({');
    expect(w).toContain('profil: montageInfos.profil,');
    expect(w).toContain('miseEnPageSurimpression(montageInfos.profil)');
    expect(w).toContain('<PlateauSurimpression ref={plateauSurimpRef} {...plateauSurimp} />');
    expect(w).toContain('...(surimpressionsItem ? { surimpressions: surimpressionsItem } : {}),');
    expect(w).not.toMatch(/carteFond\s*:|titleScale:\s*2\.2|ctaPos:\s*\{\s*x:\s*50,\s*y:\s*76/);
    // « Modifier » retrouve les durées de l'éditeur, pas les 0 du rendu en surimpression.
    expect(w).toContain("intro: (surimpressionsItem ? dureePleinEcran : duree)('intro'),");
  });
  it('Remotion lit le fond et la couleur de valeur des cartes', () => {
    const r = src('remotion/CreerSimpleMontage.tsx');
    expect(r).toContain('fond={props.cardBackground ?? null}');
    expect(r).toContain('valueColor={props.cardValueColor || props.gradientEnd || DEFAULT_COLORS.gradientEnd}');
  });
});
