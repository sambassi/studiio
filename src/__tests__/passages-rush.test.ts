/**
 * M3-a PR1 — module pur `passages-rush.ts` : découpage en passages,
 * CORRECTION A (pics consécutifs = un seul événement), CORRECTION B (une
 * baisse de volume ne prouve pas une fin de phrase), score par rôle.
 */
import { describe, it, expect } from 'vitest';
import {
  decouperPassages, bornesAutorisees, departsCandidats, paroleExtrait, notePassagePhase, rapportSelection, SEUILS_PASSAGES,
} from '@/lib/creer/passages-rush';
import { SEUILS, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';
import fixture from './fixtures/passages-rushes-reels.json';

const REELS = fixture.rushes as AnalyseRush[];
const [RUSH1, RUSH2, PEX1, PEX2] = REELS;

/** Rush synthétique : `scenes` = instants de changement de scène, `gestes` = séries de pics dans une même scène. */
function rush(duree: number, o: { scenes?: number[]; gestes?: Array<[number, number]>; audio?: (t: number) => number; pas?: number; sansCouleur?: boolean } = {}): AnalyseRush {
  const pas = o.pas ?? 0.5;
  const ech: EchantillonRush[] = [];
  for (let i = 0; i * pas < duree; i++) {
    const t = Math.round(i * pas * 1000) / 1000;
    const scene = (o.scenes ?? []).filter((c) => c <= t).length;
    const changement = (o.scenes ?? []).some((c) => c <= t && c > t - pas);
    const geste = (o.gestes ?? []).some(([a, b]) => t >= a && t <= b);
    ech.push({
      t,
      mouvement: i === 0 ? 0 : changement || geste ? 0.3 : 0.02,
      luminosite: 0.45,
      nettete: 0.08,
      audio: o.audio ? o.audio(t) : 0,
      empreinte: Array.from({ length: 64 }, (_, k) => (scene % 2 ? 0.2 + (k % 8) * 0.08 : 0.8 - (k % 5) * 0.05)),
      ...(o.sansCouleur ? {} : { saturation: scene % 2 ? 0.1 : 0.3 }),
    });
  }
  return { url: 'https://studiio.pro/storage/v1/object/public/media/u1/synth.mp4', duree, echantillons: ech };
}

describe('seuils', () => {
  it('le pic de mouvement reprend le seuil de coupe du moteur', () => {
    expect(SEUILS_PASSAGES.picRelatif).toBe(SEUILS.coupeRelative);
  });
});

describe('découpage en passages', () => {
  it('pic isolé avec changement d\'image ⇒ UNE coupe, deux passages, extrait à cheval refusé', () => {
    const d = decouperPassages(rush(12, { scenes: [6] }));
    expect(d.zones).toHaveLength(1);
    expect(d.zones[0].type).toBe('coupe');
    // Le changement a eu lieu entre 5,5 et 6 s : zone ]5,5 ; 6,1].
    expect(d.zones[0].debut).toBe(5.5);
    expect(d.zones[0].fin).toBe(6.1);
    expect(d.passages.map((p) => [p.debut, p.fin])).toEqual([[0.5, 5.5], [6.1, 11.95]]);
    expect(d.passages[0].motifFin).toBe('coupe');
    expect(bornesAutorisees(d, 4, 7).ok).toBe(false);
    expect(bornesAutorisees(d, 1, 5).ok).toBe(true);
    expect(bornesAutorisees(d, 6.1, 9).ok).toBe(true);
  });

  it('CORRECTION A — pics consécutifs (≤ 1 s) dans la même scène ⇒ UN geste, aucune coupe', () => {
    const d = decouperPassages(rush(12, { gestes: [[4, 6]] }));
    expect(d.zones).toHaveLength(1);
    expect(d.zones[0].type).toBe('geste');
    expect(d.zones[0].pics).toEqual([4, 4.5, 5, 5.5, 6]);
    expect(d.passages).toHaveLength(1);
    expect(d.passages[0].gestes).toEqual([[3.5, 6.1]]);
    // Un extrait peut CONTENIR le geste, jamais y couper.
    expect(bornesAutorisees(d, 3, 7).ok).toBe(true);
    expect(bornesAutorisees(d, 3, 5).motif).toBe('borne au milieu d\'un geste');
    expect(bornesAutorisees(d, 5, 8).ok).toBe(false);
  });

  it('CORRECTION A — pics séparés d\'un seul échantillon calme restent UN événement ; séparés de 1,5 s, deux', () => {
    expect(decouperPassages(rush(12, { gestes: [[4, 4], [5, 5]] })).zones).toHaveLength(1);
    expect(decouperPassages(rush(12, { gestes: [[4, 4], [5.5, 5.5]] })).zones).toHaveLength(2);
  });

  it('CORRECTION A — rush réel converted_1792081208949 : 49 → 51,5 s compté 6 « coupes » aujourd\'hui, UNE zone ici', () => {
    const moy = RUSH2.echantillons.reduce((a, e) => a + e.mouvement, 0) / RUSH2.echantillons.length;
    const brutes = RUSH2.echantillons.filter((e) => e.mouvement > moy * SEUILS.coupeRelative && e.t >= 49 && e.t <= 51.5).map((e) => e.t);
    expect(brutes).toEqual([49, 49.5, 50, 50.5, 51, 51.5]);
    const d = decouperPassages(RUSH2);
    const zone = d.zones.filter((z) => z.debut < 51.5 && z.fin > 49);
    expect(zone).toHaveLength(1);
    expect(zone[0].pics).toEqual(brutes);
    // Images avant (mur de briques) et après (écran CTA) différentes : changement de plan progressif.
    expect(zone[0].type).toBe('transition');
    // Le pic isolé de 9 s (changement de surimpression, même scène) n'est PAS une coupe.
    expect(d.zones.find((z) => z.pics.includes(9))?.type).toBe('geste');
    expect(d.passages.map((p) => [p.debut, p.fin])).toEqual([[0.5, 48.5], [51.6, 53.583]]);
  });

  it('rush réel converted_1791985445290 : coupes à 20 et 24 s (ffmpeg 20,03 / 24,03), geste de l\'orateur 17–18 s', () => {
    const d = decouperPassages(RUSH1);
    expect(d.zones.map((z) => z.type)).toEqual(['transition', 'geste', 'coupe', 'coupe', 'coupe']);
    for (const vrai of [20.033, 24.033]) expect(d.zones.some((z) => z.type === 'coupe' && vrai > z.debut && vrai < z.fin)).toBe(true);
    // Aucun passage ne contient un vrai changement de plan.
    for (const vrai of [20.033, 24.033]) expect(d.passages.some((p) => vrai > p.debut && vrai < p.fin)).toBe(false);
  });

  it('sans saturation mesurée : critère plus prudent (lumière ou empreinte ≥ 0,12)', () => {
    const d = decouperPassages(rush(12, { scenes: [6], sansCouleur: true }));
    expect(d.zones[0].type).toBe('coupe');
  });

  it('pas > 0,75 s (images-clés espacées) ⇒ résolution grossière, UN passage, incertitude écrite', () => {
    const d = decouperPassages(PEX2);
    expect(d.resolution).toBe('grossiere');
    expect(d.zones).toEqual([]);
    expect(d.passages).toHaveLength(1);
    expect(d.incertitudes.join(' ')).toMatch(/aucun changement de plan interne localisable/);
    expect(decouperPassages(rush(12, { scenes: [6], pas: 3 })).passages).toHaveLength(1);
  });

  it('passage < 0,8 s (ici en début de rush) : écarté avec la raison, jamais fusionné par-dessus une coupe', () => {
    const d = decouperPassages(rush(12, { scenes: [1.5] }));
    expect(d.passages.every((p) => p.fin - p.debut >= SEUILS_PASSAGES.passageMinS)).toBe(true);
    expect(d.ecartes.some((x) => /trop court/.test(x.motif))).toBe(true);
  });

  it('départs candidats : débuts de passage, sorties de geste, tous DANS un passage', () => {
    const d = decouperPassages(rush(14, { scenes: [7], gestes: [[2, 3]] }));
    const departs = departsCandidats(d, 1.5);
    expect(departs).toContain(d.passages[0].debut);
    expect(departs).toContain(d.passages[1].debut);
    expect(departs).toContain(3.1); // sortie du geste
    for (const s of departs) expect(d.passages.some((p) => s >= p.debut && s + 1.5 <= p.fin + 1e-6)).toBe(true);
  });

  it('plages de parole fournies : aucune borne dedans', () => {
    const d = decouperPassages(rush(12));
    expect(bornesAutorisees(d, 2, 4, { plagesParole: [[3, 5]] }).ok).toBe(false);
    expect(bornesAutorisees(d, 1, 3, { plagesParole: [[3, 5]] }).ok).toBe(true);
  });

  it('rush vide ou sans mesure : aucun passage', () => {
    expect(decouperPassages({ url: 'x', duree: 0, echantillons: [] }).passages).toEqual([]);
  });

  it('déterministe : deux appels = même JSON', () => {
    for (const a of REELS) expect(JSON.stringify(decouperPassages(a))).toBe(JSON.stringify(decouperPassages(a)));
  });
});

describe('CORRECTION B — parole : jamais d\'affirmation non établie', () => {
  const sonore = rush(12, { audio: (t) => (t >= 7 ? 0 : t >= 4 && t < 5 ? 0.02 : 0.5) });

  it('baisse de volume sans silence mesuré ⇒ incertaine, et c\'est écrit', () => {
    const d = decouperPassages(sonore);
    expect(paroleExtrait(sonore, d, 1, 4.5)).toEqual({ debut: 'incertaine', fin: 'incertaine' });
    expect(d.incertitudes.join(' ')).toMatch(/ne prouve ni un silence ni une fin de phrase/);
  });

  it('silence franc mesuré (≥ 0,3 s, marge 0,1 s) ⇒ pause_franche ; trop court ou au bord ⇒ incertaine', () => {
    const e = { pisteAudio: true, silences: [[4, 4.8], [8, 8.25]] as Array<[number, number]> };
    const d = decouperPassages(sonore, e);
    expect(d.paroleLocalisable).toBe(true);
    expect(paroleExtrait(sonore, d, 4.4, 6, e).debut).toBe('pause_franche');
    expect(paroleExtrait(sonore, d, 4.05, 6, e).debut).toBe('incertaine'); // à 0,05 s du bord
    expect(paroleExtrait(sonore, d, 2, 8.12, e).fin).toBe('incertaine'); // silence de 0,25 s
    expect(paroleExtrait(sonore, d, 2, 3, e)).toEqual({ debut: 'incertaine', fin: 'incertaine' }); // en plein son
  });

  it('son continu > 80 % du temps : aucune pause garantie même avec des silences fournis', () => {
    const e = { pisteAudio: true, silences: [[4, 4.8]] as Array<[number, number]> };
    const continu = rush(12, { audio: () => 0.5 });
    const d = decouperPassages(continu, e);
    expect(d.paroleLocalisable).toBe(false);
    expect(paroleExtrait(continu, d, 4.4, 6, e).debut).toBe('incertaine');
    expect(d.incertitudes.join(' ')).toMatch(/son quasi continu/);
  });

  it('rush réel 2 (son ~99 % du temps, creux 30–30,5 s = transition musicale) : incertaine partout', () => {
    const e = { pisteAudio: true, silences: [] as Array<[number, number]> };
    const d = decouperPassages(RUSH2, e);
    expect(d.paroleLocalisable).toBe(false);
    expect(paroleExtrait(RUSH2, d, 30, 32, e)).toEqual({ debut: 'incertaine', fin: 'incertaine' });
  });

  it('absente : seulement sonde « pas de piste », ou piste muette sur tout l\'extrait', () => {
    const muet = rush(12);
    const d = decouperPassages(muet);
    expect(paroleExtrait(muet, d, 1, 3, { pisteAudio: false })).toEqual({ debut: 'absente', fin: 'absente' });
    expect(paroleExtrait(muet, d, 1, 3, { pisteAudio: true })).toEqual({ debut: 'absente', fin: 'absente' });
    // audio = 0 sans sonde : indiscernable d'un silence ⇒ incertaine.
    expect(paroleExtrait(muet, d, 1, 3, {})).toEqual({ debut: 'incertaine', fin: 'incertaine' });
    expect(d.incertitudes.join(' ')).toMatch(/indiscernable d'un silence/);
    expect(paroleExtrait(PEX1, decouperPassages(PEX1), 1, 3)).toEqual({ debut: 'incertaine', fin: 'incertaine' });
  });
});

describe('score par rôle', () => {
  const m = { base: 0.5, qualite: 0.6, mouvAbs: 0.8, nettete: 0.7, energie: 0.9, ratees: 0 };
  const ctx = { pertinence: null, departPassage: false, prolongeAction: false };

  it('pertinence inconnue ⇒ facteur EXACTEMENT 1 ; connue ⇒ ne peut que retirer', () => {
    expect(notePassagePhase(m, 'FOCUS', ctx).score).toBe(0.5 + 0.15 * 0.7);
    expect(notePassagePhase(m, 'FOCUS', { ...ctx, pertinence: undefined }).score).toBe(notePassagePhase(m, 'FOCUS', ctx).score);
    expect(notePassagePhase(m, 'FOCUS', { ...ctx, pertinence: 1 }).score).toBe(notePassagePhase(m, 'FOCUS', ctx).score);
    expect(notePassagePhase(m, 'FOCUS', { ...ctx, pertinence: 0.2 }).score).toBeLessThan(notePassagePhase(m, 'FOCUS', ctx).score);
    expect(notePassagePhase(m, 'FOCUS', { ...ctx, pertinence: 5 }).score).toBe(notePassagePhase(m, 'FOCUS', ctx).score);
  });

  it('HOOK : accroche franche récompensée ; énergie faible ou image ratée pénalisée', () => {
    const franc = notePassagePhase(m, 'HOOK', { ...ctx, departPassage: true }).score;
    const neutre = notePassagePhase(m, 'HOOK', ctx).score;
    expect(franc - neutre).toBeCloseTo(0.15, 10);
    expect(notePassagePhase({ ...m, energie: 0.4 }, 'HOOK', ctx).score).toBeCloseTo(neutre - 0.3, 10);
    expect(notePassagePhase({ ...m, ratees: 0.1 }, 'HOOK', ctx).score).toBeCloseTo(neutre - 0.3, 10);
  });

  it('BUILD : prolonger l\'action vaut +0,10 ; PEAK et CTA gardent les bonus d\'aujourd\'hui', () => {
    expect(notePassagePhase(m, 'BUILD', { ...ctx, prolongeAction: true }).score - notePassagePhase(m, 'BUILD', ctx).score).toBeCloseTo(0.1, 10);
    expect(notePassagePhase(m, 'PEAK', ctx).score).toBeCloseTo(0.5 + 0.25 * 0.8, 10);
    expect(notePassagePhase(m, 'CTA', ctx).score).toBeCloseTo(0.5 + 0.2 * 0.6, 10);
  });
});

describe('rapport de sélection : durée réalisable dite, jamais masquée', () => {
  const url = (n: string) => `https://studiio.pro/storage/v1/object/public/media/u1/${n}.mp4`;
  it('plan plus court que la cible ⇒ manque écrit ; plan complet ⇒ manque null', () => {
    const plan = [{ url: url('a'), debut: 0, fin: 3, depuis: 1, jusqua: 4 }, { url: url('b'), debut: 3, fin: 6, depuis: 0, jusqua: 3 }];
    const court = rapportSelection(plan, [], 10);
    expect(court.dureeRealisable).toBe(6);
    expect(court.manque).toMatch(/6 s réalisables sur 10 s visées/);
    expect(court.manque).toMatch(/sans répétition, ralenti ni remplissage/);
    expect(rapportSelection(plan, [], 6).manque).toBeNull();
    expect(rapportSelection(null, [], 6).manque).toMatch(/aucun montage possible/);
  });
  it('compte les répétitions de matière (timecodes qui se chevauchent)', () => {
    const plan = [{ url: url('a'), debut: 0, fin: 3, depuis: 1, jusqua: 4 }, { url: url('a'), debut: 3, fin: 6, depuis: 2, jusqua: 5 }];
    expect(rapportSelection(plan, [], 6).repetitions).toBe(1);
  });
});
