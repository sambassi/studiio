/**
 * M3-a PR1 (correctifs QA éditoriale) — mode passages seulement :
 * 1. plan fixe ou graphique écarté ; 2. réutilisation plafonnée par passage ;
 * 3. plan vivant entier admis dans un créneau plus long ; 4. plan propre
 * retrouvé dans une zone de transition ; 5. accroche jamais en pleine phrase
 * s'il existe une alternative ; 6. « piste muette » ≠ « sans piste son ».
 */
import { describe, it, expect } from 'vitest';
import { planMontage, cleSource, type AnalyseRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import {
  decouperPassages, fenetreFixe, plafondPassage, plansEntiersCourts, paroleExtrait, borneDansLeSon, SEUILS_PASSAGES,
} from '@/lib/creer/passages-rush';
import fixture from './fixtures/passages-rushes-reels.json';

const REELS = fixture.rushes as AnalyseRush[];
const [RUSH1, RUSH2] = REELS;
const sondes = Object.fromEntries(REELS.map((a) => [cleSource(a.url), { pisteAudio: a.url.includes('converted_') }]));
const SCENARIOS: Array<{ nom: string; cible: number; options: OptionsMontage }> = [
  { nom: 'danse', cible: 60, options: { profil: 'CARDIO_DANCE', contexte: { theme: 'danse afro cardio', cartes: ['Brûle des calories', 'Bouge'] }, rythme: fixture.rythme60 } },
  { nom: 'nutrition', cible: 46, options: { contexte: { theme: 'nutrition', sujet: 'bien manger' }, rythme: fixture.rythme46 } },
  { nom: 'lifestyle', cible: 60, options: { profil: 'LIFESTYLE_BRAND', contexte: { theme: 'mode et style' }, rythme: fixture.rythme60 } },
];
const plans = SCENARIOS.map((sc) => ({ ...sc, plan: planMontage(REELS, sc.cible, { ...sc.options, selection: 'passages', entreesPassages: sondes })! }));

/** Matière graphique des 2 anciens montages (vérité terrain observée à l'œil, QA). */
const GRAPHIQUE: Record<string, Array<[number, number]>> = {
  converted_1791985445290: [[0, 9.5], [27.5, 32.1]],
  converted_1792081208949: [[0, 49.3], [51.3, 53.7]],
};

describe('1. plan fixe ou graphique', () => {
  it('photo fixe, cartons de texte et écran CTA des rushes réels : écartés avec la raison', () => {
    const d1 = decouperPassages(RUSH1);
    expect(d1.passages.map((p) => [p.debut, p.fin])).toEqual([[12.1, 19.5], [20.1, 23.5], [24.1, 27]]);
    expect(d1.ecartes.filter((x) => /plan fixe ou graphique/.test(x.motif)).map((x) => [x.debut, x.fin])).toEqual([[0.5, 9], [27.6, 31.969]]);
    const d2 = decouperPassages(RUSH2);
    expect(d2.ecartes.filter((x) => /plan fixe ou graphique/.test(x.motif)).map((x) => [x.debut, x.fin])).toEqual([[0.5, 48.5], [51.6, 53.583]]);
  });

  it('fenêtre immobile détectée ; le plan filmé le plus calme (mer) reste vivant', () => {
    expect(fenetreFixe(RUSH2, 10, 14)).toBe(true);
    expect(fenetreFixe(RUSH1, 4, 8)).toBe(true);
    expect(fenetreFixe(RUSH1, 20.1, 23.5)).toBe(false);
    expect(decouperPassages(REELS[3]).passages).toHaveLength(1); // pexels-35532643 (mer)
  });

  it('rush synthétique tout immobile (photo) : aucun passage', () => {
    const photo: AnalyseRush = { url: 'p.mp4', duree: 10, echantillons: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.5, mouvement: 0.001, luminosite: 0.5, nettete: 0.1, audio: 0, empreinte: Array(64).fill(0.4), saturation: 0.3 })) };
    const d = decouperPassages(photo);
    expect(d.passages).toEqual([]);
    expect(d.ecartes[0].motif).toMatch(/plan fixe ou graphique/);
  });

  for (const { nom, plan } of plans) {
    it(`${nom} : aucun extrait d'écran de texte, de photo fixe ni de surimpression animée`, () => {
      for (const s of plan) {
        for (const [n, zones] of Object.entries(GRAPHIQUE)) {
          if (s.url.includes(n)) for (const [x, y] of zones) expect(s.depuis! < y - 0.05 && s.jusqua! > x + 0.05, `${n} ${s.depuis}-${s.jusqua}`).toBe(false);
        }
      }
    });
  }
});

describe('2. réutilisation plafonnée', () => {
  it('1 extrait pour un passage court (< 8 s), 2 au plus sinon', () => {
    expect(plafondPassage({ debut: 0, fin: 5.7, motifDebut: 'debut_rush', motifFin: 'fin_rush', gestes: [] })).toBe(1);
    expect(plafondPassage({ debut: 0.5, fin: 11, motifDebut: 'debut_rush', motifFin: 'coupe', gestes: [] })).toBe(2);
  });
  for (const { nom, plan } of plans) {
    it(`${nom} : chaque passage respecte son plafond ; le rush de 5,7 s n'est jamais découpé en morceaux`, () => {
      const usage = new Map<string, number>();
      for (const s of plan) {
        const k = `${cleSource(s.url)}@${s.passage!.debut}`;
        usage.set(k, (usage.get(k) ?? 0) + 1);
        // PR2 : un passage long peut donner davantage d'extraits s'il a des moments distincts
        // mesurés — au plus 6 et au plus un par 3 s, jamais moins qu'avant ; c'est écrit.
        const p = s.passage! as never as { debut: number; fin: number };
        const haut = Math.max(plafondPassage(p as never), Math.min(6, Math.floor((p.fin - p.debut) / 3)));
        expect(usage.get(k)!).toBeLessThanOrEqual(haut);
        if (usage.get(k)! > plafondPassage(p as never)) expect(s.raison).toMatch(/moments distincts mesurés/);
      }
      expect(plan.filter((s) => s.url.includes('7815139')).length).toBeLessThanOrEqual(1);
    });
  }
});

describe('3. plans vivants entiers dans un créneau plus long', () => {
  it('plansEntiersCourts : plan entier plus court, ≥ 60 % du créneau', () => {
    const d = decouperPassages(RUSH1);
    expect(plansEntiersCourts(d, 4)).toEqual([[20.1, 3.4], [24.1, 2.9]]);
    expect(plansEntiersCourts(d, 2)).toEqual([]);
    expect(plansEntiersCourts(d, 6)).toEqual([]);
  });
  it('Nutrition (plans de 4 s) : les haltères 20,1–23,5 sont pris EN ENTIER, créneau raccourci, plan contigu', () => {
    const plan = plans.find((p) => p.nom === 'nutrition')!.plan;
    const h = plan.find((s) => s.url.includes('converted_1791985445290') && s.depuis === 20.1);
    expect(h).toBeDefined();
    expect(h!.jusqua).toBe(23.5);
    expect(h!.fin - h!.debut).toBeCloseTo(3.4, 3);
    expect(h!.raison).toMatch(/créneau raccourci/);
    plan.slice(1).forEach((s, i) => expect(s.debut).toBeCloseTo(plan[i].fin, 3));
  });
  it('le reste du créneau passe au plan suivant : la grille (fins de créneaux, temps forts) ne bouge pas', () => {
    const sc = SCENARIOS[1];
    const plan = plans.find((p) => p.nom === 'nutrition')!.plan;
    const court = plan.findIndex((s) => /créneau raccourci/.test(s.raison ?? ''));
    expect(court).toBeGreaterThanOrEqual(0);
    expect(plan[court + 1].raison).toMatch(/créneau allongé/);
    const grille = planMontage(REELS, sc.cible, sc.options)!;
    expect(plan.every((s, i) => i === 0 || Math.abs(s.debut - plan[i - 1].fin) < 1e-6)).toBe(true);
    const fins = grille.map((g) => g.fin);
    // Toute fin de plan (hors plan raccourci) retombe sur une fin de créneau de la grille d'aujourd'hui.
    for (const s of plan.filter((x) => !/créneau raccourci/.test(x.raison ?? ''))) {
      expect(fins).toContain(s.fin);
      expect(s.beatCible).toBe(grille.find((g) => g.fin === s.fin)!.beatCible);
    }
    // Les haltères (20,1–23,5) ET les tractions (24,1–27) sont pris en entier.
    expect(plan.some((s) => s.url.includes('converted_1791985445290') && s.depuis === 24.1 && s.jusqua === 27)).toBe(true);
  });
});

describe('4. zone de transition qui contient l\'action', () => {
  it('rush 2 : la danse au sol 49,75–50,5 s est un passage (interne), sans la coupe de 50,8 s', () => {
    const p = decouperPassages(RUSH2).passages;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: 49.75, fin: 50.5, interne: true }); // volet fini vers 49,7 s (image par image)
  });
  it('Danse : la seule danse du corpus est montée', () => {
    const plan = plans.find((p) => p.nom === 'danse')!.plan;
    const danse = plan.filter((s) => s.url.includes('converted_1792081208949'));
    expect(danse).toHaveLength(1);
    expect(danse[0].depuis).toBeGreaterThanOrEqual(49.75);
    expect(danse[0].jusqua).toBeLessThanOrEqual(50.5);
  });
});

describe('5. accroche', () => {
  for (const { nom, plan } of plans) {
    it(`${nom} : aucun plan HOOK dont une borne tombe en plein son incertain`, () => {
      for (const s of plan.filter((x) => x.phase === 'HOOK')) {
        const a = REELS.find((r) => r.url === s.url)!;
        const d = decouperPassages(a, sondes[cleSource(s.url)]);
        const pa = paroleExtrait(a, d, s.depuis!, s.jusqua!, sondes[cleSource(s.url)]);
        expect(pa.debut === 'incertaine' && borneDansLeSon(a, s.depuis!)).toBe(false);
        expect(pa.fin === 'incertaine' && borneDansLeSon(a, s.jusqua!)).toBe(false);
      }
    });
  }
  it('sans alternative visuelle (tout est sonore) : l\'accroche est tout de même trouvée (jamais un trou)', () => {
    const sonore = (k: number): AnalyseRush => ({
      url: `https://studiio.pro/storage/v1/object/public/media/u1/son-${k}.mp4`, duree: 12,
      echantillons: Array.from({ length: 24 }, (_, i) => ({ t: i * 0.5, mouvement: i ? 0.04 + 0.01 * ((i + k) % 3) : 0, luminosite: 0.45, nettete: 0.08, audio: 0.6, empreinte: Array.from({ length: 64 }, (_, j) => ((j * (k + 2) + i) % 11) / 11), saturation: 0.3 })),
    });
    const plan = planMontage([sonore(0), sonore(1), sonore(2)], 12, { profil: 'LIFESTYLE_BRAND', selection: 'passages' });
    expect(plan).not.toBeNull();
    expect(plan![0].phase).toBe('HOOK');
  });
});

describe('6. raison de la parole', () => {
  it('piste présente mais muette ⇒ « piste muette » ; sans piste ⇒ « sans piste son »', () => {
    const plan = plans.find((p) => p.nom === 'lifestyle')!.plan;
    const r1 = plan.filter((s) => s.url.includes('converted_1791985445290') && s.parole!.debut === 'absente');
    expect(r1.length).toBeGreaterThan(0);
    for (const s of r1) { expect(s.raison).toMatch(/piste muette/); expect(s.raison).not.toMatch(/sans piste son/); }
    for (const s of plan.filter((x) => x.url.includes('pexels'))) expect(s.raison).toMatch(/sans piste son/);
  });
});

describe('seuils', () => {
  it('constantes nommées', () => {
    expect(SEUILS_PASSAGES.mouvementFixe).toBe(0.006);
    expect(SEUILS_PASSAGES.passageCourtS).toBe(8);
    expect(SEUILS_PASSAGES.extraitsParPassage).toBe(2);
  });
});
