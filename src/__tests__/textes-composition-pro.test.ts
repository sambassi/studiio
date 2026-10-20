/**
 * TEXTES / COMPOSITION — le système, pas un cas (MP4 « MOTIVATION » et
 * « LE_SPORT_LE_PLUS_COMPLET (2) », 20/10/2026).
 *
 *  1. Aucun mot ne déborde : titre, CTA, badges ; 9:16, 1:1, 16:9.
 *  2. Fenêtre du titre = fin RÉELLE du plan d'ouverture.
 *  3. Valeurs de cartes qui redisent le libellé : vidées.
 *  4. Contraste discret : voile local ≤ 0,35 + halo, ombre du titre lisible.
 *  5. Brouillon local sans version de lisibilité : version courante.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FONT_RATIO, VIDEO_SIZE, TEXT_LAYOUT, titleShadow } from '@/lib/creer/designSpec';
import {
  chassePolice, echelleTitreSansDebord, lignesRepliees, titreSur916, TITRE_MIN_LISIBLE_PX,
} from '@/lib/creer/zones-sures-916';
import {
  ajusterAccroche, ajusterCta, appliquerMiseEnPageSurimpression, echellesSurimpressionLarge,
  miseEnPageSurimpression, CTA_LARGEUR_PART,
} from '@/lib/creer/surimpressions-mise-en-page';
import { planOverlays } from '@/lib/creer/overlays';
import { carteSansChiffresInventes, chiffresAutorises, valeurRedondante } from '@/lib/contenu/chiffres-sources';
import { generateSmartContent } from '@/lib/smart-content';
import {
  alphaDuFond, contrasteSurVoile, estVoile, haloTexteCss, FOND_TEXTE_SUR_IMAGE, VOILE_TEXTE_ALPHA_MAX,
} from '@/lib/creer/contraste';
import { FOND_CARTE_SUR_RUSH } from '@/lib/creer/capture-etapes-cartes';
import { eclaircir } from '@/lib/creer/surimpressions-mise-en-page';
import { versionLisibiliteRestauree, VERSION_LISIBILITE } from '@/lib/creer/ajustementCta';
import { corpsTitreSansDebord } from '@/lib/video-composer';

const SCALE_MAX = 3;
const motLePlusLong = (t: string) => Math.max(...t.split(/\s+/).map((m) => m.length));
/** Largeur estimée (px) du mot le plus long à la chasse PRUDENTE de la police. */
const largeurMot = (t: string, px: number, police: string) => motLePlusLong(t) * chassePolice(police, true).em * px;

// ── 1. AUCUN MOT NE DÉBORDE ────────────────────────────────────────────────
describe('Titre : le mot le plus long tient dans la largeur utile', () => {
  for (const police of ['Inter', 'Archivo Black', 'Syne']) {
    it(`« MOTIVATION » en surimpression 9:16, échelle max (${SCALE_MAX} × 1,9), ${police}`, () => {
      const d = appliquerMiseEnPageSurimpression({ title: 'MOTIVATION', titleScale: SCALE_MAX, titleFont: police } as never, 'STANDARD', { format: '9:16' }) as { titleScale: number };
      const px = 1080 * FONT_RATIO['9:16'].title * d.titleScale;
      expect(largeurMot('MOTIVATION', px, police)).toBeLessThanOrEqual(1080 * (TEXT_LAYOUT.titleWidth / 100));
      // Le constat : à l'échelle demandée, il débordait.
      expect(largeurMot('MOTIVATION', 1080 * FONT_RATIO['9:16'].title * SCALE_MAX * 1.9, police)).toBeGreaterThan(1080 * 0.84);
    });

    it(`« MOTIVATION » plein écran 9:16 / 1:1 / 16:9 à l'échelle ${SCALE_MAX}, ${police}`, () => {
      for (const format of ['9:16', '1:1', '16:9'] as const) {
        const r = titreSur916({ format, pos: { x: 8, y: 12 }, largeur: 84, echelle: SCALE_MAX, titre: 'MOTIVATION', police });
        const W = VIDEO_SIZE[format].w;
        expect(largeurMot('MOTIVATION', W * FONT_RATIO[format].title * r.echelle, police)).toBeLessThanOrEqual(W * (r.largeur / 100) + 0.5);
      }
    });
  }

  it('titre court qui tient : échelle inchangée (aucune régression)', () => {
    expect(echelleTitreSansDebord({ format: '9:16', largeur: 84, echelle: 1, titre: 'DANSE' })).toBe(1);
    expect(titreSur916({ format: '16:9', pos: { x: 8, y: 8 }, largeur: 84, echelle: 1.2, titre: 'YOGA DOUX' })).toEqual({ largeur: 84, echelle: 1.2 });
  });

  it('plancher lisible : jamais sous TITRE_MIN_LISIBLE_PX (la coupe CSS prend le relais)', () => {
    const e = echelleTitreSansDebord({ format: '9:16', largeur: 84, echelle: 3, titre: 'ANTICONSTITUTIONNELLEMENTPARFAITEMENT' });
    expect(1080 * FONT_RATIO['9:16'].title * e).toBeGreaterThanOrEqual(TITRE_MIN_LISIBLE_PX - 0.5);
  });

  for (const format of ['1:1', '16:9'] as const) {
    it(`titre de 3 mots longs en ${format} (surimpression large) : chaque mot tient dans sa colonne`, () => {
      const titre = 'TRANSFORMATION EXTRAORDINAIRE PERSONNELLE';
      const e = echellesSurimpressionLarge(format, { titre, echelleTitre: 1.6, cta: 'GO' });
      const d = appliquerMiseEnPageSurimpression({ title: titre, titleScale: 1.6, ctaText: 'GO' } as never, 'STANDARD', { format }) as { titleScale: number; titleWidth: number };
      const W = VIDEO_SIZE[format].w;
      expect(d.titleScale).toBeCloseTo(e.titleScale, 6);
      expect(largeurMot(titre, W * FONT_RATIO[format].title * d.titleScale, 'Inter')).toBeLessThanOrEqual(W * (d.titleWidth / 100));
    });
  }
});

describe('CTA long et badges : mot le plus long dans la largeur utile', () => {
  const texte = 'RÉSERVEZ VOTRE BILAN GRATUITEMENT';
  const sous = 'AFROBOOST.COM/RESERVATION';
  it('ajusterCta : texte et URL entiers (chasse réelle Inter), 9:16', () => {
    const e = ajusterCta({ texte, sousTexte: sous, echelle: 2.5, largeur: 1080, ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true });
    const utile = 1080 * CTA_LARGEUR_PART - 2 * 1080 * 0.04;
    expect(largeurMot(texte, 1080 * FONT_RATIO['9:16'].cta * e, 'Inter')).toBeLessThanOrEqual(utile);
    expect(largeurMot(sous, 1080 * FONT_RATIO['9:16'].ctaSub * e, 'Inter')).toBeLessThanOrEqual(utile);
  });
  it('police large (Archivo Black) : plus petit qu\'en Inter, toujours entier', () => {
    const base = { texte, sousTexte: sous, echelle: 2.5, largeur: 1080, ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true };
    const inter = ajusterCta(base);
    const large = ajusterCta({ ...base, police: 'Archivo Black' });
    expect(large).toBeLessThan(inter);
  });
  for (const format of ['1:1', '16:9'] as const) {
    it(`CTA long en ${format} : le mot le plus long tient dans la bande`, () => {
      const e = echellesSurimpressionLarge(format, { titre: 'X', cta: texte, sousTexteCta: sous, echelleCta: 2 });
      const W = VIDEO_SIZE[format].w;
      const L = { '1:1': 84, '16:9': 64 }[format];
      const utile = W * (L / 100) - 2 * W * 0.04;
      expect(largeurMot(sous, W * FONT_RATIO[format].ctaSub * e.ctaScale, 'Inter')).toBeLessThanOrEqual(utile);
    });
  }
});

describe('Estimation des lignes : le premier mot se replie aussi', () => {
  it('un mot unique plus large que la ligne compte pour plusieurs lignes', () => {
    expect(lignesRepliees('MOTIVATION', 100, 300, { em: 0.7, espace: 0.22 })).toBe(3);
    expect(lignesRepliees('UN DEUX', 10, 1000, { em: 0.7, espace: 0.22 })).toBe(1);
  });
  it('ajusterAccroche : une seule ligne trop large n\'échappe plus à la règle', () => {
    const r = ajusterAccroche({ titre: 'MOTIVATION', echelleTitre: 5.7, echelleSousTitre: 1, largeur: 1080, hauteur: 1920, ratioTitre: FONT_RATIO['9:16'].title, ratioSousTitre: FONT_RATIO['9:16'].subtitle });
    expect(largeurMot('MOTIVATION', 1080 * FONT_RATIO['9:16'].title * r.echelleTitre, 'Inter')).toBeLessThanOrEqual(1080 * 0.84);
  });
});

describe('Compositeur (Créer) : corps du titre mesuré', () => {
  // Canvas factice : chasse 0,7 em, la police posée par `appliquer`.
  const ctx = (() => {
    let px = 0;
    return {
      set font(f: string) { px = Number(/(\d+)px/.exec(f)![1]); },
      get font() { return `${px}px x`; },
      measureText: (t: string) => ({ width: t.length * 0.7 * px }),
    } as unknown as CanvasRenderingContext2D;
  })();
  it('réduit jusqu\'à ce que le mot le plus long tienne ; inchangé s\'il tient', () => {
    ctx.font = '250px x';
    const px = corpsTitreSansDebord(ctx, 'MOTIVATION', 250, 900, 40, 0, (p) => { ctx.font = `${p}px x`; });
    expect(px).toBeLessThan(250);
    expect(10 * 0.7 * px).toBeLessThanOrEqual(900);
    ctx.font = '60px x';
    expect(corpsTitreSansDebord(ctx, 'MOTIVATION', 60, 900, 40, 0, (p) => { ctx.font = `${p}px x`; })).toBe(60);
  });
  it('plancher respecté', () => {
    ctx.font = '250px x';
    expect(corpsTitreSansDebord(ctx, 'ANTICONSTITUTIONNELLEMENT', 250, 100, 40, 0, (p) => { ctx.font = `${p}px x`; })).toBe(40);
  });
});

// ── 2. FENÊTRE DU TITRE ────────────────────────────────────────────────────
describe('Fenêtre du titre = fin du plan d\'ouverture', () => {
  it('« MOTIVATION » : plan d\'ouverture de 4 s → titre jusqu\'à 4 s (et non 3 s)', () => {
    for (const profil of ['STANDARD', 'EVENT_IMMERSIVE', null] as const) {
      const o = planOverlays({ duree: 24.68, profil, nbCartes: 4, finHook: 4 });
      expect(o.titre).toEqual([0, 4]);
      expect(o.cartes[0].debut).toBeGreaterThanOrEqual(4);
    }
  });
  it('fin inconnue : la durée d\'avant (3 s)', () => {
    expect(planOverlays({ duree: 24.68, profil: 'STANDARD', nbCartes: 4, finHook: null }).titre).toEqual([0, 3]);
  });
  it('plan d\'ouverture très long : plafonné (25 % de la vidéo)', () => {
    expect(planOverlays({ duree: 24, profil: 'STANDARD', nbCartes: 4, finHook: 12 }).titre).toEqual([0, 6]);
  });
  it('danse (#504) inchangée : l\'accroche se resserre avant la première carte', () => {
    expect(planOverlays({ duree: 24, profil: 'CARDIO_DANCE', nbCartes: 4, finHook: 4 }).titre![1]).toBeLessThanOrEqual(2.1);
  });
});

// ── 3. VALEURS REDONDANTES ────────────────────────────────────────────────
describe('Valeur de carte qui redit le libellé : vidée', () => {
  const vide = (title: string, value: string) => carteSansChiffresInventes({ title, value, description: 'x' }, chiffresAutorises('')).value;
  it('DOPA / PROC / BOUCLE vidées ; ANCRÉ (≠ « HABIT STACKING ») gardée', () => {
    expect(vide('DOPAMINE ANTICIP.', 'DOPA')).toBe('');
    expect(vide('PROCESS > GOAL', 'PROC')).toBe('');
    expect(vide('BOUCLE HABITUDE', 'BOUCLE')).toBe('');
    // ANCRÉ n'est ni un mot ni un début de « HABIT STACKING » : elle apporte
    // une information (ancrer une habitude), elle reste.
    expect(vide('HABIT STACKING', 'ANCRÉ')).toBe('ANCRÉ');
  });
  it('accents, casse, ponctuation, suites de mots', () => {
    expect(valeurRedondante('énergie', 'ÉNERGIE EXPRESS')).toBe(true);
    expect(valeurRedondante('MOUV', 'CORPS EN MOUV.')).toBe(true);
    expect(valeurRedondante('PROCESS GOAL', 'PROCESS > GOAL')).toBe(true);
    expect(valeurRedondante('+ÉNERGIE', 'MENTAL UPLIFTING')).toBe(false);
    expect(valeurRedondante('', 'X')).toBe(false);
  });
  it('génération locale « motivation » : DOPAMINE ANTICIP. sans valeur, titre + icône', () => {
    const cartes = Array.from({ length: 12 }, (_, s) => generateSmartContent('motivation', s).cards).flat();
    const dopa = cartes.find((c) => c.title === 'DOPAMINE ANTICIP.');
    expect(dopa).toBeDefined();
    expect(dopa!.value).toBe('');
    expect(dopa!.icon).toBeTruthy();
  });
  it('balayage de TOUTE la base locale : 0 valeur redondante après filtre', () => {
    const src = readFileSync(resolve(__dirname, '../lib/smart-content.ts'), 'utf8');
    const cartes = Array.from(src.matchAll(/\{\s*icon:\s*"[^"]*",\s*title:\s*"([^"]*)",\s*description:\s*"(?:[^"\\]|\\.)*",\s*value:\s*"([^"]*)"\s*\}/g))
      .map((m) => ({ title: m[1], value: m[2] }));
    expect(cartes.length).toBeGreaterThan(500);
    const avant = cartes.filter((c) => valeurRedondante(c.value, c.title)).length;
    expect(avant).toBeGreaterThan(100);
    const apres = cartes
      .map((c) => carteSansChiffresInventes({ ...c, description: '' }, chiffresAutorises('')))
      .filter((c) => valeurRedondante(c.value, c.title)).length;
    expect(apres).toBe(0);
  });
  it('prompt IA : plus de « - » quand la valeur est vide, redite interdite', () => {
    const route = readFileSync(resolve(__dirname, '../app/api/content/ai-generate/route.ts'), 'utf8');
    expect(route).not.toMatch(/propre\.value \|\| '-'/);
    expect(route).toMatch(/JAMAIS la redite du label/);
  });
});

// ── 4. LISIBILITÉ DISCRÈTE ────────────────────────────────────────────────
describe('Contraste discret : contour fin + ombre serrée, plus de pavé ni de tache', () => {
  const m = miseEnPageSurimpression('CARDIO_DANCE')!;
  it('par défaut : aucun aplat derrière cartes et CTA (texte sur l\'image)', () => {
    for (const f of [m.carteFond, m.ctaFond, FOND_CARTE_SUR_RUSH]) {
      expect(f).toBe(FOND_TEXTE_SUR_IMAGE);
      expect(alphaDuFond(f)).toBe(0);
    }
  });
  it('voile seulement sur fond clair ET chargé, discret (alpha ≤ 0,22)', () => {
    const avec = (fondTexte: { clair?: boolean; charge?: boolean }) =>
      appliquerMiseEnPageSurimpression({ title: 'X', ctaText: 'GO' } as never, 'STANDARD', { fondTexte }) as { ctaBackground: string; cardBackground: string };
    expect(avec({ clair: true, charge: false }).ctaBackground).toBe(FOND_TEXTE_SUR_IMAGE);
    expect(avec({ clair: false, charge: true }).cardBackground).toBe(FOND_TEXTE_SUR_IMAGE);
    const v = avec({ clair: true, charge: true });
    for (const f of [v.ctaBackground, v.cardBackground]) {
      expect(estVoile(f)).toBe(true);
      expect(alphaDuFond(f)).toBeLessThanOrEqual(VOILE_TEXTE_ALPHA_MAX);
      expect(VOILE_TEXTE_ALPHA_MAX).toBeLessThanOrEqual(0.22);
    }
  });
  it('contour : 2 px à 1080, alpha 0,55, quatre directions + une ombre douce', () => {
    const h = haloTexteCss(1080);
    expect(h.match(/rgba\(0,0,0,0\.55\)/g)).toHaveLength(4);
    expect(h).toContain('2px 0 1px');
  });
  it('contraste au bord des lettres, pire plan (blanc), avec ou sans voile : texte blanc et ligne d\'action ≥ 4,5:1', () => {
    for (const voile of [0, VOILE_TEXTE_ALPHA_MAX]) {
      expect(contrasteSurVoile('#FFFFFF', voile)).toBeGreaterThanOrEqual(4.5);
      expect(contrasteSurVoile(eclaircir('#EC4899', m.ctaActionEclaircie)!, voile)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('ombre du titre : un contour dense (alpha ≥ 0,5), plus l\'ombre invisible d\'avant (0,1)', () => {
    const alphas = Array.from(titleShadow(1080).matchAll(/rgba\(0,0,0,([\d.]+)\)/g)).map((x) => Number(x[1]));
    expect(Math.max(...alphas)).toBeGreaterThanOrEqual(0.5);
  });
});

// ── 5. BROUILLON SANS VERSION ─────────────────────────────────────────────
describe('Version de lisibilité relue', () => {
  it('brouillon local sans version : version courante ; post enregistré sans version : v1 (Default safe)', () => {
    expect(versionLisibiliteRestauree(undefined, 'brouillon')).toBe(VERSION_LISIBILITE);
    expect(versionLisibiliteRestauree(undefined, 'post')).toBe(1);
    expect(versionLisibiliteRestauree(1, 'brouillon')).toBe(1);
    expect(versionLisibiliteRestauree(2, 'post')).toBe(2);
  });
});
