/**
 * PLAN MULTI-SOURCES — l'orchestrateur pur (`plan-multi-sources.ts`).
 *
 * Verrouille la règle produit : sources INDÉPENDANTES et COMBINABLES, les
 * sept combinaisons rendent un plan, priorités gabarit > avatar > rushes >
 * stock, stock en COMPLÉMENT, invariant lip-sync de l'avatar, durées exactes,
 * aucun média répété.
 */
import { describe, it, expect } from 'vitest';
import {
  planMultiSources, avatarSynchronise, MOUVEMENTS_PHOTO, type EntreePlanMultiSources,
} from '@/lib/autopilot/plan-multi-sources';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';
import type { RushSegment } from '@/lib/creer/multi-rush';

const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';
const R1 = 'https://minio.test/storage/v1/object/public/media/u1/rush-a.mp4';
const R2 = 'https://minio.test/storage/v1/object/public/media/u1/rush-b.mp4';
const SV1 = 'https://minio.test/storage/v1/object/public/media/u1/stock-pexels-video-111.mp4';
const SV2 = 'https://minio.test/storage/v1/object/public/media/u1/stock-pexels-video-222.mp4';
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const P2 = 'https://images.unsplash.com/photo-2?w=1080';
const P3 = 'https://images.unsplash.com/photo-3?w=1080';

function analyse(url: string, duree: number, graine: number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const g = graine + Math.floor(t * 2) * 13;
    echantillons.push({
      t, mouvement: 0.06 + ((t * 7 + graine) % 5) / 40, luminosite: 0.5, nettete: 0.1, audio: 0.4,
      empreinte: Array.from({ length: 64 }, (_, i) => ((g * 31 + i * 17) % 97) / 97),
    });
  }
  return { url, duree, echantillons };
}

/** Plan contigu, de 0 à `duree`, sans trou ni chevauchement. */
function verifierContigu(plan: RushSegment[], duree: number) {
  expect(plan.length).toBeGreaterThan(0);
  expect(plan[0].debut).toBe(0);
  for (let i = 1; i < plan.length; i++) expect(plan[i].debut).toBeCloseTo(plan[i - 1].fin, 6);
  plan.forEach((s) => expect(s.fin).toBeGreaterThan(s.debut));
  expect(plan[plan.length - 1].fin).toBeCloseTo(duree, 6);
}

/** Aucun média stock/photo repris deux fois ; aucune plage de rush rejouée. */
function verifierSansDoublon(plan: RushSegment[]) {
  const stock = plan.filter((s) => s.source === 'stock' || s.kind === 'image').map((s) => s.url);
  expect(new Set(stock).size).toBe(stock.length);
  const rush = plan.filter((s) => s.source === 'rush');
  for (let i = 0; i < rush.length; i++) {
    for (let j = i + 1; j < rush.length; j++) {
      if (rush[i].url !== rush[j].url) continue;
      const a = [rush[i].depuis ?? 0, rush[i].jusqua ?? (rush[i].depuis ?? 0) + (rush[i].fin - rush[i].debut)];
      const b = [rush[j].depuis ?? 0, rush[j].jusqua ?? (rush[j].depuis ?? 0) + (rush[j].fin - rush[j].debut)];
      expect(a[1] <= b[0] + 1e-6 || b[1] <= a[0] + 1e-6).toBe(true);
    }
  }
}

const base = (p: Partial<EntreePlanMultiSources>): EntreePlanMultiSources => ({ cible: 20, ...p });

describe('planMultiSources — les sept combinaisons rendent un plan', () => {
  it('1. rushes seuls (sans analyse) : enchaînement des rushes, cible atteinte', () => {
    const r = planMultiSources(base({ rushes: [{ url: R1, secondes: 12 }, { url: R2, secondes: 15 }], cible: 20 }));
    verifierContigu(r.plan, 20);
    expect(r.plan.every((s) => s.source === 'rush' && s.kind === 'video')).toBe(true);
    expect(r.plan.map((s) => s.url)).toEqual([R1, R2]);
  });

  it('1b. rushes seuls (analysés) : le smart montage de Créer choisit les extraits', () => {
    const r = planMultiSources(base({ rushes: [{ url: R1, secondes: 30 }, { url: R2, secondes: 30 }], analyses: [analyse(R1, 30, 3), analyse(R2, 30, 11)], cible: 20 }));
    expect(r.plan.length).toBeGreaterThanOrEqual(4);
    expect(r.plan.every((s) => s.source === 'rush')).toBe(true);
    verifierSansDoublon(r.plan);
  });

  it('2. avatar seul : un seul plan, toute la parole, synchronisé', () => {
    const r = planMultiSources(base({ avatar: { url: AV, secondes: 17.4 } }));
    expect(r.plan).toEqual([{ url: AV, debut: 0, fin: 17.4, depuis: 0, kind: 'avatar', source: 'jumeau', raison: 'avatar (parole entière)' }]);
    expect(avatarSynchronise(r.plan)).toBe(true);
  });

  it('3. avatar + stock (0 rush) : avatar en ouverture et en fin, stock entre deux', () => {
    const r = planMultiSources(base({ avatar: { url: AV, secondes: 24 }, stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], photos: [P1, P2] }));
    verifierContigu(r.plan, 24);
    expect(r.duree).toBe(24);
    expect(r.plan[0].kind).toBe('avatar');
    expect(r.plan.at(-1)!.kind).toBe('avatar');
    expect(r.plan.some((s) => s.source === 'stock')).toBe(true);
    expect(avatarSynchronise(r.plan)).toBe(true);
    verifierSansDoublon(r.plan);
    // Plans de coupe de 2 à 4 s.
    r.plan.filter((s) => s.kind !== 'avatar').forEach((s) => {
      expect(s.fin - s.debut).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(s.fin - s.debut).toBeLessThanOrEqual(4 + 1e-6);
    });
  });

  it('4. rushes + avatar : plans de coupe pris dans les rushes personnels', () => {
    const r = planMultiSources(base({ avatar: { url: AV, secondes: 30 }, rushes: [{ url: R1, secondes: 20 }, { url: R2, secondes: 20 }] }));
    verifierContigu(r.plan, 30);
    const broll = r.plan.filter((s) => s.kind !== 'avatar');
    expect(broll.length).toBeGreaterThanOrEqual(3);
    expect(broll.every((s) => s.source === 'rush')).toBe(true);
    // Alternance des rushes : les deux sont montés.
    expect(new Set(broll.map((s) => s.url))).toEqual(new Set([R1, R2]));
    expect(avatarSynchronise(r.plan)).toBe(true);
    verifierSansDoublon(r.plan);
  });

  it('5. rushes + stock : le stock ne comble QUE ce que les rushes ne couvrent pas', () => {
    const r = planMultiSources(base({ rushes: [{ url: R1, secondes: 8 }], stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1], cible: 18 }));
    verifierContigu(r.plan, 18);
    expect(r.plan[0]).toMatchObject({ url: R1, source: 'rush', debut: 0, fin: 8 });
    expect(r.plan.slice(1).every((s) => s.source === 'stock' || s.kind === 'image')).toBe(true);
    verifierSansDoublon(r.plan);
  });

  it('5b. rushes suffisants + stock : AUCUN média stock (jamais de remplacement silencieux)', () => {
    const r = planMultiSources(base({ rushes: [{ url: R1, secondes: 30 }], stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1], cible: 20 }));
    verifierContigu(r.plan, 20);
    expect(r.plan.every((s) => s.source === 'rush')).toBe(true);
  });

  it('5c. avatar + rushes abondants + stock : le stock n’est pas pris', () => {
    const r = planMultiSources(base({ avatar: { url: AV, secondes: 20 }, rushes: [{ url: R1, secondes: 40 }, { url: R2, secondes: 40 }], stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1] }));
    expect(r.plan.some((s) => s.source === 'stock' || s.kind === 'image')).toBe(false);
  });

  it('6. rushes + avatar + stock : rushes d’abord, puis stock quand la matière manque', () => {
    const r = planMultiSources(base({ avatar: { url: AV, secondes: 40 }, rushes: [{ url: R1, secondes: 3 }], stockVideos: [{ url: SV1, secondes: 6 }], photos: [P1, P2] }));
    verifierContigu(r.plan, 40);
    const broll = r.plan.filter((s) => s.kind !== 'avatar');
    expect(broll[0].source).toBe('rush');
    expect(broll.map((s) => s.source ?? s.kind)).toEqual(['rush', 'stock', 'photo', 'photo']);
    expect(avatarSynchronise(r.plan)).toBe(true);
    verifierSansDoublon(r.plan);
  });

  it('7a. stock seul — vidéos : réparties 2–4 s, cible exacte', () => {
    const r = planMultiSources(base({ stockVideos: [{ url: SV1, secondes: 10 }, { url: SV2, secondes: 10 }], cible: 8 }));
    verifierContigu(r.plan, 8);
    expect(r.plan.map((s) => s.url)).toEqual([SV1, SV2]);
    expect(r.plan.every((s) => s.kind === 'video' && s.source === 'stock')).toBe(true);
  });

  it('7b. stock seul — photos : plans image, mouvements alternés', () => {
    const r = planMultiSources(base({ photos: [P1, P2, P3], cible: 9 }));
    verifierContigu(r.plan, 9);
    expect(r.plan.every((s) => s.kind === 'image')).toBe(true);
    expect(r.plan.map((s) => s.mouvement)).toEqual(MOUVEMENTS_PHOTO.slice(0, 3));
    verifierSansDoublon(r.plan);
  });

  it('7c. stock seul — vidéos ET photos : vidéos d’abord', () => {
    const r = planMultiSources(base({ stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1], cible: 6 }));
    verifierContigu(r.plan, 6);
    expect(r.plan.map((s) => s.kind)).toEqual(['video', 'image']);
  });
});

describe('planMultiSources — gabarit (choix explicites de l’utilisateur)', () => {
  const sources = { avatar: { url: AV, secondes: 20 }, rushes: [{ url: R1, secondes: 20 }], stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1] };

  it('respecte l’ordre et le type de chaque créneau, durées égales, total exact', () => {
    const r = planMultiSources(base({ ...sources, gabarit: [
      { id: 'a', type: 'avatar' }, { id: 'b', type: 'stock' }, { id: 'c', type: 'rush' }, { id: 'd', type: 'avatar' },
    ] }));
    verifierContigu(r.plan, 20);
    expect(r.plan.map((s) => s.kind === 'avatar' ? 'avatar' : s.source)).toEqual(['avatar', 'stock', 'rush', 'avatar']);
    expect(r.plan.map((s) => s.fin)).toEqual([5, 10, 15, 20]);
    expect(avatarSynchronise(r.plan)).toBe(true);
  });

  it('DÉPLACER un créneau déplace son plan (l’ordre du gabarit fait foi)', () => {
    const r = planMultiSources(base({ ...sources, gabarit: [
      { id: 'b', type: 'stock' }, { id: 'a', type: 'avatar' }, { id: 'c', type: 'rush' }, { id: 'd', type: 'avatar' },
    ] }));
    expect(r.plan.map((s) => s.kind === 'avatar' ? 'avatar' : s.source)).toEqual(['stock', 'avatar', 'rush', 'avatar']);
    // L'avatar déplacé reste synchronisé : il joue SA seconde 5 à 5 s.
    expect(r.plan[1]).toMatchObject({ kind: 'avatar', debut: 5, depuis: 5 });
  });

  it('FORCER un média le reprend tel quel, même contre la priorité', () => {
    const r = planMultiSources(base({ ...sources, gabarit: [
      { id: 'a', type: 'auto' }, { id: 'b', type: 'rush', media: P1 }, { id: 'c', type: 'auto' },
    ] }));
    expect(r.plan[1]).toMatchObject({ url: P1, kind: 'image' });
  });

  it('un média forcé INDISPONIBLE retombe sur le type du créneau, et c’est dit', () => {
    const r = planMultiSources(base({ ...sources, gabarit: [
      { id: 'a', type: 'avatar' }, { id: 'b', type: 'stock', media: 'https://images.pexels.com/disparu.jpg' }, { id: 'c', type: 'avatar' },
    ] }));
    expect(r.plan[1].source).toBe('stock');
    expect(r.explications.join(' ')).toMatch(/indisponible/);
  });

  it('créneau « avatar » sans avatar : choix automatique (rush prioritaire sur stock)', () => {
    const r = planMultiSources(base({ rushes: [{ url: R1, secondes: 20 }], stockVideos: [{ url: SV1, secondes: 10 }], cible: 10, gabarit: [
      { id: 'a', type: 'avatar' }, { id: 'b', type: 'auto' },
    ] }));
    verifierContigu(r.plan, 10);
    expect(r.plan.map((s) => s.source)).toEqual(['rush', 'rush']);
    verifierSansDoublon(r.plan);
  });
});

describe('planMultiSources — invariants', () => {
  it('déterministe : mêmes entrées, même plan', () => {
    const e = base({ avatar: { url: AV, secondes: 31.7 }, rushes: [{ url: R1, secondes: 9 }], stockVideos: [{ url: SV1, secondes: 7 }], photos: [P1, P2, P3] });
    expect(planMultiSources(e)).toEqual(planMultiSources(e));
  });

  it('lip-sync : avec avatar, la durée est celle de la parole, chaque extrait d’avatar joue sa propre seconde', () => {
    for (const T of [6, 9.5, 14.2, 23.9, 47.3, 60]) {
      const r = planMultiSources(base({ avatar: { url: AV, secondes: T }, rushes: [{ url: R1, secondes: 12 }], stockVideos: [{ url: SV1, secondes: 5 }], photos: [P1, P2] }));
      verifierContigu(r.plan, T);
      expect(avatarSynchronise(r.plan)).toBe(true);
      r.plan.filter((s) => s.kind === 'avatar').forEach((s) => {
        expect(s.depuis).toBe(s.debut);
        expect(s.vitesse).toBeUndefined();
      });
    }
  });

  it('aucune source : plan vide', () => {
    expect(planMultiSources(base({ cible: 10 })).plan).toEqual([]);
  });
});
