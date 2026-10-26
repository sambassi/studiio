/**
 * PROTECTION DE LA PAROLE (`protectionParole`) — moteur par défaut (Autopilote)
 * et plans propres (Créer). Silences mesurés ⇒ les bornes d'extraits évitent le
 * son parlé quand c'est possible ; sinon rien ne change, octet pour octet.
 */
import { describe, it, expect } from 'vitest';
import { planMontage, PENALITE_COUPE_PAROLE, type AnalyseRush, type EchantillonRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import { borneCoupeLaParole, paroleProtegeableDuRush } from '@/lib/creer/passages-rush';

/** Rush de `duree` s, échantillonné à 0,5 s ; son présent hors des silences donnés. */
function rush(url: string, duree: number, silences: Array<[number, number]> | undefined, extra: Partial<AnalyseRush> = {}): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const muet = (silences ?? []).some(([x, y]) => t >= x && t <= y);
    echantillons.push({
      t, mouvement: 0.05 + 0.04 * Math.sin(t * 1.3 + url.length), luminosite: 0.5, nettete: 0.6, audio: muet ? 0.001 : 0.08,
      empreinte: Array.from({ length: 64 }, (_, i) => ((i * 7 + Math.floor(t) * 13 + url.length * 31) % 100) / 100),
    });
  }
  return { url, duree, echantillons, pisteAudio: true, ...(silences ? { silences, sonContinu: false } : {}), ...extra };
}

// Deux témoignages : phrases de 2 à 3 s séparées par des pauses de 1 s (≈ 30 % de silence).
const PAUSES_A: Array<[number, number]> = [[3, 4], [6.5, 7.5], [10, 11], [13.5, 14.5], [17, 18]];
const PAUSES_B: Array<[number, number]> = [[2.5, 3.5], [6, 7], [9.5, 10.5], [13, 14], [16.5, 17.5]];
const A = rush('https://x/temoignage-a.mp4', 20, PAUSES_A);
const B = rush('https://x/temoignage-b.mp4', 20, PAUSES_B);
const CONTEXTE = { theme: 'témoignage client', objectif: 'conseil' };

const bornesCoupees = (plan: ReturnType<typeof planMontage>, rushs: AnalyseRush[]) => (plan ?? []).reduce((n, s) => {
  const r = rushs.find((x) => x.url === s.url)!;
  return n + [s.depuis ?? 0, s.jusqua ?? 0].filter((t) => borneCoupeLaParole(r, t)).length;
}, 0);

describe.each<[string, OptionsMontage]>([
  ['Autopilote (moteur par défaut)', { netteteCommune: true, contexte: CONTEXTE }],
  ['Créer (plans propres)', { uniciteParTimecode: true, netteteCommune: true, contexte: CONTEXTE }],
])('%s', (_nom, options) => {
  const avant = planMontage([A, B], 16, options);
  const apres = planMontage([A, B], 16, { ...options, protectionParole: true });

  it('parole protégeable détectée sur ces rushes', () => {
    expect(paroleProtegeableDuRush(A)).toBe(true);
    expect(paroleProtegeableDuRush(B)).toBe(true);
  });
  it('moins de bornes en plein son parlé avec la protection', () => {
    expect(avant && apres).toBeTruthy();
    expect(bornesCoupees(apres, [A, B])).toBeLessThan(bornesCoupees(avant, [A, B]));
  });
  it('les créneaux (cuts calés sur la musique) ne bougent pas ; durée jamais rallongée', () => {
    const fin = (p: typeof avant) => p![p!.length - 1].fin;
    expect(fin(apres)).toBeLessThanOrEqual(16 + 1e-6);
    expect(fin(apres)).toBeLessThanOrEqual(fin(avant) + 1e-6);
  });
  it('les raisons le disent', () => {
    expect(apres!.every((s) => /silences mesurés|plein son parlé/.test(s.raison ?? ''))).toBe(true);
  });
  it('sans silences mesurés, ou son continu : plan identique, octet pour octet', () => {
    const sansMesure = [rush('https://x/temoignage-a.mp4', 20, undefined), rush('https://x/temoignage-b.mp4', 20, undefined)];
    expect(planMontage(sansMesure, 16, { ...options, protectionParole: true })).toEqual(planMontage(sansMesure, 16, options));
    const continus = [rush('https://x/temoignage-a.mp4', 20, PAUSES_A, { sonContinu: true }), rush('https://x/temoignage-b.mp4', 20, PAUSES_B, { sonContinu: true })];
    expect(planMontage(continus, 16, { ...options, protectionParole: true })).toEqual(planMontage(continus, 16, options));
  });
  it('option absente ou fausse : plan d’avant', () => {
    expect(planMontage([A, B], 16, { ...options, protectionParole: false })).toEqual(avant);
  });
});

describe('borneCoupeLaParole', () => {
  it('silence = pas de coupe ; plein son = coupe ; bords du fichier = jamais', () => {
    expect(borneCoupeLaParole(A, 3.3)).toBe(false);
    expect(borneCoupeLaParole(A, 5)).toBe(true);
    expect(borneCoupeLaParole(A, 0)).toBe(false);
    expect(borneCoupeLaParole(A, 20)).toBe(false);
  });
  it('la pénalité reste sous celle d’un flash et au-dessus du bonus de variété', () => {
    expect(PENALITE_COUPE_PAROLE).toBeGreaterThan(0.2);
    expect(PENALITE_COUPE_PAROLE).toBeLessThan(1);
  });
});

import { readFileSync } from 'fs';
describe('câblage : un seul interrupteur pour les deux parcours', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('Créer (méthode A), Autopilote et Autopilote multi-sources passent PROTECTION_PAROLE_PAR_DEFAUT ; la méthode B non', () => {
    const creer = src('src/lib/creer/preparer-plan-montage.ts');
    expect(creer).toContain('...(ameliore ? { netteteCommune: true, protectionParole: PROTECTION_PAROLE_PAR_DEFAUT } : {}), rushApres');
    expect(creer.split('\n').find((l) => l.includes("entree.methode === 'B'"))).not.toContain('protectionParole');
    const produire = src('src/lib/autopilot/produire.ts');
    expect(produire).toContain('const protectionParoleRushs = ameliore && PROTECTION_PAROLE_PAR_DEFAUT && sonDesRushsAudible(configUtilisee);');
    // Les trois appels du moteur dans l'Autopilote reçoivent la valeur conditionnée au compte admin ET au son réellement gardé.
    expect(produire.match(/\.\.\.\(ameliore \? \{ netteteCommune: true, protectionParole: protectionParoleRushs \} : \{\}\)/g)?.length).toBe(3);
    expect(produire).not.toContain('protectionParole: PROTECTION_PAROLE_PAR_DEFAUT');
    // multi-sources : plus aucun défaut « amélioré » — il vient de `produireUnMontage` pour un compte admin seulement.
    expect(src('src/lib/autopilot/plan-multi-sources.ts')).not.toMatch(/netteteCommune|protectionParole/);
  });
});

import { sonDesRushsAudible } from '@/lib/autopilot/produire';
describe('régression — Autopilote : protection seulement si le son des rushes est entendu', () => {
  it('son coupé (défaut du compte), niveau nul ou inconnu : pas de protection', () => {
    expect(sonDesRushsAudible({ keepRushAudio: false, rushVolume: 0.8 })).toBe(false);
    expect(sonDesRushsAudible({ keepRushAudio: true, rushVolume: 0 })).toBe(false);
    expect(sonDesRushsAudible({ keepRushAudio: true })).toBe(false);
    expect(sonDesRushsAudible({})).toBe(false);
  });
  it('son gardé à un niveau non nul : protection', () => {
    expect(sonDesRushsAudible({ keepRushAudio: true, rushVolume: 0.5 })).toBe(true);
  });
  it('son coupé ⇒ sélection d’images identique au moteur sans protection (aucune pénalité inutile)', () => {
    const o: OptionsMontage = { netteteCommune: true, contexte: CONTEXTE };
    expect(planMontage([A, B], 16, { ...o, protectionParole: sonDesRushsAudible({ keepRushAudio: false, rushVolume: 0.8 }) })).toEqual(planMontage([A, B], 16, o));
  });
});

describe('régression — sons sportifs intermittents : pas pris pour de la parole hors profil « parole »', () => {
  // Mêmes rushes (son intermittent, silences mesurés, son non continu) mais sujet SPORT / DANSE.
  it.each([
    ['fitness musculation', { netteteCommune: true }],
    ['fitness musculation', { uniciteParTimecode: true, netteteCommune: true }],
    ['danse afro cardio', { uniciteParTimecode: true, netteteCommune: true }],
  ] as Array<[string, OptionsMontage]>)('sujet « %s » : plan identique avec ou sans protection', (theme, o) => {
    const base = { ...o, contexte: { theme } };
    expect(planMontage([A, B], 16, { ...base, protectionParole: true })).toEqual(planMontage([A, B], 16, base));
  });
  it('sujet « témoignage » : la protection agit toujours', () => {
    const base: OptionsMontage = { uniciteParTimecode: true, netteteCommune: true, contexte: CONTEXTE };
    expect(planMontage([A, B], 16, { ...base, protectionParole: true })).not.toEqual(planMontage([A, B], 16, base));
  });
});
