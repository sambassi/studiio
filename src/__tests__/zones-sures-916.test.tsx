/**
 * ZONES SÛRES DU 9:16 — titre trop haut, cartes sous le rail d'actions, CTA
 * de la bande haute sous la barre des réseaux.
 *
 * Mesuré AVANT (captures 1080 × 1920, Chromium) :
 *   - titre plein écran à 8 % et accroche en surimpression à 7 % : la
 *     première ligne sous la barre d'état / les onglets (0–12 %) ;
 *   - cartes en flux jusqu'à 92 % de la largeur, entre 30 % et 78 % de la
 *     hauteur : leurs valeurs sous le rail d'actions (85–100 %, 35–80 %) ;
 *   - CTA plein écran ancré à 92 % : dans la zone des descriptions (≥ 78 %) ;
 *   - CTA de la bande haute ancré par le BAS à 34 % : un CTA long remontait
 *     jusqu'à 10 % de la hauteur, sous la barre du haut.
 *
 * Le 16:9 et le 1:1 sont gelés : sorties identiques, caractère pour
 * caractère, à celles capturées sur 0e8de3f AVANT ce changement — sauf les
 * champs corrigés ensuite par la mise en page LARGE des surimpressions
 * (`surimpressions-formats-larges-geometrie.test.tsx`) : bas du CTA au-dessus
 * du filigrane, et Créer qui suit la mise en page large de l'Autopilote.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import SequenceCards from '@/components/creer/SequenceCards';
import {
  ZONE_SURE_916, TEXT_LAYOUT_916, CTA_BAS_916, RETRAIT_DROIT_CARTES_916,
  positionTexteParDefaut, positionTexteEffective, horsZoneSure916, type BoiteZone,
} from '@/lib/creer/zones-sures-916';
import {
  appliquerMiseEnPageSurimpression, miseEnPageSurimpression, boitesSurimpression,
  hauteurAccroche, hauteurCta, CTA_SOUS_TEXTE_DEFAUT,
} from '@/lib/creer/surimpressions-mise-en-page';
import { CARDS_FRAME, FONT_RATIO, TEXT_LAYOUT, VIDEO_SIZE } from '@/lib/creer/designSpec';
import { PLATFORM_SAFE_ZONES } from '@/lib/constants/platforms';
import { GEL_DESIGNS, GEL_PROFILS, GEL_GENERATED, GEL_TEXT, GEL_CARTES } from './fixtures/zones-sures-916-entrees';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

const { w: W, h: H } = VIDEO_SIZE['9:16'];
const R = FONT_RATIO['9:16'];

const TITRES = {
  court: { titre: 'DANSE CARDIO', sousTitre: 'Brûle 600 kcal' },
  long: { titre: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL ET VOTRE ÉNERGIE', sousTitre: 'Et comment les corriger dès ce soir, sans médicament' },
};
const CTAS = {
  court: { texte: 'ESSAI GRATUIT', sousTexte: 'LIEN EN BIO' },
  long: { texte: 'Réservez votre bilan sommeil gratuit sur afroboost.com', sousTexte: 'LIEN EN BIO' },
};
const CINQ = [
  { icon: 'Zap', title: 'Énergie', value: '+60%' },
  { icon: 'Brain', title: 'Cerveau boosté', value: '+15%' },
  { icon: 'Flame', title: 'Calories brûlées par séance de danse', value: '600' },
  { icon: 'Heart', title: 'Endurance cardio', value: '+25 %' },
  { icon: 'Moon', title: 'Sommeil réparateur', value: '8 h' },
];
const CARTES = { une: CINQ.slice(0, 1), plusieurs: CINQ };

/** Aperçu mobile : viewport 390 × 844, gouttière 16 px → plateau 358 px de large. */
const APERCU_MOBILE = { largeur: 390 - 2 * 16, hauteur: ((390 - 2 * 16) * 16) / 9 };
/** Boîte en px du plateau d'aperçu (mêmes % que la vidéo — le plateau est mis à l'échelle). */
const enPx = (b: BoiteZone, l: number, h: number) => ({ x0: (b.x0 / 100) * l, y0: (b.y0 / 100) * h, x1: (b.x1 / 100) * l, y1: (b.y1 / 100) * h });
/** Les deux tailles : vidéo 1080 × 1920 et aperçu 390 × 844. */
function dansZoneAuxDeuxTailles(b: BoiteZone, quoi: string) {
  expect(horsZoneSure916(b), `${quoi} ${JSON.stringify(b)}`).toEqual([]);
  for (const [l, h] of [[W, H], [APERCU_MOBILE.largeur, APERCU_MOBILE.hauteur]]) {
    const p = enPx(b, l, h);
    expect(p.y0, `${quoi} haut @${l}`).toBeGreaterThanOrEqual((ZONE_SURE_916.haut / 100) * h - 1e-6);
    expect(p.y1, `${quoi} bas @${l}`).toBeLessThanOrEqual((ZONE_SURE_916.bas / 100) * h + 1e-6);
    if (p.y1 > (ZONE_SURE_916.railHaut / 100) * h && p.y0 < (ZONE_SURE_916.railBas / 100) * h) {
      expect(p.x1, `${quoi} rail @${l}`).toBeLessThanOrEqual((ZONE_SURE_916.droite / 100) * l + 1e-6);
    }
    expect(p.x0, `${quoi} gauche @${l}`).toBeGreaterThanOrEqual(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────
describe('une seule définition, lue dans PLATFORM_SAFE_ZONES', () => {
  it('bas = 100 − description la plus haute (TikTok 22 %), rail = 15 % de 35 % à 80 %, haut 12 %', () => {
    expect(PLATFORM_SAFE_ZONES.tiktok.zones.find((z) => z.label === 'Description')!.height).toBe('22%');
    expect(ZONE_SURE_916).toEqual({ haut: 12, bas: 78, droite: 85, railHaut: 35, railBas: 80 });
  });
  it('placement par défaut 9:16 : titre 8 % / 12 %, CTA 50 % / 76 % ; 16:9 et 1:1 : `TEXT_LAYOUT` d’avant', () => {
    expect(TEXT_LAYOUT_916).toEqual({ titlePos: { x: 8, y: 12 }, ctaPos: { x: 50, y: CTA_BAS_916 } });
    expect(CTA_BAS_916).toBe(76);
    expect(TEXT_LAYOUT.titlePos).toEqual({ x: 8, y: 8 });
    expect(TEXT_LAYOUT.ctaPos).toEqual({ x: 50, y: 92 });
    for (const f of ['16:9', '1:1'] as const) {
      expect(positionTexteParDefaut('title', f)).toBe(TEXT_LAYOUT.titlePos);
      expect(positionTexteParDefaut('cta', f)).toBe(TEXT_LAYOUT.ctaPos);
    }
  });
  it('retrait droit des cartes : 100 − 8 − 85 = 7 % de la largeur', () => {
    expect(CARDS_FRAME.right).toBe('8%');
    expect(RETRAIT_DROIT_CARTES_916).toBe('7%');
  });
});

describe('positions de l’éditeur : seule l’ancre automatique suit la zone sûre', () => {
  it('9:16 : l’ancre automatique (8/8, 50/92) → placement sûr ; une position posée à la main est gardée', () => {
    expect(positionTexteEffective('title', { x: 8, y: 8 }, '9:16')).toEqual({ x: 8, y: 12 });
    expect(positionTexteEffective('cta', { x: 50, y: 92 }, '9:16')).toEqual({ x: 50, y: 76 });
    expect(positionTexteEffective('title', { x: 8, y: 5 }, '9:16')).toEqual({ x: 8, y: 5 });
    expect(positionTexteEffective('cta', { x: 50, y: 95 }, '9:16')).toEqual({ x: 50, y: 95 });
    expect(positionTexteEffective('title', null, '9:16')).toEqual({ x: 8, y: 12 });
  });
  it('idempotent : la position effective relue reste la même', () => {
    const p = positionTexteEffective('title', { x: 8, y: 8 }, '9:16');
    expect(positionTexteEffective('title', p, '9:16')).toEqual(p);
  });
  it('16:9 et 1:1 : rien ne change', () => {
    for (const f of ['16:9', '1:1'] as const) {
      expect(positionTexteEffective('title', { x: 8, y: 8 }, f)).toEqual({ x: 8, y: 8 });
      expect(positionTexteEffective('cta', { x: 50, y: 92 }, f)).toEqual({ x: 50, y: 92 });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('plein écran 9:16 (Créer : aperçu + compositeur ; Autopilote : Remotion) — dans la zone sûre', () => {
  const titre = TEXT_LAYOUT_916.titlePos;
  const cta = TEXT_LAYOUT_916.ctaPos;
  it.each(Object.entries(TITRES))('titre %s : sous les barres du haut, au-dessus du rail', (_n, t) => {
    const h = hauteurAccroche({
      titre: t.titre, sousTitre: t.sousTitre, echelleTitre: 1, echelleSousTitre: 1, largeur: W,
      ratioTitre: R.title, ratioSousTitre: R.subtitle, partLargeur: TEXT_LAYOUT.titleWidth / 100,
    }) / H * 100;
    dansZoneAuxDeuxTailles({ x0: titre.x, y0: titre.y, x1: titre.x + TEXT_LAYOUT.titleWidth, y1: titre.y + h }, 'titre');
  });
  it.each(Object.entries(CTAS))('CTA bas %s : au-dessus des descriptions, entre 15 % et 85 %', (_n, c) => {
    const h = hauteurCta({ ...c, echelle: 1, largeur: W, partLargeur: TEXT_LAYOUT.ctaWidth / 100, ratioTexte: R.cta, ratioSousTexte: R.ctaSub }) / H * 100;
    const b = { x0: cta.x - TEXT_LAYOUT.ctaWidth / 2, y0: cta.y - h, x1: cta.x + TEXT_LAYOUT.ctaWidth / 2, y1: cta.y };
    dansZoneAuxDeuxTailles(b, 'cta');
  });
  it('cartes en flux (une ou plusieurs) : cadre 30–78 %, bord droit arrêté au rail (85 %)', () => {
    const cadre = { x0: parseFloat(CARDS_FRAME.left), y0: parseFloat(CARDS_FRAME.top), x1: 100 - parseFloat(CARDS_FRAME.right) - parseFloat(RETRAIT_DROIT_CARTES_916), y1: 100 - parseFloat(CARDS_FRAME.bottom) };
    dansZoneAuxDeuxTailles(cadre, 'cartes');
  });
  it.each(Object.entries(CARTES))('SequenceCards (%s) : retrait droit en flux 9:16, rien en mode libre ni hors 9:16', (_n, cartes) => {
    const cards = cartes.map((c, i) => ({ ...c, id: `c${i}` }));
    const style = (props: Partial<React.ComponentProps<typeof SequenceCards>>) => {
      const { container } = render(<SequenceCards cards={cards} containerWidth={1080} landscape={false} valueColor="#EC4899" {...props} />);
      const el = container.querySelector('[data-cards-grid]') as HTMLElement;
      const s = { paddingRight: el.style.paddingRight, left: el.style.left, right: el.style.right, top: el.style.top, bottom: el.style.bottom };
      cleanup();
      return s;
    };
    expect(style({ zoneSure916: true })).toEqual({ paddingRight: '7%', left: '8%', right: '8%', top: '30%', bottom: '22%' });
    // Mode libre : le cadre (repère des positions enregistrées) est intact, sans retrait.
    expect(style({ zoneSure916: true, cardBoxes: { c0: { x: 10, y: 10, w: 50, h: 20 } } }).paddingRight).toBe('');
    // Absent = le rendu d'avant (1:1 de l'éditeur, appelants non migrés).
    expect(style({}).paddingRight).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────
const PROFILS_916 = ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'STANDARD', 'TUTORIAL_EDUCATION', 'LIFESTYLE_BRAND', null];
describe('surimpressions 9:16 (Autopilote, Créer, avatar — même mise en page) — dans la zone sûre', () => {
  for (const [nT, t] of Object.entries(TITRES)) {
    for (const [nC, c] of Object.entries(CTAS)) {
      for (const [nK, cartes] of Object.entries(CARTES)) {
        for (const bande of ['haut', 'bas', undefined] as const) {
          it(`titre ${nT}, CTA ${nC} (${bande ?? 'sans mesure'}), cartes ${nK} — tous profils`, () => {
            for (const p of PROFILS_916) {
              const d = appliquerMiseEnPageSurimpression({
                title: t.titre, subtitle: t.sousTitre, ctaText: c.texte, ctaSubText: c.sousTexte, cards: cartes, format: '9:16',
              }, p, { ctaBande: bande });
              const boites = boitesSurimpression(d, '9:16');
              for (const [el, b] of Object.entries(boites)) dansZoneAuxDeuxTailles(b, `${p} ${el}`);
            }
          });
        }
      }
    }
  }
  it('CTA de la bande haute : son haut (estimé) tombe sur la zone sûre (à 0,1 point près), jamais au-dessus', () => {
    for (const c of Object.values(CTAS)) {
      const d = appliquerMiseEnPageSurimpression({ ctaText: c.texte, ctaSubText: c.sousTexte }, 'CARDIO_DANCE', { ctaBande: 'haut' });
      const { cta } = boitesSurimpression(d, '9:16');
      expect(cta.y0).toBeGreaterThanOrEqual(ZONE_SURE_916.haut);
      expect(cta.y0).toBeLessThanOrEqual(ZONE_SURE_916.haut + 0.1);
    }
  });
  it('Créer et l’Autopilote posent le CTA haut au MÊME endroit (même texte, même échelle)', () => {
    const c = CTAS.long;
    const creer = miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: 'haut', format: '9:16', cta: { texte: c.texte, sousTexte: c.sousTexte, echelle: 1 } })!;
    const autopilote = appliquerMiseEnPageSurimpression({ ctaText: c.texte, ctaSubText: c.sousTexte }, 'CARDIO_DANCE', { ctaBande: 'haut' }) as unknown as { ctaPos: unknown };
    expect(creer.ctaPos).toEqual(autopilote.ctaPos);
  });
  it('sans texte de CTA connu, la bande haute garde son repli d’avant (34 %)', () => {
    expect(miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: 'haut' })!.ctaPos).toEqual({ x: 50, y: 34 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('16:9 et 1:1 — identiques à avant (gel capturé sur 0e8de3f), hors corrections des formats larges', () => {
  const gel = JSON.parse(readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/zones-sures-916-gel-larges.json'), 'utf-8'));
  it('surimpressions (Autopilote / avatar) : mise en page champ pour champ', () => {
    let n = 0;
    for (const f of ['16:9', '1:1'] as const) {
      for (const [nom, d] of Object.entries(GEL_DESIGNS)) for (const p of GEL_PROFILS) for (const b of [undefined, 'haut', 'bas'] as const) {
        expect(JSON.stringify(appliquerMiseEnPageSurimpression({ ...d, format: f }, p, { ctaBande: b }))).toBe(JSON.stringify(gel.surimpressions[`${f}|${nom}|${p}|${b ?? '-'}`]));
        n += 1;
      }
    }
    expect(n).toBe(Object.keys(gel.surimpressions).length);
  });
  it('surimpressions de Créer (`miseEnPageSurimpression`) avec format 16:9 / 1:1 : la mise en page large (gel mis à jour)', () => {
    for (const f of ['16:9', '1:1'] as const) {
      for (const p of GEL_PROFILS) for (const b of [undefined, 'haut', 'bas'] as const) {
        const cta = { texte: 'Réservez votre bilan sommeil gratuit sur afroboost.com', sousTexte: 'LIEN EN BIO', echelle: 1 };
        expect(JSON.stringify(miseEnPageSurimpression(p, { ctaBande: b, format: f, cta }))).toBe(JSON.stringify(gel.miseEnPage[`${f}|${p}|${b ?? '-'}`]));
      }
    }
    expect(Object.keys(gel.miseEnPage).length).toBe(2 * GEL_PROFILS.length * 3);
  });
  it('aperçu de Créer (titre, cartes en flux et libres, CTA) : DOM identique', () => {
    for (const f of ['16:9', '1:1'] as const) {
      for (const [nom, gen] of Object.entries(GEL_GENERATED)) {
        for (const cardBoxes of [null, { c1: { x: 10, y: 10, w: 50, h: 20 } }]) {
          const frameRef = { current: null } as React.RefObject<HTMLDivElement>;
          const { container } = render(
            <Preview generated={gen} format={f} frameRef={frameRef} displayScale={0.25}
              activeOrder={['intro', 'cards', 'cta']} gradStart="#7C3AED" gradEnd="#EC4899" gradientOpacity={0.3}
              accent="#7C3AED" text={GEL_TEXT} cardBoxes={cardBoxes} />,
          );
          expect(container.innerHTML, `${f}|${nom}`).toBe(gel.preview[`${f}|${nom}|${cardBoxes ? 'libre' : 'flux'}`]);
          cleanup();
        }
      }
    }
  });
  it('cartes en paysage (Remotion 16:9 / 1:1) : balisage identique', () => {
    for (const f of ['16:9', '1:1'] as const) {
      for (const [nom, cards] of Object.entries(GEL_CARTES)) {
        expect(renderToStaticMarkup(<SequenceCards cards={cards} containerWidth={f === '16:9' ? 1920 : 1080} landscape valueColor="#EC4899" zoneSure916={false} />))
          .toBe(gel.cartes[`${f}|${nom}`]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('câblage — une source pour l’aperçu ET le rendu', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');
  it('Remotion : défaut au format, cartes arrêtées au rail en 9:16', () => {
    const r = src('remotion/CreerSimpleMontage.tsx');
    expect(r).toContain("props.titlePos ?? positionTexteParDefaut('title', format)");
    expect(r).toContain("props.ctaPos ?? positionTexteParDefaut('cta', format)");
    expect(r).toContain("zoneSure916={format === '9:16'}");
  });
  it('Créer : aperçu, compositeur et métadonnées lisent la position EFFECTIVE ; le brouillon l’ancre brute', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain("const titlePos = useMemo(() => positionTexteEffective('title', titlePosBrut, format), [titlePosBrut, format]);");
    expect(w).toContain("const ctaPos = useMemo(() => positionTexteEffective('cta', ctaPosBrut, format), [ctaPosBrut, format]);");
    expect(w).toContain("titlePos = positionTexteEffective('title', titlePos, format);");
    expect(w).toContain("zoneSure916={format === '9:16'}");
    expect(w).toContain('titlePosition: { x: titlePos.x, y: titlePos.y }');
    expect(w).toContain('watermarkPosition: { x: ctaPos.x, y: ctaPos.y }');
    expect(w).toContain('titlePos: samePos(titlePosBrut, DESIGN.titlePos) ? undefined : titlePosBrut');
  });
  it('aucune autre copie des valeurs 9:16 (12 % / 76 % / 85 %) dans les écrans et le rendu', () => {
    for (const f of ['src/app/dashboard/creer/AssistantWizard.tsx', 'remotion/CreerSimpleMontage.tsx', 'src/components/creer/SequenceCards.tsx']) {
      expect(src(f)).not.toMatch(/titlePos:\s*\{\s*x:\s*8,\s*y:\s*12\s*\}|ctaPos:\s*\{\s*x:\s*50,\s*y:\s*76\s*\}|paddingRight:\s*'7%'/);
    }
  });
});

// Le sous-texte par défaut sert à l'estimation prudente du CTA haut.
it('estimation du CTA : sous-texte par défaut « LIEN EN BIO »', () => {
  expect(CTA_SOUS_TEXTE_DEFAUT).toBe('LIEN EN BIO');
});
