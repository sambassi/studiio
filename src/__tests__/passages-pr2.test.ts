/**
 * M3-a PR2 — moteur des passages (mode passages SEULEMENT ; éteint ailleurs) :
 * 1. silences mesurés transportés de l'analyse jusqu'aux entrées ;
 * 2. parole : borne dans un son de parole probable REFUSÉE, coupe dans un silence,
 *    phrase entière ; cas réel Lifestyle (orateur 12,1 → 13,78 s coupé dans un mot) ;
 * 3. interview sur pied (quasi immobile mais vivante) gardée, photo / texte écartés ;
 * 4. passages longs : plafond selon les moments distincts, jamais moins qu'avant ;
 * 5. répétitions visuelles réduites, 0 répétition de timecode ;
 * 6. accroche : pertinence M2-c fiable ≥ 0,6, sinon neutre et écrit.
 */
import { describe, it, expect } from 'vitest';
import { planMontage, cleSource, type AnalyseRush, type EchantillonRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import {
  decouperPassages, bornesAutorisees, paroleExtrait, fenetresSilences, paroleEntreSilences, entreesDuRush, momentsDistincts,
  plafondPassage, interviewProbable, fenetreFixe, rapportSelection, pertinencePourPassages, dansUnSilence, mouvementLocal, empreinteProche, borneSilencieuse,
  type EntreesPassages,
} from '@/lib/creer/passages-rush';
import { mesurerSilences } from '@/lib/creer/silences-audio';
import { memeTimecode, similariteVisuelle, SIMILARITE_FLASH } from '@/lib/creer/smart-montage-regles';
import fixture from './fixtures/passages-rushes-reels.json';
import trames from './fixtures/silences-trames-reelles.json';

const T = (trames as unknown as { rushes: Record<string, Record<string, number[]>> }).rushes;
const BRUTS = fixture.rushes as AnalyseRush[];
/** Analyses « comme le serveur les rend en PR2 » : mêmes mesures + son fin (PCM 8 kHz). */
const REELS: AnalyseRush[] = BRUTS.map((a) => {
  const n = a.url.split('/').pop()!.replace('.mp4', '');
  if (!T[n]) return { ...a, pisteAudio: false };
  const m = mesurerSilences(T[n]['8000']);
  return { ...a, pisteAudio: true, silences: m.silences, sonContinu: m.sonContinu };
});
const [RUSH1, RUSH2] = REELS;
const E1 = entreesDuRush(RUSH1);
const SCENARIOS: Array<{ nom: string; cible: number; options: OptionsMontage }> = [
  { nom: 'danse', cible: 60, options: { profil: 'CARDIO_DANCE', contexte: { theme: 'danse afro cardio', sujet: 'cours de danse Afroboost', cartes: ['Brûle des calories', 'Bouge en rythme', 'Énergie'] }, rythme: fixture.rythme60 } },
  { nom: 'nutrition', cible: 46, options: { contexte: { theme: 'nutrition', sujet: 'bien manger au quotidien', objectif: 'conseils simples' }, rythme: fixture.rythme46 } },
  { nom: 'lifestyle', cible: 60, options: { profil: 'LIFESTYLE_BRAND', contexte: { theme: 'lifestyle', sujet: 'marque de mode et style', cartes: ['Style', 'Élégance'] }, rythme: fixture.rythme60 } },
];
const PLANS = SCENARIOS.map((sc) => ({ ...sc, plan: planMontage(REELS, sc.cible, { ...sc.options, selection: 'passages' })! }));
const bornes = (s: { depuis?: number; jusqua?: number }) => [s.depuis!, s.jusqua!];

/** Rush synthétique : `vue(t)` = empreinte 8×8, `mv(t)` mouvement, `son(t)` énergie. */
function rush(nom: string, duree: number, f: { vue: (t: number) => number[]; mv?: (t: number) => number; son?: (t: number) => number; pas?: number }): AnalyseRush {
  const pas = f.pas ?? 0.5; const ech: EchantillonRush[] = [];
  for (let i = 0; i * pas < duree; i++) {
    const t = Math.round(i * pas * 1000) / 1000;
    ech.push({ t, mouvement: i === 0 ? 0 : (f.mv?.(t) ?? 0.03), luminosite: 0.5, nettete: 0.09, audio: f.son?.(t) ?? 0, empreinte: f.vue(t), saturation: 0.3 });
  }
  return { url: `https://studiio.pro/storage/v1/object/public/media/u1/${nom}.mp4`, duree, echantillons: ech };
}
const motif = (k: number) => Array.from({ length: 64 }, (_, i) => Math.round(((Math.sin(k * 2.3 + i * 0.9) + 1) / 2) * 1000) / 1000);

describe('1. silences transportés de l\'analyse aux entrées du mode passages', () => {
  it('entreesDuRush : silences, sonde et son continu viennent de l\'analyse ; l\'appelant peut les remplacer', () => {
    expect(E1.pisteAudio).toBe(true);
    expect(E1.silences).toEqual([[0, 10.25], [11.9, 12.35], [14.5, 15.25], [15.65, 16.45], [18.75, 19.7], [20.1, 32]]);
    expect(E1.sonContinu).toBe(false);
    expect(entreesDuRush(RUSH1, { silences: null }).silences).toBe(null);
    expect(entreesDuRush(BRUTS[0])).toEqual({});
    expect(entreesDuRush(REELS[2]).pisteAudio).toBe(false);
  });
  it('analyses porteuses ≡ silences passés par l\'appelant (même plan)', () => {
    const viaEntrees = planMontage(BRUTS, 46, { ...SCENARIOS[1].options, selection: 'passages', entreesPassages: Object.fromEntries(REELS.map((a) => [cleSource(a.url), entreesDuRush(a)])) });
    expect(JSON.stringify(viaEntrees)).toBe(JSON.stringify(PLANS[1].plan));
  });
});

describe('2. parole : coupe dans un silence, jamais dans un son de parole probable', () => {
  const d1 = decouperPassages(RUSH1, E1);
  it('parole localisable ; parole probable = complément des cœurs de silence (marge 0,1 s)', () => {
    expect(d1.paroleLocalisable).toBe(true);
    expect(d1.paroleMesuree).toEqual([[10.15, 12], [12.25, 14.6], [15.15, 15.75], [16.35, 18.85], [19.6, 20.2]]);
    // Silence qui touche la fin du fichier : pas de bord de ce côté (fin utile 31,969 s admise).
    expect(dansUnSilence(E1.silences, 31.969, RUSH1.duree)).toBe(true);
    expect(paroleEntreSilences([[1, 1.2]], 3)).toEqual([[0, 3]]); // < 300 ms : pas un silence
    expect(dansUnSilence(E1.silences, 12.1)).toBe(true);
    expect(dansUnSilence(E1.silences, 11.95)).toBe(false); // à moins de 0,1 s du bord
  });
  it('cas réel Lifestyle (PR1 : orateur 12,1 → 13,78 s, fin au milieu d\'un mot) : REFUSÉ ; 12,1 → 14,9 admis', () => {
    expect(bornesAutorisees(d1, 12.1, 13.78, E1)).toMatchObject({ ok: false, motif: expect.stringMatching(/son de parole probable/) });
    expect(bornesAutorisees(d1, 12.1, 14.9, E1).ok).toBe(true);
    expect(paroleExtrait(RUSH1, d1, 12.1, 14.9, E1)).toEqual({ debut: 'pause_franche', fin: 'pause_franche' });
    // Sans silences mesurés (PR1) : admis mais « incertaine » — c'est ce qui coupait le mot.
    const sans = decouperPassages(BRUTS[0], { pisteAudio: true });
    expect(bornesAutorisees(sans, 12.1, 13.78, { pisteAudio: true }).ok).toBe(true);
    expect(paroleExtrait(BRUTS[0], sans, 12.1, 13.78, { pisteAudio: true }).fin).toBe('incertaine');
  });
  it('les 3 scénarios : aucune borne du rush 1 dans un son de parole (vérité agent : 12,4–14,45 en particulier)', () => {
    const VOIX: Array<[number, number]> = [[10.27, 11.65], [12.4, 14.45], [15.25, 15.6], [16.5, 18.65], [19.75, 20.1]];
    for (const { nom, plan } of PLANS) {
      for (const s of plan.filter((x) => x.url.includes('1791985445290'))) {
        for (const b of bornes(s)) {
          for (const [x, y] of VOIX) expect(b > x + 1e-6 && b < y - 1e-6, `${nom} ${s.depuis}→${s.jusqua}`).toBe(false);
        }
        expect(bornesAutorisees(d1, s.depuis!, s.jusqua!, E1).ok, `${nom} ${s.depuis}→${s.jusqua}`).toBe(true);
        expect(['pause_franche', 'absente']).toContain(s.parole!.debut);
        expect(['pause_franche', 'absente']).toContain(s.parole!.fin);
      }
    }
    const life = PLANS[2].plan.filter((x) => x.url.includes('1791985445290') && x.depuis! < 20);
    expect(life.length).toBeGreaterThan(0);
    for (const s of life) expect(s.jusqua! <= 12.4 || s.jusqua! >= 14.45).toBe(true);
  });
  it('rush à son continu (rush 2) : rien n\'est déduit — bornes « incertaine », écrit dans les incertitudes', () => {
    const e2 = entreesDuRush(RUSH2);
    const d2 = decouperPassages(RUSH2, e2);
    expect(d2.paroleLocalisable).toBe(false);
    expect(d2.paroleMesuree).toEqual([]);
    expect(paroleExtrait(RUSH2, d2, 49.75, 50.5, e2)).toEqual({ debut: 'incertaine', fin: 'incertaine' });
    expect(d2.incertitudes.join(' ')).toMatch(/aucune pause garantie/);
  });
  it('phrase entière : fenêtre d\'un cœur de silence au suivant, ≥ 60 % du créneau, plus courte que lui', () => {
    const f = fenetresSilences(d1, E1.silences, 3);
    // Phrase 12,35–14,5 s prise ENTIÈRE : d'un cœur de silence (passage dès 12,1 s) au suivant.
    expect(f).toContainEqual([12.175, 2.7]);
    for (const [s, l] of f) {
      expect(l).toBeLessThanOrEqual(3 + 1e-9);
      expect(l).toBeGreaterThanOrEqual(1.8 - 1e-9);
      expect(bornesAutorisees(d1, s, s + l, E1).ok, `${s}+${l}`).toBe(true);
    }
    expect(fenetresSilences(decouperPassages(RUSH2, entreesDuRush(RUSH2)), [], 3)).toEqual([]);
  });
  it('libellés honnêtes : « coupe dans un silence », jamais « fin de phrase » ; protection jamais absolue', () => {
    for (const { plan } of PLANS) for (const s of plan) expect((s.raison ?? '').replace(/sans preuve de fin de phrase/g, '')).not.toMatch(/fin de phrase/);
    const pause = PLANS.flatMap((p) => p.plan).filter((s) => s.parole?.debut === 'pause_franche' && s.parole?.fin === 'pause_franche');
    expect(pause.length).toBeGreaterThan(0);
    for (const s of pause) expect(s.raison).toMatch(/coupe dans un silence mesuré \(sans preuve de fin de phrase\)/);
    const rap = rapportSelection(PLANS[2].plan, REELS, 60, {}, cleSource);
    expect(rap.incertitudes.join(' ')).toMatch(/sans prouver une fin de phrase/);
  });
});

describe('2 bis. CTA garanti et marge au bord d\'une vraie coupe', () => {
  it('chaque scénario, chaque durée (y compris matière insuffisante) : le plan finit par un CTA, jamais au milieu', () => {
    const jeux: Record<string, AnalyseRush[]> = { tous: REELS, pexels: REELS.slice(2), perso: REELS.slice(0, 2), deux: [REELS[0], REELS[3]] };
    for (const sc of SCENARIOS) for (const [nomJeu, an] of Object.entries(jeux)) for (const cible of [6, 12, 20, 30, 46, 60, 90]) for (const rythme of [sc.options.rythme, null]) {
      const p = planMontage(an, cible, { ...sc.options, rythme, selection: 'passages' });
      if (!p) continue;
      const lib = `${sc.nom}/${nomJeu}/${cible}/${rythme ? 'musique' : 'sans'}`;
      expect(p[p.length - 1].phase, lib).toBe('CTA');
      const i = p.findIndex((x) => x.phase === 'CTA');
      expect(p.slice(i).every((x) => x.phase === 'CTA'), lib).toBe(true);
      // Timeline continue, sans trou ni chevauchement.
      p.forEach((x, k) => { if (k) expect(Math.abs(x.debut - p[k - 1].fin), lib).toBeLessThan(1e-6); });
    }
  });
  it('Nutrition : les haltères 20,1–23,5 s (juste après la coupe de 20,03 s, piste muette) restent pris en entier', () => {
    const d1 = decouperPassages(RUSH1, E1);
    expect(bornesAutorisees(d1, 20.1, 23.5, E1).ok).toBe(true);
    expect(PLANS[1].plan.some((s) => s.url.includes('1791985445290') && s.depuis === 20.1)).toBe(true);
    expect(PLANS[1].plan[PLANS[1].plan.length - 1].phase).toBe('CTA');
  });
  it('la marge d\'un seul côté ne vaut QU\'au bord d\'un passage ouvert par une vraie coupe', () => {
    const sil: Array<[number, number]> = [[5, 6]];
    const p = { debut: 5, fin: 9, motifDebut: 'coupe' as const, motifFin: 'fin_rush' as const };
    expect(borneSilencieuse(sil, 5, 10, p, 'debut')).toBe(true);
    expect(borneSilencieuse(sil, 5, 10, { ...p, motifDebut: 'debut_rush' }, 'debut')).toBe(false);
    expect(borneSilencieuse(sil, 5.02, 10, p, 'debut')).toBe(false); // pas au bord du passage
    expect(borneSilencieuse(sil, 5.95, 10, p, 'debut')).toBe(false); // le silence ne couvre pas le début de l'extrait
  });
});

describe('3. interview sur pied (quasi immobile mais vivante) ≠ plan fixe ou graphique', () => {
  // Tête et bouche : 4 blocs de l'empreinte bougent de ±0,02 ; le reste est immobile.
  const tete = (t: number) => { const v = motif(1); for (const k of [27, 28, 35, 36]) v[k] = Math.round((v[k] + 0.02 * Math.sin(t * 7.3 + k)) * 1000) / 1000; return v; };
  const parle = (t: number) => (t % 4 < 3 ? 0.12 : 0); // phrases de 3 s, pauses de 1 s
  const interview = rush('interview-pied', 20, { vue: tete, mv: () => 0.003, son: parle });
  const photo = rush('photo-voix', 20, { vue: () => motif(1), mv: () => 0.0005, son: parle });

  it('synthétique (À VALIDER sur une vraie interview sur pied) : gardée, raison et incertitude écrites', () => {
    const d = decouperPassages(interview, { pisteAudio: true });
    expect(d.passages.length).toBe(1);
    expect(d.interviews).toEqual([d.passages[0].debut]);
    expect(d.incertitudes.join(' ')).toMatch(/interview sur pied probable/);
    expect(interviewProbable(interview, 0, 20, { pisteAudio: true })).toBe(true);
    expect(fenetreFixe(interview, 2, 5, { pisteAudio: true })).toBe(false);
    expect(mouvementLocal(interview.echantillons[3], interview.echantillons[2])).toBeGreaterThan(0.01);
  });
  it('photo fixe portant une voix (comme le rush réel 2) et interview muette : toujours écartées', () => {
    expect(decouperPassages(photo, { pisteAudio: true }).passages).toEqual([]);
    expect(decouperPassages({ ...interview, echantillons: interview.echantillons.map((x) => ({ ...x, audio: 0 })) }, { pisteAudio: true }).passages).toEqual([]);
    expect(decouperPassages(interview, { pisteAudio: false }).passages).toEqual([]);
  });
  it('non-régression QA : rush 2 photo 0,5–48,5 s et écrans de texte du rush 1 toujours écartés, avec ou sans silences', () => {
    for (const e of [{}, { pisteAudio: true }, entreesDuRush(RUSH2)] as EntreesPassages[]) {
      expect(decouperPassages(RUSH2, e).ecartes.filter((x) => /plan fixe ou graphique/.test(x.motif)).map((x) => [x.debut, x.fin])).toEqual([[0.5, 48.5], [51.6, 53.583]]);
      expect(decouperPassages(RUSH2, e).interviews).toEqual([]);
    }
    for (const e of [{}, { pisteAudio: true }, E1] as EntreesPassages[]) {
      expect(decouperPassages(RUSH1, e).ecartes.filter((x) => /plan fixe ou graphique/.test(x.motif)).map((x) => [x.debut, x.fin])).toEqual([[0.5, 9], [27.6, 31.969]]);
    }
    expect(fenetreFixe(RUSH2, 10, 14, entreesDuRush(RUSH2))).toBe(true);
  });
  it('moteur : l\'interview est montée (elle n\'est plus « plan fixe ») et la raison le dit', () => {
    const p = planMontage([interview, REELS[2]], 12, { selection: 'passages', longueurExtrait: 2, entreesPassages: { [cleSource(interview.url)]: { pisteAudio: true } } })!;
    const pris = p.filter((s) => s.url === interview.url);
    expect(pris.length).toBeGreaterThan(0);
    expect(pris[0].raison).toMatch(/interview sur pied probable/);
  });
});

describe('4. passages longs : extraits selon les moments distincts mesurés', () => {
  const varie = rush('danse-40s', 40.5, { vue: (t) => motif(Math.floor(t / 8)), mv: () => 0.03 }); // 5 « moments » de 8 s
  const uniforme = rush('mer-40s', 40.5, { vue: () => motif(3), mv: () => 0.03 });
  const mh = 0.06;
  it('passage de 40 s à 5 moments ⇒ 5 extraits au plus ; uniforme ⇒ plafond d\'avant ; bornes 6 et 1 / 3 s', () => {
    const pv = decouperPassages(varie).passages[0];
    const pu = decouperPassages(uniforme).passages[0];
    expect(pv.fin - pv.debut).toBeGreaterThan(39);
    expect(momentsDistincts(varie, pv, 2, mh)).toBe(5);
    expect(plafondPassage(pv, 5)).toBe(5);
    expect(momentsDistincts(uniforme, pu, 2, mh)).toBe(1);
    expect(plafondPassage(pu, 1)).toBe(2); // jamais moins qu'avant
    expect(plafondPassage(pv, 9)).toBe(6);
    expect(plafondPassage({ debut: 0, fin: 9, motifDebut: 'debut_rush', motifFin: 'fin_rush', gestes: [] }, 9)).toBe(3);
    expect(plafondPassage({ debut: 0, fin: 5.7, motifDebut: 'debut_rush', motifFin: 'fin_rush', gestes: [] }, 4)).toBe(1);
    expect(plafondPassage(pv)).toBe(2); // sans mesure : règle PR1 inchangée
  });
  it('cas réels : orateur 7,4 s ⇒ 2 extraits au plus (était 1) ; mer 13,5 s quasi fixe ⇒ 2 (inchangé)', () => {
    const d = decouperPassages(RUSH1, E1);
    const orateur = d.passages.find((p) => p.debut === 12.1)!;
    expect(orateur.fin - orateur.debut).toBeCloseTo(7.4, 5);
    const mh = 0.0949;
    expect(plafondPassage(orateur)).toBe(1);
    expect(plafondPassage(orateur, momentsDistincts(RUSH1, orateur, 2.1, mh))).toBe(2);
    const mer = decouperPassages(REELS[3], entreesDuRush(REELS[3])).passages[0];
    expect(mer.fin - mer.debut).toBeCloseTo(13.46, 2);
    expect(momentsDistincts(REELS[3], mer, 2.1, mh)).toBe(1);
    expect(plafondPassage(mer, 1)).toBe(2);
  });
  it('moteur : le passage varié donne plus de 2 extraits, la raison le dit ; l\'uniforme jamais plus de 2', () => {
    const p = planMontage([varie, uniforme], 30, { selection: 'passages', longueurExtrait: 2 })!;
    const v = p.filter((s) => s.url === varie.url);
    expect(v.length).toBeGreaterThan(2);
    expect(v.length).toBeLessThanOrEqual(5);
    expect(v.some((s) => /5 moments distincts mesurés ⇒ 5 extraits au plus/.test(s.raison ?? ''))).toBe(true);
    expect(p.filter((s) => s.url === uniforme.url).length).toBeLessThanOrEqual(2);
  });
});

describe('5. répétitions', () => {
  it('même passage, image quasi identique : un seul extrait (PR1 en prenait 2) ; jamais deux fois le même timecode', () => {
    const fixe = rush('plan-long-identique', 20.5, { vue: () => motif(5), mv: () => 0.05 });
    const autre = rush('autre', 30.5, { vue: (t) => motif(10 + Math.floor(t / 3)), mv: () => 0.04 });
    const p = planMontage([fixe, autre], 24, { selection: 'passages', longueurExtrait: 2 })!;
    expect(p.filter((s) => s.url === fixe.url).length).toBe(1);
  });
  it('rush à images-clés espacées (aucune mesure dans l\'extrait) : comparaison sur la mesure la plus proche', () => {
    const gop = rush('gop-identique', 20.5, { vue: () => motif(6), mv: () => 0.05, pas: 4 });
    expect(empreinteProche(gop, 0.5, 2.5)).toEqual(motif(6));
    expect(empreinteProche({ ...gop, echantillons: [] }, 0, 1)).toBe(null);
    const autre = rush('autre-b', 30.5, { vue: (t) => motif(20 + Math.floor(t / 3)), mv: () => 0.04 });
    const p = planMontage([gop, autre], 24, { selection: 'passages', longueurExtrait: 2 })!;
    expect(p.filter((s) => s.url === gop.url).length).toBeLessThanOrEqual(1);
  });
  it('3 scénarios réels : 0 timecode repris, 0 paire d\'extraits proches (< 4 s ou même passage) quasi identiques', () => {
    for (const { nom, plan } of PLANS) {
      const f = plan.map((s) => ({ cle: cleSource(s.url), depuis: s.depuis!, jusqua: s.jusqua!, empreinte: null }));
      f.forEach((x, i) => f.slice(0, i).forEach((y) => expect(memeTimecode(x, y), nom).toBe(false)));
      for (let i = 0; i < plan.length; i++) for (let j = 0; j < i; j++) {
        const a = plan[i]; const b = plan[j];
        if (a.url !== b.url) continue;
        const proche = a.passage!.debut === b.passage!.debut || Math.max(0, Math.max(a.depuis!, b.depuis!) - Math.min(a.jusqua!, b.jusqua!)) < 4;
        const an = REELS.find((r) => r.url === a.url)!;
        const emp = (s: number, e: number) => { const xs = an.echantillons.filter((x) => x.t >= s && x.t <= e && x.empreinte); return xs.length ? xs[0].empreinte!.map((_v, k) => xs.reduce((t, x) => t + x.empreinte![k], 0) / xs.length) : null; };
        if (proche) expect((similariteVisuelle(emp(a.depuis!, a.jusqua!), emp(b.depuis!, b.jusqua!)) ?? 0) >= SIMILARITE_FLASH + 0.1, `${nom} ${a.depuis} / ${b.depuis}`).toBe(false);
      }
    }
  });
});

describe('6. accroche et pertinence M2-c', () => {
  const sc = SCENARIOS[0];
  const cles = REELS.map((a) => cleSource(a.url));
  it('pertinencePourPassages : fiable seulement si niveau connu, pas « à vérifier », confiance ≠ faible', () => {
    const base = { cle: 'k', raisons: [], motifs: [], sources: [], communs: [] } as never as Record<string, unknown>;
    expect(pertinencePourPassages({ ...base, niveau: 'pertinent', aVerifier: false, score: 0.8, confiance: 'elevee' } as never)).toEqual({ pertinence: 0.8, pertinenceFiable: true });
    expect(pertinencePourPassages({ ...base, niveau: 'partiel', aVerifier: true, score: 0.5, confiance: 'moyenne' } as never)).toEqual({ pertinence: 0.5, pertinenceFiable: false });
    expect(pertinencePourPassages({ ...base, niveau: 'hors_sujet', aVerifier: false, score: 0.1, confiance: 'faible' } as never)).toEqual({ pertinence: 0.1, pertinenceFiable: false });
    expect(pertinencePourPassages({ ...base, niveau: 'inconnu', aVerifier: false, score: null, confiance: 'faible' } as never)).toEqual({ pertinence: null, pertinenceFiable: false });
    expect(pertinencePourPassages(null)).toEqual({ pertinence: null, pertinenceFiable: false });
  });
  it('pertinence FIABLE : aucun plan HOOK d\'un rush < 0,6 quand une alternative existe', () => {
    const P: Record<string, number> = { [cles[2]]: 0.2, [cles[4]]: 0.3, [cles[3]]: 0.4, [cles[0]]: 0.9, [cles[5]]: 0.85, [cles[1]]: 0.7 };
    const ent = Object.fromEntries(cles.map((k) => [k, { pertinence: P[k], pertinenceFiable: true }]));
    const p = planMontage(REELS, sc.cible, { ...sc.options, selection: 'passages', entreesPassages: ent })!;
    const hooks = p.filter((s) => s.phase === 'HOOK');
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) expect(P[cleSource(h.url)], h.url).toBeGreaterThanOrEqual(0.6);
    expect(rapportSelection(p, REELS, sc.cible, ent, cleSource).incertitudes.join(' ')).not.toMatch(/accroche choisie sur des critères visuels/);
    // Même chiffres NON fiables : aucune contrainte (le plan est celui sans pertinence d'accroche).
    const nf = Object.fromEntries(cles.map((k) => [k, { pertinence: P[k], pertinenceFiable: false }]));
    const q = planMontage(REELS, sc.cible, { ...sc.options, selection: 'passages', entreesPassages: nf })!;
    expect(rapportSelection(q, REELS, sc.cible, nf, cleSource).incertitudes).toContain('accroche choisie sur des critères visuels (pertinence du sujet inconnue ou non fiable)');
  });
  it('aucune alternative ≥ 0,6 : l\'accroche existe quand même (jamais un trou), pénalisée et dite', () => {
    const ent = Object.fromEntries(cles.map((k) => [k, { pertinence: 0.3, pertinenceFiable: true }]));
    const p = planMontage(REELS, sc.cible, { ...sc.options, selection: 'passages', entreesPassages: ent })!;
    const hook = p.find((s) => s.phase === 'HOOK');
    expect(hook).toBeTruthy();
    expect(hook!.raison).toMatch(/accroche peu pertinente \(pertinence 0\.3 < 0,6, pénalisé\)/);
  });
  it('pertinence inconnue : neutre, et l\'incertitude est écrite', () => {
    for (const { cible, plan } of PLANS) {
      expect(rapportSelection(plan, REELS, cible, {}, cleSource).incertitudes).toContain('accroche choisie sur des critères visuels (pertinence du sujet inconnue ou non fiable)');
    }
  });
});
