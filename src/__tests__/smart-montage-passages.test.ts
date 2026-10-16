/**
 * M3-a PR1 — `planMontage(…, { selection: 'passages' })` : extraits pris DANS
 * les passages, jamais à cheval sur un changement de plan ni coupés dans un
 * geste ; grille musicale, CTA et anti-répétition inchangés ; durée réalisable
 * dite, jamais comblée.
 */
import { describe, it, expect } from 'vitest';
import { planMontage, cleSource, type AnalyseRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import { decouperPassages, rapportSelection } from '@/lib/creer/passages-rush';
import { memeTimecode, FENETRE_FLASH_S } from '@/lib/creer/smart-montage-regles';
import fixture from './fixtures/passages-rushes-reels.json';

const REELS = fixture.rushes as AnalyseRush[];
const sondes = Object.fromEntries(REELS.map((a) => [cleSource(a.url), { pisteAudio: a.url.includes('converted_') }]));
const SCENARIOS: Array<{ nom: string; cible: number; options: OptionsMontage }> = [
  { nom: 'danse', cible: 60, options: { profil: 'CARDIO_DANCE', contexte: { theme: 'danse afro cardio', cartes: ['Brûle des calories', 'Bouge'] }, rythme: fixture.rythme60 } },
  { nom: 'nutrition', cible: 46, options: { contexte: { theme: 'nutrition', sujet: 'bien manger' }, rythme: fixture.rythme46 } },
  { nom: 'lifestyle', cible: 60, options: { profil: 'LIFESTYLE_BRAND', contexte: { theme: 'mode et style' }, rythme: fixture.rythme60 } },
  { nom: 'tutoriel-sans-musique', cible: 30, options: { profil: 'TUTORIAL_EDUCATION' } },
  { nom: 'evenement', cible: 20, options: { profil: 'EVENT_IMMERSIVE', rythme: fixture.rythme46 } },
];
const passages = (o: OptionsMontage): OptionsMontage => ({ ...o, selection: 'passages', entreesPassages: sondes });

/** Matière abondante et propre : 6 rushes de 20 s, un seul plan chacun, mouvement varié. */
function abondant(nb = 6, opts: { nb?: number } = {}): AnalyseRush[] {
  return Array.from({ length: nb }, (_, r) => ({
    url: `https://studiio.pro/storage/v1/object/public/media/u1/abondant-${r}.mp4`,
    duree: 20,
    echantillons: Array.from({ length: 40 }, (_, i) => ({
      t: i * 0.5,
      mouvement: i === 0 ? 0 : 0.03 + 0.03 * ((i * (r + 3)) % 7) / 7,
      luminosite: 0.45 + 0.01 * r,
      nettete: 0.08,
      audio: 0,
      empreinte: Array.from({ length: 64 }, (_, k) => ((k * (r + 1) + Math.floor(i / 4) * 7) % 23) / 23),
      saturation: opts.nb !== undefined && r === opts.nb ? 0.01 : 0.3,
    })),
  }));
}

describe('mode passages sur les 6 rushes réels', () => {
  for (const sc of SCENARIOS) {
    describe(sc.nom, () => {
      const plan = planMontage(REELS, sc.cible, passages(sc.options));
      const parCle = new Map(REELS.map((a) => [cleSource(a.url), a]));

      it('produit un plan, chaque extrait dans UN passage, aucune borne dans un geste', () => {
        expect(plan).not.toBeNull();
        for (const s of plan!) {
          const a = parCle.get(cleSource(s.url))!;
          const d = decouperPassages(a, sondes[cleSource(s.url)]);
          const p = d.passages.find((x) => s.depuis! >= x.debut - 1e-6 && s.jusqua! <= x.fin + 1e-6);
          expect(p, `${s.url} ${s.depuis}-${s.jusqua}`).toBeDefined();
          expect(s.passage).toEqual({ debut: p!.debut, fin: p!.fin, motifDebut: p!.motifDebut, motifFin: p!.motifFin });
          for (const z of d.zones) {
            if (z.type !== 'geste') expect(s.depuis! < z.fin && s.jusqua! > z.debut, 'à cheval sur un changement').toBe(false);
            else for (const b of [s.depuis!, s.jusqua!]) expect(b > z.debut + 1e-6 && b < z.fin - 1e-6, 'borne dans un geste').toBe(false);
          }
        }
      });

      it('vrais changements de plan (ffmpeg 20,03 / 24,03 / 50,83 s) jamais à l\'intérieur d\'un extrait', () => {
        const vrais: Record<string, number[]> = { converted_1791985445290: [20.033, 24.033], converted_1792081208949: [50.833] };
        for (const s of plan!) {
          for (const [n, cuts] of Object.entries(vrais)) if (s.url.includes(n)) for (const c of cuts) expect(c > s.depuis! && c < s.jusqua!).toBe(false);
        }
      });

      it('CORRECTION B : chaque extrait dit sa parole ; jamais « pause_franche » sans silence mesuré', () => {
        for (const s of plan!) {
          expect(['incertaine', 'absente']).toContain(s.parole!.debut);
          expect(['incertaine', 'absente']).toContain(s.parole!.fin);
          if (s.url.includes('pexels')) expect(s.parole).toEqual({ debut: 'absente', fin: 'absente' });
        }
        const rap = rapportSelection(plan, REELS, sc.cible, sondes, cleSource);
        if (plan!.some((s) => s.parole!.debut === 'incertaine')) expect(rap.incertitudes.join(' ')).toMatch(/parole non vérifiée/);
      });

      it('aucune répétition, aucun ralenti, anti-flash 3 s respecté', () => {
        const fen = plan!.map((s) => ({ cle: cleSource(s.url), depuis: s.depuis!, jusqua: s.jusqua!, empreinte: null }));
        fen.forEach((f, i) => fen.slice(0, i).forEach((g) => expect(memeTimecode(f, g)).toBe(false)));
        for (const s of plan!) { expect(s.effet).toBeNull(); expect(s.vitesse).toBeUndefined(); }
        plan!.forEach((s, i) => plan!.slice(0, i).filter((q) => q.fin > s.debut - FENETRE_FLASH_S).forEach((q) => {
          expect(memeTimecode(fen[i], { cle: cleSource(q.url), depuis: q.depuis!, jusqua: q.jusqua!, empreinte: null })).toBe(false);
        }));
      });

      it('durée : jamais plus que la cible ; si elle manque, le rapport le dit', () => {
        const fin = plan![plan!.length - 1].fin;
        expect(fin).toBeLessThanOrEqual(sc.cible + 1e-6);
        const rap = rapportSelection(plan, REELS, sc.cible, sondes, cleSource);
        expect(rap.dureeRealisable).toBe(fin);
        expect(rap.repetitions).toBe(0);
        if (fin < sc.cible - 0.5) expect(rap.manque).toMatch(/réalisables sur/);
        else expect(rap.manque).toBeNull();
      });

      it('déterministe', () => {
        expect(JSON.stringify(planMontage(REELS, sc.cible, passages(sc.options)))).toBe(JSON.stringify(plan));
      });
    });
  }
});

describe('mode passages : ce qui ne change pas', () => {
  it('matière abondante : mêmes créneaux (début, fin, phase, temps fort visé) qu\'en mode grille', () => {
    for (const [profil, rythme] of [['CARDIO_DANCE', fixture.rythme60], ['LIFESTYLE_BRAND', fixture.rythme60], ['STANDARD', null]] as const) {
      const o: OptionsMontage = { profil, rythme };
      const g = planMontage(abondant(), 30, o)!;
      const p = planMontage(abondant(), 30, { ...o, selection: 'passages' })!;
      expect(g[g.length - 1].fin).toBe(30);
      expect(p.map((s) => [s.debut, s.fin, s.phase, s.beatCible])).toEqual(g.map((s) => [s.debut, s.fin, s.phase, s.beatCible]));
    }
  });

  it('#504 VERROU (danse) : matière en couleur ⇒ aucun plan noir et blanc en mode passages', () => {
    const plan = planMontage(abondant(6, { nb: 2 }), 30, { profil: 'CARDIO_DANCE', rythme: fixture.rythme60, selection: 'passages' })!;
    expect(plan.some((s) => s.url.includes('abondant-2'))).toBe(false);
    expect(plan.length).toBeGreaterThan(2);
  });

  it('pertinence absente, `null` ou 1 ⇒ plan identique (facteur neutre) ; pertinence faible ⇒ jamais plus de place', () => {
    const base = planMontage(REELS, 46, passages(SCENARIOS[1].options));
    const avec = (p: number | null) => planMontage(REELS, 46, {
      ...SCENARIOS[1].options, selection: 'passages',
      entreesPassages: Object.fromEntries(Object.entries(sondes).map(([k, v]) => [k, { ...v, pertinence: p }])),
    });
    expect(JSON.stringify(avec(null))).toBe(JSON.stringify(base));
    // P = 1 : même plan, seule la raison mentionne la pertinence lue.
    const sansRaison = (pl: ReturnType<typeof planMontage>) => JSON.stringify((pl ?? []).map(({ raison, ...x }) => x));
    expect(sansRaison(avec(1))).toBe(sansRaison(base));
    const cle2 = cleSource(REELS[1].url);
    const faible = planMontage(REELS, 46, { ...SCENARIOS[1].options, selection: 'passages', entreesPassages: { ...sondes, [cle2]: { ...sondes[cle2], pertinence: 0 } } })!;
    const part = (pl: NonNullable<typeof base>) => pl.filter((s) => cleSource(s.url) === cle2).reduce((a, s) => a + s.fin - s.debut, 0);
    expect(part(faible)).toBeLessThanOrEqual(part(base!) + 1e-6);
  });

  it('rush unique ou sans mesure : null, comme en mode grille', () => {
    expect(planMontage(REELS.slice(0, 1), 30, { selection: 'passages' })).toBeNull();
    expect(planMontage([], 30, { selection: 'passages' })).toBeNull();
    expect(planMontage([REELS[0], { url: 'x.mp4', duree: 10, echantillons: [] }], 30, { selection: 'passages' })).toBeNull();
    expect(planMontage(REELS, 0, { selection: 'passages' })).toBeNull();
  });

  it('multi-rush à 2 rushes muets à images-clés espacées : un passage par rush, plan possible', () => {
    const plan = planMontage([REELS[3], REELS[5]], 10, { selection: 'passages' });
    expect(plan).not.toBeNull();
    for (const s of plan!) expect(s.passage!.motifDebut).toBe('debut_rush');
  });

  it('durée insuffisante : plus court, jamais étiré ni répété', () => {
    const plan = planMontage(REELS.slice(2), 90, passages({ profil: 'CARDIO_DANCE', rythme: fixture.rythme60 }))!;
    const rap = rapportSelection(plan, REELS.slice(2), 90, sondes, cleSource);
    expect(rap.dureeRealisable).toBeLessThan(90);
    expect(rap.manque).toMatch(/plus courte, sans répétition, ralenti ni remplissage/);
    expect(rap.repetitions).toBe(0);
  });
});
