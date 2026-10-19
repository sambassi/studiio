/**
 * M3-a PR3 — `preparerPlanMontage` : même résultat que le calcul d'avant
 * (déplacé, pas recopié), clé EXHAUSTIVE, plan périmé / incomplet jamais
 * réutilisé, raccourci annoncé sans rien muter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import passages from '@/__tests__/fixtures/passages-rushes-reels.json';

const sp = vi.hoisted(() => ({ planMontage: vi.fn() }));
vi.mock('@/lib/creer/smart-montage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/creer/smart-montage')>('@/lib/creer/smart-montage');
  sp.planMontage.mockImplementation((...a: unknown[]) => (actual.planMontage as (...x: unknown[]) => unknown)(...a));
  return { ...actual, planMontage: (...a: unknown[]) => sp.planMontage(...a) };
});

import {
  entreePlanMontage, clePlanMontage, preparerPlanMontage, planReutilisable, surimpressionsDuPlan, etapesDuPlan,
  type EntreePlanMontage,
} from '@/lib/creer/preparer-plan-montage';
import { planMontage, optionsModePassages, dureePlan, profilMontageDuContexte, mesuresSegments, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan } from '@/lib/creer/smart-montage-regles';
import { rythmeSurFenetre, type RythmeMusique } from '@/lib/creer/rythme-musique';
import { planOverlays, profilEnSurimpression } from '@/lib/creer/overlays';

const ANALYSES = danse.analyses as unknown as AnalyseRush[];
const RYTHME = danse.rythme as unknown as RythmeMusique;
const REELS = (passages as unknown as { rushes: AnalyseRush[] }).rushes;
const CARTES = [{ title: 'Cardio', description: 'Brûle', value: '500' }, { title: 'Souffle', description: 'Respire', value: '3' }];

const D = { intro: 2, cards: 3, video: 14, cta: 2 } as Record<string, number>;
const base = (o: Partial<Parameters<typeof entreePlanMontage>[0]> = {}) => entreePlanMontage({
  rushs: ANALYSES.map((a) => ({ url: a.url, secondes: a.duree })),
  ordre: ['intro', 'cards', 'video', 'cta'],
  duree: (k: string) => D[k] ?? 0,
  musique: 'https://x/m.mp3',
  theme: 'danse afro cardio',
  titre: 'DANSE',
  sousTitre: 'Bouger',
  objectif: 'motiver',
  cartes: CARTES,
  methode: 'A',
  voixDeTextes: false,
  format: '9:16',
  ...o,
});

/** Le calcul d'avant PR3, tel qu'il était écrit dans AssistantWizard (c3f2302). */
function calculAvant(e: EntreePlanMontage, analyses: AnalyseRush[], rythme: RythmeMusique | null) {
  const cibleEcran = e.cibleEcran;
  const contexteMontage = contexteMontageDepuis({ theme: e.contexte.theme, titre: e.contexte.titre, sousTitre: e.contexte.sousTitre, objectif: e.contexte.objectif, cartes: e.contexte.cartes });
  const rythmeVideo = rythme ? rythmeSurFenetre(rythme, e.debutVideo, cibleEcran) : null;
  const plan = e.methode === 'B'
    ? planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage, ...optionsModePassages(analyses) })
    : planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage });
  const profil = profilMontageDuContexte(contexteMontage).profil;
  const ms = plan ? mesuresSegments(plan, analyses) : null;
  const overlays = plan && profilEnSurimpression(profil) && !e.voixDeTextes
    ? planOverlays({ duree: dureePlan(plan), nbCartes: e.nbCartes, finHook: plan.filter((x) => x.phase === 'HOOK').at(-1)?.fin ?? null, profil })
    : null;
  return { plan, profil, rapport: ms ? rapportPlan(profil, ms, rythmeVideo) : null, overlays };
}

beforeEach(() => { sp.planMontage.mockClear(); });

describe('parité : déplacé, pas recopié', () => {
  const cas: Array<[string, EntreePlanMontage, AnalyseRush[], RythmeMusique | null]> = [
    ['A danse + musique', base(), ANALYSES, RYTHME],
    ['A danse sans musique', base({ musique: null }), ANALYSES, null],
    ['B danse + musique', base({ methode: 'B' }), ANALYSES, RYTHME],
    ['A rushes réels 9 s', base({ rushs: REELS.map((a) => ({ url: a.url, secondes: a.duree })), duree: (k: string) => (k === 'video' ? 9 : D[k]) }), REELS, null],
    ['B rushes réels 20 s', base({ methode: 'B', rushs: REELS.map((a) => ({ url: a.url, secondes: a.duree })), duree: (k: string) => (k === 'video' ? 20 : D[k]) }), REELS, null],
    ['A vidéo en tête (debutVideo 0)', base({ ordre: ['video', 'intro', 'cta'] }), ANALYSES, RYTHME],
    ['A voix de textes (pas de surimpression)', base({ voixDeTextes: true }), ANALYSES, RYTHME],
  ];
  for (const [nom, e, analyses, rythme] of cas) {
    it(nom, () => {
      const prep = preparerPlanMontage(e, { analysesBrutes: analyses, rythme });
      const avant = calculAvant(e, analyses, rythme);
      expect(prep.plan).toEqual(avant.plan);
      expect(prep.profil).toBe(avant.profil);
      expect(prep.rapport).toEqual(avant.rapport);
      expect(surimpressionsDuPlan({ plan: prep.plan, profil: prep.profil, nbCartes: e.nbCartes, voixDeTextes: e.voixDeTextes })).toEqual(avant.overlays);
      expect(prep.plan, 'un vrai plan, pas deux null').not.toBeNull();
      expect(prep.complet).toBe(true);
      expect(prep.reutilise).toBe(false);
    });
  }
});

describe('clé exhaustive : changer UNE entrée ⇒ clé différente', () => {
  /** Toutes les feuilles de l'entrée, mutées une à une (dérivé de l'objet, pas d'une liste). */
  const feuilles = (o: unknown, chemin: string[] = []): string[][] => {
    if (o === null || typeof o !== 'object') return [chemin];
    const out: string[][] = [chemin.length ? chemin : []].filter((c) => c.length && Array.isArray(o)); // tableau : ajout d'un élément
    for (const k of Object.keys(o as Record<string, unknown>)) out.push(...feuilles((o as Record<string, unknown>)[k], [...chemin, k]));
    return out;
  };
  const muter = (o: EntreePlanMontage, chemin: string[]): EntreePlanMontage => {
    const copie = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
    let cur: Record<string, unknown> = copie;
    for (const k of chemin.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    const k = chemin[chemin.length - 1];
    const v = cur[k];
    if (Array.isArray(v)) (v as unknown[]).push(typeof v[0] === 'string' ? 'x' : { title: 'x', description: null });
    else if (typeof v === 'number') cur[k] = v + 1;
    else if (typeof v === 'string') cur[k] = `${v}·`;
    else if (typeof v === 'boolean') cur[k] = !v;
    else cur[k] = 'nouveau';
    return copie as unknown as EntreePlanMontage;
  };
  const e = base();
  const chemins = feuilles(e);
  it('toutes les feuilles sont couvertes', () => {
    const noms = chemins.map((c) => c.join('.'));
    for (const attendu of ['version', 'analyse', 'rushs.0.url', 'rushs.0.secondes', 'cibleEcran', 'ordre.0', 'durees.intro', 'durees.cards', 'durees.video', 'durees.cta',
      'debutVideo', 'musique', 'contexte.theme', 'contexte.titre', 'contexte.sousTitre', 'contexte.objectif', 'contexte.cartes.0.title',
      'contexte.cartes.0.description', 'methode', 'nbCartes', 'voixDeTextes', 'format']) expect(noms).toContain(attendu);
    expect(chemins.length).toBeGreaterThan(25);
  });
  for (const c of feuilles(base())) {
    it(c.join('.') || '(racine)', () => {
      expect(clePlanMontage(muter(e, c))).not.toBe(clePlanMontage(e));
    });
  }
  it('ordre des rushes, rush ajouté / retiré, musique retirée, méthode A↔B, format', () => {
    const k = clePlanMontage(e);
    expect(clePlanMontage(base({ rushs: [...e.rushs].reverse() }))).not.toBe(k);
    expect(clePlanMontage(base({ rushs: e.rushs.slice(1) }))).not.toBe(k);
    expect(clePlanMontage(base({ musique: null }))).not.toBe(k);
    expect(clePlanMontage(base({ methode: 'B' }))).not.toBe(k);
    expect(clePlanMontage(base({ format: '16:9' }))).not.toBe(k);
    // intro +1 s : la fenêtre du rythme bouge (debutVideo)
    expect(clePlanMontage(base({ duree: (x: string) => (x === 'intro' ? 3 : D[x]) }))).not.toBe(k);
    // Stable : même entrée, même clé.
    expect(clePlanMontage(base())).toBe(k);
  });
});

describe('plan rejoué SEULEMENT s’il est valable', () => {
  const e = base();
  const memo = preparerPlanMontage(e, { analysesBrutes: ANALYSES, rythme: RYTHME });
  beforeEach(() => { sp.planMontage.mockClear(); });

  it('clé identique, complet, mêmes mesures ⇒ réutilisé, planMontage PAS rappelé', () => {
    const p = preparerPlanMontage(base(), { analysesBrutes: ANALYSES, rythme: RYTHME }, memo);
    expect(p.reutilise).toBe(true);
    expect(sp.planMontage).not.toHaveBeenCalled();
    expect(p.plan).toEqual(memo.plan);
  });
  it('clé différente (titre modifié après l’aperçu) ⇒ recalcul', () => {
    const p = preparerPlanMontage(base({ titre: 'AUTRE' }), { analysesBrutes: ANALYSES, rythme: RYTHME }, memo);
    expect(p.reutilise).toBe(false);
    expect(sp.planMontage).toHaveBeenCalledTimes(1);
  });
  it('analyse relancée (autre objet, même URL) ⇒ recalcul', () => {
    const autres = ANALYSES.map((a) => ({ ...a }));
    expect(preparerPlanMontage(base(), { analysesBrutes: autres, rythme: RYTHME }, memo).reutilise).toBe(false);
  });
  it('rythme différent (musique relue) ⇒ recalcul', () => {
    expect(preparerPlanMontage(base(), { analysesBrutes: ANALYSES, rythme: { ...RYTHME } }, memo).reutilise).toBe(false);
  });
  it('plan de l’aperçu INCOMPLET (une analyse illisible) ⇒ jamais réutilisé', () => {
    const incomplet = preparerPlanMontage(e, { analysesBrutes: [...ANALYSES.slice(0, -1), null], rythme: RYTHME });
    expect(incomplet.complet).toBe(false);
    expect(planReutilisable(incomplet, incomplet.cle, incomplet.analysesBrutes, RYTHME)).toBe(false);
    sp.planMontage.mockClear();
    expect(preparerPlanMontage(e, { analysesBrutes: [...ANALYSES.slice(0, -1), null], rythme: RYTHME }, incomplet).reutilise).toBe(false);
    expect(sp.planMontage).toHaveBeenCalledTimes(1);
  });
  it('pas de plan en cache (en calcul / interrupteur éteint) ⇒ recalcul, à chaque appel', () => {
    preparerPlanMontage(e, { analysesBrutes: ANALYSES, rythme: RYTHME }, null);
    preparerPlanMontage(e, { analysesBrutes: ANALYSES, rythme: RYTHME });
    expect(sp.planMontage).toHaveBeenCalledTimes(2);
  });
  it('le plan rejoué est une COPIE : le muter ne touche pas le cache', () => {
    const p = preparerPlanMontage(base(), { analysesBrutes: ANALYSES, rythme: RYTHME }, memo);
    p.plan![0].fin = 999;
    expect(memo.plan![0].fin).not.toBe(999);
  });
});

describe('raccourci et ligne de temps', () => {
  it('matière insuffisante : raccourci ANNONCÉ, durée Vidéo = plan ; l’entrée n’est pas modifiée', () => {
    const e = base({ duree: (k: string) => (k === 'video' ? 120 : D[k]) });
    const copie = JSON.stringify(e);
    const p = preparerPlanMontage(e, { analysesBrutes: ANALYSES, rythme: null });
    expect(p.plan).not.toBeNull();
    expect(p.dureeVideo).toBe(dureePlan(p.plan!));
    expect(p.dureeVideo).toBeLessThan(120);
    expect(p.raccourci?.demande).toBe(120);
    expect(JSON.stringify(e)).toBe(copie);
  });
  it('matière suffisante : pas de raccourci, durée demandée', () => {
    const p = preparerPlanMontage(base(), { analysesBrutes: ANALYSES, rythme: RYTHME });
    expect(p.raccourci).toBeNull();
    expect(p.dureeVideo).toBe(14);
  });
  it('etapesDuPlan : plein écran = durées ; surimpression = 0/0/V/0', () => {
    const d = (k: string) => D[k];
    expect(etapesDuPlan(['intro', 'cards', 'video', 'cta'], d, { dureeVideo: 10 }, false)).toEqual([
      { key: 'intro', seconds: 2 }, { key: 'cards', seconds: 3 }, { key: 'video', seconds: 10 }, { key: 'cta', seconds: 2 }]);
    expect(etapesDuPlan(['intro', 'cards', 'video', 'cta'], d, { dureeVideo: 10 }, true).map((x) => x.seconds)).toEqual([0, 0, 10, 0]);
  });
});
