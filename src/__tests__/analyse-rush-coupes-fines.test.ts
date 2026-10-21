/**
 * #613 — 2e mesure des coupes (analyseur navigateur) : bornée en seeks, progression monotone.
 * Réserve QA : sans plafond, un rush long à coupes nombreuses demandait ~960 seeks (1,5 s de délai
 * chacun au pire) avec une progression figée à 0,95.
 */
import { describe, it, expect } from 'vitest';
import { localiserCoupesFines, SEEKS_FINS_MAX } from '@/lib/creer/analyse-rush';
import type { EchantillonRush } from '@/lib/creer/smart-montage';

const N = 16;
const img = (v: number) => new Float32Array(N).fill(v);
/** Rush simulé : `n` échantillons au pas `pas`, un plan différent tous les 4 échantillons (coupe franche). */
function rush(n: number, pas: number) {
  const images = Array.from({ length: n }, (_, i) => img(Math.floor(i / 4) % 2 ? 0.8 : 0.2));
  const echantillons: EchantillonRush[] = images.map((g, i) => ({
    t: i * pas, luminosite: 0.5, nettete: 0.1, audio: 0,
    mouvement: i === 0 ? 0 : Math.abs(g[0] - images[i - 1][0]) || 0.01,
    empreinte: Array.from({ length: 64 }, () => g[0]),
  }));
  return { images, echantillons };
}

describe('localiserCoupesFines — budget de seeks et progression', () => {
  it('rush long simulé (240 échantillons au pas de 0,75 s, ~60 coupes, ~400 images fines sans plafond) : seeks ≤ plafond, progression monotone dans [0,95 ; 1]', async () => {
    const { images, echantillons } = rush(240, 0.75);
    let seeks = 0;
    const progres: number[] = [];
    const fines = await localiserCoupesFines(echantillons, images, 0.75, async (t) => {
      seeks += 1;
      const i = Math.ceil(t / 0.75);
      return images[Math.min(images.length - 1, i)];
    }, (f) => progres.push(f));
    expect(seeks).toBeGreaterThan(0);
    expect(seeks).toBeLessThanOrEqual(SEEKS_FINS_MAX);
    expect(progres.length).toBe(seeks);
    for (let i = 1; i < progres.length; i++) expect(progres[i]).toBeGreaterThanOrEqual(progres[i - 1]);
    expect(Math.min(...progres)).toBeGreaterThanOrEqual(0.95);
    expect(Math.max(...progres)).toBeLessThan(1);
    expect(fines.length).toBeGreaterThan(0);
  });
  it('pas d’échantillonnage > 1 s (rush très long) : aucune 2e mesure, aucun seek', async () => {
    const { images, echantillons } = rush(240, 2);
    let seeks = 0;
    const fines = await localiserCoupesFines(echantillons, images, 2, async () => { seeks += 1; return img(0); });
    expect(seeks).toBe(0);
    expect(fines).toEqual([]);
  });
  it('rush court (démo) : chaque coupe localisée au dixième', async () => {
    const { images, echantillons } = rush(16, 0.5);
    const fines = await localiserCoupesFines(echantillons, images, 0.5, async (t) => (t < 0.5 * Math.ceil(t / 0.5) - 0.25 ? images[Math.floor(t / 0.5)] : images[Math.ceil(t / 0.5)]));
    expect(fines.length).toBe(3);
    for (const [a, b] of fines) expect(b - a).toBeCloseTo(0.1, 6);
  });
});
