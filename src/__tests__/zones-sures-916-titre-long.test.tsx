/**
 * TITRE LONG AGRANDI EN 9:16 — le bloc ne passe plus sous le rail d'actions.
 *
 * Avant : le cadre du titre plein écran (8 % → 92 %) gardait sa largeur quelle
 * que soit sa hauteur. Un titre long agrandi (échelle jusqu'à `SCALE_MAX` = 3)
 * descendait sous 35 % — hauteur du rail d'actions (85–100 %, 35–80 %) — avec
 * son bord droit à 92 % : collision avec j'aime / commentaires / partage. À
 * l'échelle 3, le bloc estimé finissait même à 107 % de la hauteur (titre
 * long) et 188 % (très long), hors de l'image.
 *
 * Règle (`titreSur916`) : bord droit arrêté au rail quand le bloc PEUT
 * atteindre sa hauteur ; repli minimal de l'échelle seulement si, replié, il
 * descendrait sous la zone des descriptions (78 %). Position jamais touchée.
 *
 * Géométrie MESURÉE dans Chromium (boîtes réelles du cadre titre, police
 * Inter 900 chargée, aperçu `Preview` à 1080 × 1920 et 358 × 636) : voir
 * `MESURE_CHROMIUM` — l'estimation doit rester au-dessus.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import {
  ZONE_SURE_916, LARGEUR_TITRE_MIN_916, positionTexteEffective, titreSur916, boiteTitre916,
  horsZoneSure916, echelleTitreSansDebord, boiteTitre, BAS_TITRE_HORS_916, type TitreAPlacer916,
} from '@/lib/creer/zones-sures-916';
import { SCALE_MAX } from '@/lib/autopilot/textStyle';
import { FONT_RATIO, TEXT_LAYOUT, VIDEO_SIZE } from '@/lib/creer/designSpec';
import { GEL_TEXT } from './fixtures/zones-sures-916-entrees';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

const { w: W, h: H } = VIDEO_SIZE['9:16'];
const APERCU_MOBILE = { l: 390 - 2 * 16, h: ((390 - 2 * 16) * 16) / 9 };
const LONG = 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL ET VOTRE ÉNERGIE';
const TRES_LONG = 'POURQUOI VOTRE CORPS RÉCLAME DIX MINUTES DE DANSE CARDIO CHAQUE MATIN AVANT LE TRAVAIL, ET CE QUE PERSONNE NE VOUS DIT SUR LA RÉCUPÉRATION';
const SOUS = 'Et comment les corriger dès ce soir, sans médicament';

const CAS = {
  A: { titre: LONG, echelle: 1 },
  B: { titre: LONG, echelle: SCALE_MAX },
  C: { titre: TRES_LONG, echelle: SCALE_MAX },
} as const;

const titre = (t: string, echelle: number, pos = positionTexteEffective('title', TEXT_LAYOUT.titlePos, '9:16'), police = 'Inter'): TitreAPlacer916 => ({
  format: '9:16', pos, largeur: TEXT_LAYOUT.titleWidth, echelle, titre: t, sousTitre: SOUS, echelleSousTitre: 1,
  interligne: 1.1, espacement: 0, police, policeSousTitre: null,
});

/** Les trois contraintes, à la vidéo ET à l'aperçu mobile (boîte en %, convertie en px). */
function zoneSure(b: { x0: number; y0: number; x1: number; y1: number }, quoi: string) {
  for (const [l, h] of [[W, H], [APERCU_MOBILE.l, APERCU_MOBILE.h]]) {
    const haut = (b.y0 / 100) * h; const bas = (b.y1 / 100) * h; const droite = (b.x1 / 100) * l;
    expect(haut, `${quoi} haut @${l}`).toBeGreaterThanOrEqual((ZONE_SURE_916.haut / 100) * h - 1e-6);
    expect(bas, `${quoi} bas @${l}`).toBeLessThanOrEqual((ZONE_SURE_916.bas / 100) * h + 1e-6);
    if (bas > (ZONE_SURE_916.railHaut / 100) * h) {
      expect(droite, `${quoi} rail @${l}`).toBeLessThanOrEqual((ZONE_SURE_916.droite / 100) * l + 1e-6);
    }
  }
  expect(horsZoneSure916(b), quoi).toEqual([]);
}

/** Rend l'aperçu de Créer et relit le cadre du titre (style) et la taille de police. */
function apercu(t: string, echelle: number, titlePos: { x: number; y: number } = TEXT_LAYOUT.titlePos, displayScale = 1) {
  const frameRef = { current: null } as React.RefObject<HTMLDivElement>;
  const { container } = render(
    <Preview generated={{ title: t, subtitle: SOUS, cards: [], cta: 'ESSAI', ctaSub: 'LIEN EN BIO' } as never} format="9:16"
      frameRef={frameRef} displayScale={displayScale} activeOrder={['intro']} gradStart="#7C3AED" gradEnd="#EC4899"
      gradientOpacity={0.3} accent="#7C3AED" text={{ ...GEL_TEXT, title: { ...GEL_TEXT.title, scale: echelle } } as never}
      titlePos={titlePos} />,
  );
  const cadre = (container.querySelector('[data-subtitle-block]') as HTMLElement).parentElement as HTMLElement;
  const res = {
    left: parseFloat(cadre.style.left), top: parseFloat(cadre.style.top), width: parseFloat(cadre.style.width),
    fontPx: parseFloat((cadre.firstElementChild as HTMLElement).style.fontSize),
  };
  cleanup();
  return res;
}

/**
 * Mesures Chromium (headless, local) des cadres titre rendus par `Preview`,
 * Inter 900 chargée — en % du plateau, identiques à 1080 × 1920 et 358 × 636.
 * Balayage complémentaire (échelles 1 à 3 par 0,1, Inter, Syne, Anton, Rubik
 * Mono One, Alfa Slab One — 105 rendus) : aucune violation.
 */
const MESURE_CHROMIUM = {
  A: { haut: 12, droite: 92, bas: 22.15 },
  B: { haut: 12, droite: 85, bas: 75.91 },
  C: { haut: 12, droite: 85, bas: 74.11 },
  deplace: { haut: 30, droite: 85, bas: 67.72 },
};

// ─────────────────────────────────────────────────────────────────────────
describe('taille maximale réelle du titre', () => {
  it('SCALE_MAX = 3 : borne du curseur « Taille » et des poignées', () => {
    expect(SCALE_MAX).toBe(3);
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(w).toContain('max={Math.round(SCALE_MAX * 100)}');
    expect(w).toContain('min: SCALE_MIN, max: SCALE_MAX');
  });
  it('AVANT la règle : à l’échelle 3, le titre long passait sous le rail (bord droit 92 %) et sortait de l’image', () => {
    for (const k of ['B', 'C'] as const) {
      const b = boiteTitre916(titre(CAS[k].titre, CAS[k].echelle), TEXT_LAYOUT.titleWidth, CAS[k].echelle);
      expect(b.x1).toBe(92);
      expect(b.y1).toBeGreaterThan(100);
      expect(horsZoneSure916(b).some((m) => m.startsWith('rail droit'))).toBe(true);
    }
  });
});

describe('A / B / C — titre long, taille normale et maximale : dans la zone sûre aux deux tailles', () => {
  it.each(Object.entries(CAS))('%s : haut ≥ 12 %, bas ≤ 78 %, bord droit ≤ 85 % dès 35 % (estimé)', (k, c) => {
    const t = titre(c.titre, c.echelle);
    const r = titreSur916(t);
    zoneSure(boiteTitre916(t, r.largeur, r.echelle), k);
  });
  it.each(Object.entries(CAS))('%s : mesuré dans Chromium — mêmes contraintes, et l’estimation reste au-dessus du rendu', (k) => {
    const m = MESURE_CHROMIUM[k as keyof typeof MESURE_CHROMIUM];
    zoneSure({ x0: 8, y0: m.haut, x1: m.droite, y1: m.bas }, `${k} mesuré`);
    const c = CAS[k as keyof typeof CAS];
    const t = titre(c.titre, c.echelle);
    const r = titreSur916(t);
    expect(boiteTitre916(t, r.largeur, r.echelle).y1).toBeGreaterThanOrEqual(m.bas);
    expect(8 + r.largeur).toBe(m.droite);
  });
  it('A (échelle 1) : rien ne change — bloc au-dessus du rail, largeur 84 %, taille 1', () => {
    expect(titreSur916(titre(LONG, 1))).toEqual({ largeur: TEXT_LAYOUT.titleWidth, echelle: 1 });
  });
  it('B : la largeur suffit à libérer le rail ; l’échelle ne baisse que pour rester au-dessus des descriptions, et au minimum', () => {
    const t = titre(LONG, SCALE_MAX);
    const r = titreSur916(t);
    expect(r.largeur).toBe(ZONE_SURE_916.droite - 8);
    expect(r.echelle).toBeLessThan(SCALE_MAX);
    expect(r.echelle).toBeGreaterThan(2);
    // Un centième de plus et le bloc passerait sous 78 % : le repli est minimal.
    expect(boiteTitre916(t, r.largeur, r.echelle + 0.01).y1).toBeGreaterThan(ZONE_SURE_916.bas);
  });
  it('C : très long, multi-lignes, échelle 3 → replié à 77 % puis réduit au minimum nécessaire, jamais sous 1', () => {
    const t = titre(TRES_LONG, SCALE_MAX);
    const r = titreSur916(t);
    expect(r.largeur).toBe(77);
    expect(r.echelle).toBeGreaterThanOrEqual(1);
    expect(boiteTitre916(t, r.largeur, r.echelle + 0.01).y1).toBeGreaterThan(ZONE_SURE_916.bas);
  });
  it('l’aperçu de Créer applique exactement ces valeurs (cadre et taille de police), à 1080 et à l’aperçu mobile', () => {
    for (const c of Object.values(CAS)) {
      const r = titreSur916(titre(c.titre, c.echelle));
      for (const ds of [1, APERCU_MOBILE.l / W]) {
        const a = apercu(c.titre, c.echelle, TEXT_LAYOUT.titlePos, ds);
        expect(a).toEqual({ left: 8, top: ZONE_SURE_916.haut, width: r.largeur, fontPx: W * FONT_RATIO['9:16'].title * r.echelle });
      }
    }
  });
});

describe('titre déplacé à la main : position gardée, largeur arrêtée au rail', () => {
  const pos = { x: 20, y: 30 };
  it('position intacte, bord droit 85 %, bloc au-dessus des descriptions', () => {
    expect(positionTexteEffective('title', pos, '9:16')).toEqual(pos);
    const t = titre(LONG, 2, pos);
    const r = titreSur916(t);
    expect(r.largeur).toBe(65);
    const b = boiteTitre916(t, r.largeur, r.echelle);
    expect({ x0: b.x0, y0: b.y0, x1: b.x1 }).toEqual({ x0: 20, y0: 30, x1: 85 });
    expect(b.y1).toBeLessThanOrEqual(ZONE_SURE_916.bas);
    const a = apercu(LONG, 2, pos);
    expect({ left: a.left, top: a.top, width: a.width }).toEqual({ left: 20, top: 30, width: 65 });
    const m = MESURE_CHROMIUM.deplace;
    expect(m).toEqual({ haut: 30, droite: 85, bas: m.bas });
    expect(m.bas).toBeLessThanOrEqual(ZONE_SURE_916.bas);
  });
  it('posé au-delà de 55 % : position gardée, largeur plancher (30 %), jamais déplacé', () => {
    const r = titreSur916(titre(LONG, 2, { x: 70, y: 40 }));
    expect(r.largeur).toBe(LARGEUR_TITRE_MIN_916);
  });
  it('un titre étroit (bord droit déjà ≤ 85 %) ne change pas de largeur', () => {
    const t = { ...titre(LONG, 2), largeur: 60 };
    expect(titreSur916(t).largeur).toBe(60);
  });
});

describe('règle bornée au 9:16 plein écran', () => {
  it('16:9 et 1:1 : largeur choisie telle quelle ; échelle réduite si un MOT déborderait ou si le bloc sortait du bas (#613)', () => {
    for (const f of ['16:9', '1:1'] as const) {
      // Règle « aucun mot ne déborde » (tout format, 20/10) : « RÉCUPÉRATION »
      // à l'échelle 3 sortait du cadre (≈ 1 693 px pour 1 613 px utiles).
      const r = titreSur916({ ...titre(TRES_LONG, SCALE_MAX), format: f });
      expect(r.largeur).toBe(TEXT_LAYOUT.titleWidth);
      expect(r.echelle).toBeLessThanOrEqual(echelleTitreSansDebord({ ...titre(TRES_LONG, SCALE_MAX), format: f }));
      expect(r.echelle).toBeLessThan(SCALE_MAX);
      // #613 : aucun texte hors cadre — le bloc reste au-dessus de la zone sûre basse.
      expect(boiteTitre({ ...titre(TRES_LONG, SCALE_MAX), format: f }, r.largeur, r.echelle).y1).toBeLessThanOrEqual(BAS_TITRE_HORS_916 + 1e-6);
      // Un titre qui tient (mots ET bloc) garde exactement son échelle.
      expect(titreSur916({ ...titre('DANSE AU SOLEIL', 1.5), format: f })).toEqual({ largeur: TEXT_LAYOUT.titleWidth, echelle: 1.5 });
      // #613 : à l'échelle 3, le bloc (titre + sous-titre) descendait sous la zone sûre : il est réduit juste assez.
      const grand = titreSur916({ ...titre('DANSE AU SOLEIL', SCALE_MAX), format: f });
      expect(boiteTitre({ ...titre('DANSE AU SOLEIL', SCALE_MAX), format: f }, grand.largeur, grand.echelle).y1).toBeLessThanOrEqual(BAS_TITRE_HORS_916 + 1e-6);
    }
  });
  it('idempotente : la réappliquer à son résultat ne change rien', () => {
    for (const c of Object.values(CAS)) {
      const t = titre(c.titre, c.echelle);
      const r = titreSur916(t);
      expect(titreSur916({ ...t, largeur: r.largeur, echelle: r.echelle })).toEqual(r);
    }
  });
  it('une échelle choisie sous 1 n’est jamais relevée ; le repli ne descend jamais sous 1', () => {
    expect(titreSur916(titre(LONG, 0.8)).echelle).toBe(0.8);
    expect(titreSur916(titre(Array(6).fill(TRES_LONG).join(' '), SCALE_MAX)).echelle).toBe(1);
  });
});

describe('câblage — aperçu, compositeur, métadonnées et Remotion lisent la même règle', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');
  it('Créer : aperçu (cadre + échelle), compositeur (`titleSize`, `textScale`) et métadonnées', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain('const titre916 = titreRendu916(format, titlePos, titleWidth, text, generated?.title, generated?.subtitle);');
    expect(w).toContain('typography={titleTypography}');
    expect(w).toContain('const titre916 = titreRendu916(format, titlePos, titleWidth, textStyles, contenu.title, contenu.subtitle);');
    expect(w).toContain('titleSize: titre916.largeur,');
    expect(w).toContain('title: titre916.largeur,');
    expect(w.match(/\.\.\.textDesignRendu,/g)).toHaveLength(2);
    expect(w).not.toMatch(/^\s*\.\.\.textDesign,\s*$/m);
    // Le brouillon garde la largeur CHOISIE (rien n'est réécrit à l'utilisateur).
    expect(w).toContain('titleWidth: titleWidth === DESIGN.titleWidth ? undefined : titleWidth');
  });
  it('Remotion : plein écran seulement — les surimpressions gardent leur mise en page (#502)', () => {
    const r = src('remotion/CreerSimpleMontage.tsx');
    expect(r).toContain('{blocTitre(anim.reveal, true)}');
    expect(r).toContain('{blocTitre(1)}');
    expect(r).toContain('<AbsoluteFill>{blocTitre(1)}</AbsoluteFill>');
    expect(r).toContain('const t916 = pleinEcran ? titreSur916({');
  });
});
