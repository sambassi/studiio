import { describe, it, expect } from 'vitest';
import {
  DUCKING_VOIX,
  compensationLimiteur,
  dbVersGain,
  detecterParole,
  enveloppeDucking,
  enveloppeSousKeyframes,
  facteurEnveloppe,
  fusionnerSegments,
  gainMasterDb,
  niveauxPlan,
  placerParole,
  planDuckingVoix,
  planifierEnveloppe,
  profondeurAdaptative,
  soustraireFenetre,
  type ParamAutomatisable,
} from '@/lib/creer/mixageVoix';

const SR = 8000;
/** Piste : parole (bruit à −20 dBFS RMS) sur les intervalles donnés, silence ailleurs. */
function piste(duree: number, parole: Array<[number, number]>): Float32Array {
  const a = new Float32Array(Math.round(duree * SR));
  const amp = dbVersGain(-20) * Math.SQRT2;
  for (const [d, f] of parole) for (let i = Math.round(d * SR); i < Math.round(f * SR); i++) a[i] = amp * Math.sin(i * 0.7);
  return a;
}
const proche = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;

describe('detecterParole', () => {
  it('trouve les phrases, comble les micro-pauses, ignore le silence', () => {
    const seg = detecterParole([piste(6, [[0.5, 1.5], [1.7, 2.5], [4, 5]])], SR);
    // 0,2 s de trou < trouMaxS (0,35 s) : une seule phrase.
    expect(seg).toHaveLength(2);
    expect(proche(seg[0].start, 0.5) && proche(seg[0].end, 2.5)).toBe(true);
    expect(proche(seg[1].start, 4) && proche(seg[1].end, 5)).toBe(true);
  });
  it('piste muette : aucune parole', () => {
    expect(detecterParole([new Float32Array(SR * 2)], SR)).toEqual([]);
  });
});

describe('placement des voix dans le montage', () => {
  it('décale de la séquence et coupe à sa fin', () => {
    expect(placerParole([{ start: 0.2, end: 3 }], 10, 12)).toEqual([{ start: 10.2, end: 12 }]);
    expect(placerParole([{ start: 5, end: 6 }], 10, 12)).toEqual([]);
  });
  it('retire la fenêtre du jumeau (déjà duckée à part)', () => {
    expect(soustraireFenetre([{ start: 0, end: 10 }], { start: 3, end: 5 })).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }]);
  });
  it('fusionne les voix de plusieurs sources', () => {
    expect(fusionnerSegments([{ start: 4, end: 5 }, { start: 0, end: 2 }, { start: 1.5, end: 3 }])).toEqual([{ start: 0, end: 3 }, { start: 4, end: 5 }]);
  });
});

describe('enveloppeDucking', () => {
  const env = enveloppeDucking([{ start: 2, end: 4 }], { profondeurDb: -15 });
  const bas = dbVersGain(-15);
  it('musique intacte hors parole, −15 dB sous la parole', () => {
    expect(facteurEnveloppe(0, env)).toBe(1);
    expect(facteurEnveloppe(1.9, env)).toBe(1);
    expect(facteurEnveloppe(2, env)).toBeCloseTo(bas, 6);
    expect(facteurEnveloppe(3.5, env)).toBeCloseTo(bas, 6);
    expect(facteurEnveloppe(10, env)).toBe(1);
  });
  it('attaque AVANT la première syllabe (80 ms), relâche douce (600 ms) après la tenue', () => {
    expect(facteurEnveloppe(2 - DUCKING_VOIX.attaqueS, env)).toBe(1);
    const finTenue = 4 + DUCKING_VOIX.maintienS;
    expect(facteurEnveloppe(finTenue, env)).toBeCloseTo(bas, 6);
    const mi = facteurEnveloppe(finTenue + DUCKING_VOIX.relacheS / 2, env);
    expect(mi).toBeGreaterThan(bas);
    expect(mi).toBeLessThan(1);
    expect(facteurEnveloppe(finTenue + DUCKING_VOIX.relacheS, env)).toBeCloseTo(1, 6);
    expect(DUCKING_VOIX.attaqueS).toBeGreaterThanOrEqual(0.05);
    expect(DUCKING_VOIX.attaqueS).toBeLessThanOrEqual(0.15);
    expect(DUCKING_VOIX.relacheS).toBeGreaterThanOrEqual(0.4);
    expect(DUCKING_VOIX.relacheS).toBeLessThanOrEqual(0.8);
  });
  it('pas de pompage : deux phrases proches restent sous la même baisse', () => {
    const e = enveloppeDucking([{ start: 1, end: 2 }, { start: 2.5, end: 3 }], { profondeurDb: -15 });
    expect(facteurEnveloppe(2.3, e)).toBeCloseTo(bas, 6);
  });
  it('lit musical abaissé (fondDb) : la profondeur s’ajoute au lit', () => {
    const e = enveloppeDucking([{ start: 2, end: 3 }], { fondDb: -6, profondeurDb: -12 });
    expect(facteurEnveloppe(0, e)).toBeCloseTo(dbVersGain(-6), 6);
    expect(facteurEnveloppe(2.5, e)).toBeCloseTo(dbVersGain(-18), 6);
  });
});

describe('niveaux adaptatifs', () => {
  it('cas réel 19/10 : musique −16,5 dB RMS, voix −25,8 → voix 15 dB au-dessus pendant la parole, lit ≤ voix', () => {
    const { fondDb, profondeurDb } = niveauxPlan({
      sources: [{ segments: [{ start: 0, end: 30 }], depart: 0, niveauDb: -25.8 }],
      base: 0.5,
      musiqueFichierDb: -10.5,
    });
    const musiqueBase = -10.5 + 20 * Math.log10(0.5);
    expect(musiqueBase + fondDb).toBeLessThanOrEqual(-25.8 + 1e-9);
    expect(-25.8 - (musiqueBase + fondDb + profondeurDb)).toBeCloseTo(15, 6);
  });
  it('profondeur bornée entre −12 et −26 dB', () => {
    expect(profondeurAdaptative(-10, -60)).toBe(-12);
    expect(profondeurAdaptative(-40, -5)).toBe(-26);
  });
  it('niveaux inconnus : lit intact, profondeur fixe (−18 dB)', () => {
    expect(niveauxPlan({ sources: [{ segments: [{ start: 0, end: 1 }], depart: 0 }], base: 0.5 })).toEqual({ fondDb: 0, profondeurDb: DUCKING_VOIX.profondeurDb });
  });
});

describe('keyframes manuelles respectées', () => {
  const env = enveloppeDucking([{ start: 2, end: 4 }], { profondeurDb: -15 });
  it('sans keyframes : enveloppe telle quelle', () => {
    expect(enveloppeSousKeyframes(env, undefined, 0.5)).toBe(env);
  });
  it('musique déjà baissée par l’utilisateur sous la voix : aucune double baisse', () => {
    const kf = [{ id: 'a', time: 0, musicVolume: 0.5, rushVolume: 1 }, { id: 'b', time: 1.5, musicVolume: 0.05, rushVolume: 1 }];
    const e = enveloppeSousKeyframes(env, kf, 0.5);
    expect(facteurEnveloppe(3, e)).toBe(1);
  });
  it('musique remontée par l’utilisateur sous la voix : ramenée au plafond base × enveloppe', () => {
    const kf = [{ id: 'a', time: 0, musicVolume: 1, rushVolume: 1 }];
    const e = enveloppeSousKeyframes(env, kf, 0.5);
    expect(1 * facteurEnveloppe(3, e)).toBeCloseTo(0.5 * dbVersGain(-15), 5);
    expect(facteurEnveloppe(0.5, e)).toBeCloseTo(0.5, 5);
  });
});

describe('planDuckingVoix', () => {
  it('clé sur TOUTES les voix : globale et par séquence', () => {
    const pts = planDuckingVoix({
      sources: [
        { segments: [{ start: 0, end: 1 }], depart: 0, fin: 3 },
        { segments: [{ start: 0.5, end: 2 }], depart: 10, fin: 15 },
      ],
      base: 0.5,
    });
    expect(facteurEnveloppe(0.5, pts)).toBeLessThan(0.2);
    expect(facteurEnveloppe(11, pts)).toBeLessThan(0.2);
    expect(facteurEnveloppe(6, pts)).toBe(1);
  });
  it('aucune parole : aucun point (musique intacte)', () => {
    expect(planDuckingVoix({ sources: [], base: 0.5 })).toEqual([]);
  });
});

describe('master', () => {
  it('compensation du gain de rattrapage du DynamicsCompressor (spécification Web Audio)', () => {
    // seuil −2 dB, ratio 20 : sortie pleine échelle −1,9 dB → rattrapage +1,14 dB, annulé.
    expect(20 * Math.log10(compensationLimiteur(-2, 20))).toBeCloseTo(-1.14, 2);
  });
  it('normalisation bornée par les crêtes de la voix (jamais limitée)', () => {
    const g = gainMasterDb([{ segments: [{ start: 0, end: 10 }], depart: 0, niveauDb: -25.8, creteDb: -5.6 }]);
    expect(-5.6 + g).toBeLessThanOrEqual(-2.5 + 1e-9);
    expect(g).toBeGreaterThan(0);
    expect(gainMasterDb([{ segments: [], depart: 0 }])).toBe(0);
  });
});

describe('planifierEnveloppe', () => {
  it('programme les rampes exponentielles sur l’horloge audio', () => {
    const appels: string[] = [];
    const p: ParamAutomatisable = {
      cancelScheduledValues: () => appels.push('cancel'),
      setValueAtTime: (v, t) => appels.push(`set ${v.toFixed(3)}@${t.toFixed(2)}`),
      exponentialRampToValueAtTime: (v, t) => appels.push(`exp ${v.toFixed(3)}@${t.toFixed(2)}`),
    };
    planifierEnveloppe(p, [{ t: 0, gain: 1 }, { t: 1, gain: 0.1 }, { t: 2, gain: 1 }], 5);
    expect(appels).toEqual(['cancel', 'set 1.000@5.00', 'exp 0.100@6.00', 'exp 1.000@7.00']);
  });
});
