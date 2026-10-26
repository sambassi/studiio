/**
 * Comparaison de netteté ENTRE rushes : un rush entièrement flou n'est pas
 * « net » parce qu'il l'est partout autant, et ne sert jamais à gonfler la
 * diversité. Deux rushes nets, eux, servent tous les deux.
 */
import { describe, it, expect } from 'vitest';
import { planMontage, rushsNettementFlous, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';

function rush(url: string, duree: number, f: (t: number) => Partial<EchantillonRush>): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 1) {
    echantillons.push({
      t, mouvement: 0.08 + (t % 10 < 3 ? 0.2 : 0), luminosite: 0.5, nettete: 0.7, audio: 0.02,
      empreinte: Array.from({ length: 64 }, (_, i) => ((i * 7 + t * 13 + url.length * 31) % 100) / 100),
      ...f(t),
    });
  }
  return { url, duree, echantillons, pisteAudio: true };
}

const NET = rush('https://x/net.mp4', 60, () => ({}));
const NET2 = rush('https://x/net2.mp4', 50, () => ({ nettete: 0.65 }));
const FLOU = rush('https://x/flou.mp4', 45, () => ({ nettete: 0.1 }));

describe.each([20, 30, 45])('montage de %i s', (cible) => {
  it('un rush entièrement flou n’est pas retenu face à un rush net', () => {
    const plan = planMontage([NET, FLOU], cible, { uniciteParTimecode: true, netteteCommune: true }) ?? [];
    expect(plan.some((s) => s.url === FLOU.url)).toBe(false);
  });
  it('deux rushes nets sont tous les deux utilisés, le flou écarté', () => {
    const plan = planMontage([NET, NET2, FLOU], cible, { uniciteParTimecode: true, netteteCommune: true }) ?? [];
    const urls = new Set(plan.map((s) => s.url));
    expect(urls.has(NET.url) && urls.has(NET2.url)).toBe(true);
    expect(urls.has(FLOU.url)).toBe(false);
  });
});

// Banc réel (vidéos de test floutées σ=6 → netteté 40 % de la référence ; rushes nets entre eux ≥ 69 %).
describe('seuil de netteté entre rushes', () => {
  const NET_A = rush('https://x/a.mp4', 60, () => ({ nettete: 0.1 }));
  it('un rush nettement flou (40 % de la référence) est écarté', () => {
    const plan = planMontage([NET_A, rush('https://x/f40.mp4', 50, () => ({ nettete: 0.04 })), rush('https://x/b.mp4', 50, () => ({ nettete: 0.1 }))], 30, { uniciteParTimecode: true, netteteCommune: true }) ?? [];
    expect(plan.some((s) => s.url.endsWith('f40.mp4'))).toBe(false);
  });
  it('un rush un peu moins net (70 % de la référence) reste utilisable', () => {
    const plan = planMontage([NET_A, rush('https://x/m70.mp4', 50, () => ({ nettete: 0.07 })), rush('https://x/b.mp4', 50, () => ({ nettete: 0.1 }))], 30, { uniciteParTimecode: true, netteteCommune: true }) ?? [];
    expect(plan.some((s) => s.url.endsWith('m70.mp4'))).toBe(true);
  });
});

// Rush net COURT : le plan est null (pas 2 extraits) — le repli ne doit pas réintégrer le flou.
describe('repli quand le plan est null', () => {
  const COURT = rush('https://x/court.mp4', 8, () => ({}));
  it('un seul rush net court : plan exploitable fait du seul rush net, jamais null', () => {
    const plan = planMontage([COURT, FLOU], 30, { uniciteParTimecode: true, netteteCommune: true });
    expect(plan).not.toBeNull();
    expect(plan!.length).toBeGreaterThan(0);
    expect(plan!.every((s) => s.url === COURT.url)).toBe(true);
    const flous = rushsNettementFlous([COURT, FLOU]);
    expect([...flous]).toEqual([FLOU.url]);
  });
  it('rushes nets entre eux ou un seul rush : aucun flou désigné', () => {
    expect(rushsNettementFlous([NET, NET2]).size).toBe(0);
    expect(rushsNettementFlous([FLOU]).size).toBe(0);
  });
});

// Les deux parcours (Autopilote : options sans unicité ; Créer : unicité au timecode) écartent le flou et ne rallongent jamais.
describe.each([
  ['Autopilote', { netteteCommune: true }],
  ['Créer', { uniciteParTimecode: true, netteteCommune: true }],
])('%s : plusieurs rushs nets + un flou, cible 30 s', (_nom, options) => {
  const plan = planMontage([NET, NET2, FLOU], 30, options) ?? [];
  it('jamais le flou, durée jamais au-delà de la matière nette', () => {
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some((s) => s.url === FLOU.url)).toBe(false);
    expect(plan[plan.length - 1].fin).toBeLessThanOrEqual(30 + 1e-6);
  });
});
