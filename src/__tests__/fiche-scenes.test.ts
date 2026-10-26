/**
 * Lot 4 — fiches de scènes horodatées → `AnalyseRush.descriptions` → `planMontage`.
 * Descriptions FICTIVES (source « fictif ») : ces tests prouvent le BRANCHEMENT,
 * jamais une reconnaissance d'images.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { planMontage, dureePlan, type AnalyseRush, type EchantillonRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import { analysesAvecScenes, descriptionsDepuisFiche, FICHE_SCENES_ACTIVE, type FicheScenes, type SceneHorodatee } from '@/lib/creer/fiche-scenes';
import { preparerPlanMontage } from '@/lib/creer/preparer-plan-montage';

/** Rush de 20 s ; netteté et mouvement par plage. */
function rush(url: string, net: (t: number) => number, mouv: (t: number) => number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < 20; t += 0.5) {
    echantillons.push({
      t, mouvement: mouv(t), luminosite: 0.5, nettete: net(t), audio: 0.05,
      empreinte: Array.from({ length: 64 }, (_, i) => ((i * 7 + Math.floor(t * 2) * 13 + url.length * 31) % 100) / 100),
    });
  }
  return { url, duree: 20, echantillons, pisteAudio: true };
}
const ondule = (b: number) => (t: number) => b + 0.03 * Math.abs(Math.sin(t * 1.7));
const R1 = rush('https://x/r1.mp4', () => 0.6, ondule(0.06));
// R2 : plage 6–12 s FLOUE (netteté au plancher) — décrite comme pertinente.
const R2 = rush('https://x/r2.mp4', (t) => (t >= 6 && t < 12 ? 0.05 : 0.6), ondule(0.06));

const sc = (debut: number, fin: number, action: string | null, sujet: string | null = null, confiance: SceneHorodatee['confiance'] = 'elevee'): SceneHorodatee =>
  ({ debut, fin, action, sujet, personnes: null, cadrage: null, confiance, source: 'fictif' });
const FICHES: Record<string, FicheScenes> = {
  [R1.url]: { version: 1, url: R1.url, scenes: [
    sc(0, 5, 'danse collective', 'groupe qui danse'),
    sc(5, 10, 'plan sans action'),
    sc(10, 15, 'voiture garée sur un parking', 'parking'),
    sc(15, 20, 'coach explique un mouvement de danse', 'cours de danse'),
  ] },
  [R2.url]: { version: 1, url: R2.url, scenes: [
    sc(0, 6, 'mouvement sportif saut'),
    sc(6, 12, 'danse collective', 'groupe qui danse'),
    sc(12, 20, 'recette de cuisine', 'cuisine'),
  ] },
};
const CONTEXTE = { theme: 'danse afro cardio', sujet: 'danse collective en groupe' };
const beats = Array.from({ length: 50 }, (_, i) => Math.round(i * 0.4839 * 1000) / 1000);
const RYTHME = { beats, forts: beats.filter((_, i) => i % 4 === 0), drop: null };

type Plan = NonNullable<ReturnType<typeof planMontage>>;
const avec = (a: AnalyseRush[]) => analysesAvecScenes(a, FICHES, true);

describe('contrat : descriptions depuis la fiche', () => {
  it('bornes ramenées dans le rush, confiance faible écartée, texte = action + sujet, tri', () => {
    const d = descriptionsDepuisFiche({ version: 1, url: 'u', scenes: [
      sc(8, 30, 'fin hors du rush'), sc(-2, 3, 'début négatif', 'sujet'), sc(4, 4, 'vide'), sc(5, 6, 'douteux', null, 'faible'), sc(6, 7, null, null),
    ] }, 20);
    expect(d).toEqual([{ debut: 0, fin: 3, texte: 'début négatif sujet' }, { debut: 8, fin: 20, texte: 'fin hors du rush' }]);
  });
  it('éteint par défaut ; éteint, sans fiche ou fiche d’un autre rush : même référence', () => {
    expect(FICHE_SCENES_ACTIVE).toBe(false);
    const a = [R1, R2];
    expect(analysesAvecScenes(a, FICHES)).toBe(a);
    expect(analysesAvecScenes(a, null, true)).toBe(a);
    expect(analysesAvecScenes(a, { [R1.url]: { ...FICHES[R1.url], url: 'https://x/autre.mp4' } }, true)).toBe(a);
  });
});

describe.each<[string, OptionsMontage]>([
  ['Autopilote', { netteteCommune: true }],
  ['Créer', { uniciteParTimecode: true, netteteCommune: true }],
])('%s', (_nom, base) => {
  for (const musique of [false, true]) {
    const o: OptionsMontage = { ...base, contexte: CONTEXTE, ...(musique ? { rythme: RYTHME } : {}) };
    const sans = planMontage([R1, R2], 15, o)!;
    const desc = planMontage(avec([R1, R2]), 15, o)!;
    const titre = musique ? ' (musique)' : '';
    it(`les descriptions pertinentes atteignent le moteur et RELÈVENT la pertinence des extraits concernés${titre}`, () => {
      const decrits = desc.filter((x) => /description du plan/.test(x.raison ?? ''));
      expect(decrits.length).toBeGreaterThan(0);
      expect(Math.max(...decrits.map((x) => x.pertinence ?? 0))).toBeGreaterThan(Math.max(...sans.map((x) => x.pertinence ?? 0)));
    });
    it(`une scène hors sujet n’est pas favorisée : la décrire revient à ne pas la décrire${titre}`, () => {
      const sansHorsSujet = Object.fromEntries(Object.entries(FICHES).map(([u, f]) => [u, { ...f, scenes: f.scenes.filter((x) => !['parking', 'cuisine'].includes(x.sujet ?? '')) }]));
      expect(desc).toEqual(planMontage(analysesAvecScenes([R1, R2], sansHorsSujet, true), 15, o));
    });
    it(`la netteté reste prioritaire : la plage floue décrite « pertinente » n’est pas plus montée qu’avant${titre}`, () => {
      // Images floues (netteté < 0,2) dans les extraits de R2 : jamais plus avec descriptions que sans.
      const floues = (p: Plan) => p.filter((x) => x.url === R2.url)
        .reduce((n, x) => n + R2.echantillons.filter((e) => e.t >= (x.depuis ?? 0) && e.t < (x.jusqua ?? 0) && e.nettete < 0.2).length, 0);
      expect(floues(desc)).toBeLessThanOrEqual(floues(sans));
      expect(desc.some((x) => x.url === R2.url && (x.depuis ?? 0) >= 6 && (x.jusqua ?? 0) <= 12)).toBe(false);
    });
    it(`timecodes dans le rush, durée et créneaux (cuts musicaux) inchangés${titre}`, () => {
      expect(desc.every((s) => (s.depuis ?? 0) >= 0 && (s.jusqua ?? 0) <= 20 + 1e-6)).toBe(true);
      expect(dureePlan(desc)).toBe(dureePlan(sans));
      expect(desc.map((s) => [s.debut, s.fin, s.beatCible])).toEqual(sans.map((s) => [s.debut, s.fin, s.beatCible]));
    });
    it(`les raisons citent la description${titre}`, () => {
      expect(desc.some((s) => /description du plan/.test(s.raison ?? ''))).toBe(true);
    });
  }
  it('sans descriptions : plan strictement identique', () => {
    const o: OptionsMontage = { ...base, contexte: CONTEXTE, rythme: RYTHME };
    expect(planMontage(analysesAvecScenes([R1, R2], FICHES), 15, o)).toEqual(planMontage([R1, R2], 15, o));
  });
});

describe('Créer : préparation du plan (montage automatique)', () => {
  const entree = {
    version: 1, analyse: 'complete', rushs: [{ url: R1.url, secondes: 20 }, { url: R2.url, secondes: 20 }], cibleEcran: 15, ordre: ['video'],
    durees: { intro: 0, cards: 0, video: 15, cta: 0 }, debutVideo: 0, musique: null, methode: 'A', nbCartes: 0, voixDeTextes: false, format: '9:16', rushApres: null,
    contexte: { theme: 'danse afro cardio', titre: 'Danse collective en groupe', sousTitre: null, objectif: null, cartes: [] },
  } as unknown as Parameters<typeof preparerPlanMontage>[0];
  it('fiches passées mais interrupteur éteint : plan identique à l’absence de fiche', () => {
    expect(preparerPlanMontage(entree, { analysesBrutes: [R1, R2], rythme: null, scenes: FICHES }).plan)
      .toEqual(preparerPlanMontage(entree, { analysesBrutes: [R1, R2], rythme: null }).plan);
  });
  it('allumé : les descriptions atteignent le moteur ; un plan d’autres fiches n’est pas rejoué', () => {
    const p = preparerPlanMontage(entree, { analysesBrutes: [R1, R2], rythme: null, scenes: FICHES, scenesActives: true });
    expect(p.analyses.every((a) => (a.descriptions ?? []).length > 0)).toBe(true);
    const sansFiche = preparerPlanMontage(entree, { analysesBrutes: [R1, R2], rythme: null }, p);
    expect(sansFiche.reutilise).toBe(false);
  });
});

describe('câblage', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('Autopilote : les trois appels du moteur reçoivent les analyses enrichies', () => {
    expect(src('src/lib/autopilot/produire.ts').match(/analysesAvecScenes\(analysesRushs, input\.fichesScenes\)/g)?.length).toBe(3);
  });
  it('aucun appel réseau ni fournisseur dans le contrat', () => {
    const f = src('src/lib/creer/fiche-scenes.ts');
    expect(f).not.toMatch(/fetch\(|import .*anthropic|import .*groq|process\.env/i);
  });
  it('Créer : montage manuel non concerné (seule la préparation automatique lit les fiches)', () => {
    expect(src('src/app/dashboard/creer/AssistantWizard.tsx')).not.toContain('fiche-scenes');
  });
});
