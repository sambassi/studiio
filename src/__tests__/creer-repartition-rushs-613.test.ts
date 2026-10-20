/**
 * #613 — Créer : répartition des rushes sur TOUT le montage, sans gel.
 *
 * Cas réel (démo « LE SPORT », analyses mesurées par le navigateur du banc) :
 * 3 rushes de 4 / 4 / 5 s, chacun UN plan continu précédé d'un reste de la
 * source (rush 1 : coupe à 0,43 s ; rush 2 : coupe à 0,3 s ; rush 3 : image
 * FIGÉE 0–0,63 s puis coupe).
 *
 * Avant : la séquence Vidéo tombait à 4 s (« Continuer avec 4 s ») ; ses
 * extraits partaient à 0,2 s, à cheval sur les coupes (flash, ralenti sur le
 * pic de la coupe pris pour un geste) ; et le plan sous les cartes prenait le
 * rush 3 à 0 s → gel de 0,7 s à 11,63 s dans la vidéo.
 */
import { describe, it, expect } from 'vitest';
import fixture from '@/__tests__/fixtures/demo-sport-analyses.json';
import { planMontage, plansPropres, dureePlan, cleSource, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis } from '@/lib/creer/smart-montage-regles';
import { planCartesSurRushs, sourcesDuPlan } from '@/lib/creer/narration-rushs';
import { entreePlanMontage, preparerPlanMontage } from '@/lib/creer/preparer-plan-montage';

const analyses = fixture.analyses as unknown as AnalyseRush[];
const [R1, R2, R3] = analyses.map((a) => a.url);
const contexte = contexteMontageDepuis({
  theme: 'Le sport le plus complet', titre: 'LE SPORT LE PLUS COMPLET',
  sousTitre: 'Danser active plus de muscles que la plupart des sports', objectif: null, cartes: [],
});
const propres = new Map(analyses.map((a) => [a.url, plansPropres(a)] as const));
const dansUnPlanPropre = (url: string, a: number, b: number) =>
  (propres.get(url) ?? []).some(([x, y]) => a >= x - 1e-6 && b <= y + 1e-6);
const borne = (s: { depuis?: number; jusqua?: number; debut: number; fin: number }) =>
  [s.depuis ?? 0, s.jusqua ?? (s.depuis ?? 0) + (s.fin - s.debut)] as const;

describe('plansPropres — coupes franches et images figées mesurées', () => {
  it('démo : le reste du plan précédent et l’image figée sont écartés', () => {
    expect(propres.get(R1)).toEqual([[0.5, 4]]);
    expect(propres.get(R2)).toEqual([[0.5, 4]]);
    // Rush 3 : figé 0–0,5 s (mouvement 0,0004) PUIS coupe entre 0,5 et 1 s.
    expect(propres.get(R3)).toEqual([[1, 5]]);
  });
  it('sans échantillon : le rush entier ; durée nulle : rien', () => {
    expect(plansPropres({ duree: 3, echantillons: [] })).toEqual([[0, 3]]);
    expect(plansPropres({ duree: 0, echantillons: [] })).toEqual([]);
  });
});

describe('séquence Vidéo (smart montage, unicité par timecode)', () => {
  const plan = planMontage(analyses, 13, { contexte, uniciteParTimecode: true, rushApres: R3 })!;

  it('durée cohérente avec la matière propre : ≥ 7,5 s (avant : 4 s), jamais plus que la cible', () => {
    expect(dureePlan(plan)).toBeGreaterThanOrEqual(7.5);
    expect(dureePlan(plan)).toBeLessThanOrEqual(13 + 1e-6);
  });
  it('chaque extrait tient dans UN plan propre (ni flash de coupe ni image figée), sans ralenti de coupe', () => {
    for (const s of plan) {
      const [a, b] = borne(s);
      expect(dansUnPlanPropre(s.url, a, b), `${s.url}@${a}-${b}`).toBe(true);
    }
  });
  it('chaque rush avant toute répétition, jamais deux plans de suite du même rush, aucun timecode repris', () => {
    const premiers = plan.slice(0, 3).map((s) => s.url);
    expect(new Set(premiers).size).toBe(3);
    for (let i = 1; i < plan.length; i++) expect(plan[i].url).not.toBe(plan[i - 1].url);
    for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        if (plan[i].url !== plan[j].url) continue;
        const [a, b] = borne(plan[i]);
        const [c, d] = borne(plan[j]);
        expect(Math.min(b, d) - Math.max(a, c), `${plan[i].url} ${a}-${b} / ${c}-${d}`).toBeLessThanOrEqual(1e-6);
      }
    }
  });
  it('le dernier plan ne vient pas du rush du fond du CTA (montré juste après)', () => {
    expect(plan.at(-1)!.url).not.toBe(R3);
  });
  it('Default safe : sans l’option (Autopilote), le plan d’avant à l’identique', () => {
    const avant = planMontage(analyses, 13, { contexte })!;
    expect(dureePlan(avant)).toBe(4);
    expect(avant.map((s) => [cleSource(s.url), s.depuis])).toEqual([
      ['/banc-medias/demo-rush-1.mp4', 0.2], ['/banc-medias/demo-rush-2.mp4', 0.2], ['/banc-medias/demo-rush-3.mp4', 2.75],
    ]);
  });
  it('Créer passe par l’option (préparation partagée aperçu / export), rush du CTA dans la clé', () => {
    const entree = entreePlanMontage({
      rushs: analyses.map((a) => ({ url: a.url, secondes: a.duree })), ordre: ['intro', 'cards', 'video', 'cta'] as const,
      duree: (k) => ({ intro: 6, cards: 14, video: 13, cta: 4.5 })[k], musique: null, theme: 'Le sport le plus complet',
      titre: 'LE SPORT LE PLUS COMPLET', sousTitre: null, objectif: null, cartes: [], methode: 'A', voixDeTextes: true, format: '9:16',
      rushApres: R3,
    });
    expect(entree.rushApres).toBe(R3);
    const prep = preparerPlanMontage(entree, { analysesBrutes: analyses, rythme: null });
    expect(prep.dureeVideo).toBeGreaterThanOrEqual(7.5);
    expect(prep.plan!.at(-1)!.url).not.toBe(R3);
  });
});

describe('cartes sur les rushes — répartition sur tout le montage', () => {
  const video = planMontage(analyses, 13, { contexte, uniciteParTimecode: true, rushApres: R3 })!;
  const durees = new Map(analyses.map((a) => [a.url, a.duree] as const));
  const fondTitre = { url: R1, debut: 0, fin: 6, depuis: 0 };
  const fondCta = { url: R3, debut: 0, fin: 4.5, depuis: 0.5 };
  const cartes = planCartesSurRushs({
    sources: sourcesDuPlan(video, durees), dureeCartes: 14, apparitions: [2.8, 5.6, 8.4, 11.2], dejaUtilises: video,
    plansPropres: propres, autresUsages: [fondTitre, fondCta], rushAvant: R1,
  })!;

  it('aucun plan ne commence dans l’image figée du rush 3 (gel de 0,7 s à 11,63 s) ni dans un flash de coupe', () => {
    for (const s of cartes) {
      const [a, b] = borne(s);
      expect(dansUnPlanPropre(s.url, a, b), `${s.url}@${a}-${b}`).toBe(true);
    }
  });
  it('raccords : le 1er plan ne continue pas le fond du Titre, le dernier n’est pas le rush qui ouvre la Vidéo', () => {
    expect(cartes[0].url).not.toBe(R1);
    expect(cartes.at(-1)!.url).not.toBe(video[0].url);
    for (let i = 1; i < cartes.length; i++) expect(cartes[i].url).not.toBe(cartes[i - 1].url);
  });
  it('chaque rush avant toute répétition, départs variés (jamais tous au début du rush)', () => {
    expect(new Set(cartes.slice(0, 3).map((s) => s.url)).size).toBe(3);
    const departs = cartes.map((s) => s.depuis ?? 0);
    expect(departs.every((d) => d > 0)).toBe(true);
    // Un même rush repris : à un autre timecode.
    for (const url of [R1, R2, R3]) {
      const d = cartes.filter((s) => s.url === url).map((s) => s.depuis ?? 0);
      expect(new Set(d).size).toBe(d.length);
    }
  });
  it('Default safe : sans mesures ni fonds, la répartition d’avant (rotation, rush entier)', () => {
    const sans = planCartesSurRushs({ sources: [{ url: 'a', duree: 30 }, { url: 'b', duree: 30 }], dureeCartes: 12, apparitions: [6] })!;
    expect(sans.map((s) => [s.url, s.depuis ?? 0])).toEqual([['a', 0], ['b', 0]]);
  });
});

describe('fonds en mouvement Titre / CTA — plages propres (#613)', () => {
  it('démo : Titre sur le plan propre du 1er rush, CTA sur la fin du plan propre du dernier (jamais l’image figée)', async () => {
    const { fondsRushTexte } = await import('@/lib/creer/fond-rush-texte');
    const rushs = analyses.map((a) => ({ url: a.url, secondes: a.duree }));
    const f = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, plansPropres: Object.fromEntries(propres) })!;
    expect(f.intro).toEqual({ url: R1, depuis: 0.5, jusqua: 4 });
    // Avant : depuis 0,5 s → 0,13 s d'image figée puis le flash de l'ancien plan.
    expect(f.cta).toEqual({ url: R3, depuis: 1, jusqua: 5 });
    // Sans mesure : la règle d'avant.
    expect(fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5 })!.cta).toEqual({ url: R3, depuis: 0.5 });
  });
});
