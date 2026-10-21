/**
 * Autopilote — les extraits de rushes personnels tiennent dans leurs PLANS
 * PROPRES (`plansPropres`, #613), comme dans Créer.
 *
 * Constat (banc, rushes rush-1..3 : coupe de la source à 0,43 s / 0,3 s, image
 * figée 0–0,63 s) : l'Autopilote montait « rush-1 depuis 0 » — 0,43 s d'un
 * autre plan au MP4 (coupe réelle à 3,03 s avec avatar, 14,0 s sans).
 */
import { describe, it, expect } from 'vitest';
import { planMultiSources, type EntreePlanMultiSources } from '@/lib/autopilot/plan-multi-sources';
import { plansPropres, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';

const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';
const R = [1, 2, 3].map((i) => `https://studiio.pro/storage/v1/object/public/media/u1/rush-${i}.mp4`);
const SV = 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-111.mp4';

/** Rush de `duree` s dont la tête [0, 0,5] est FIGÉE (mouvement nul à 0,5 s). */
function analyseTeteFigee(url: string, duree: number, graine: number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const g = graine + Math.floor(t * 2) * 13;
    echantillons.push({
      t, mouvement: t === 0.5 ? 0 : 0.06 + ((t * 7 + graine) % 5) / 40, luminosite: 0.5, nettete: 0.1, audio: 0.4,
      empreinte: Array.from({ length: 64 }, (_, i) => ((g * 31 + i * 17) % 97) / 97),
    });
  }
  return { url, duree, echantillons };
}

const analyses = R.map((u, i) => analyseTeteFigee(u, i === 2 ? 5 : 4, i * 7 + 1));
const base: Omit<EntreePlanMultiSources, 'cible'> = {
  rushes: R.map((u, i) => ({ url: u, secondes: i === 2 ? 5 : 4 })),
  analyses, stockVideos: [{ url: SV, secondes: 6 }],
};

function verifierPropres(plan: ReturnType<typeof planMultiSources>['plan']) {
  const rushs = plan.filter((s) => s.source === 'rush');
  expect(rushs.length).toBeGreaterThan(0);
  for (const s of rushs) {
    const a = analyses.find((x) => x.url === s.url)!;
    const depuis = s.depuis ?? 0;
    const fin = depuis + (s.fin - s.debut);
    expect(plansPropres(a).some(([x, y]) => depuis >= x - 1e-6 && fin <= y + 1e-6), `${s.url} ${depuis}–${fin}`).toBe(true);
  }
}

describe('Autopilote — extraits de rushes dans les plans propres', () => {
  it('la tête figée est bien écartée des plans propres', () => {
    expect(plansPropres(analyses[0])).toEqual([[0.5, 4]]);
  });
  it('sans avatar, sans gabarit', () => {
    verifierPropres(planMultiSources({ ...base, cible: 10 }).plan);
  });
  it('sans avatar, avec gabarit (réserve de rushes)', () => {
    const gabarit = Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, type: (i === 3 ? 'stock' : 'rush') as 'rush' | 'stock' }));
    verifierPropres(planMultiSources({ ...base, cible: 10, gabarit }).plan);
  });
  it('avec avatar (plans de coupe et clôture)', () => {
    verifierPropres(planMultiSources({ ...base, cible: 0, avatar: { url: AV, secondes: 20 } }).plan);
  });
  it('éteint explicitement : sélection d’avant (rétro-compatibilité)', () => {
    const r = planMultiSources({ ...base, cible: 10, options: { uniciteParTimecode: false } });
    expect(r.plan.length).toBeGreaterThan(0);
  });
});
