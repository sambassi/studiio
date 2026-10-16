/**
 * M1 suite — NETTETÉ QUALITÉ (320×320) : le flou se détecte dès boxblur 8.
 *
 * Fixtures = mesures RÉELLES de la chaîne serveur (`mesurerSourceLue`, 16/10)
 * sur les 6 rushes réels, leurs versions floutées (boxblur 4/8/10/25, plan
 * détaillé 8955360 et scène simple 34521342) et les cas QA (nuit, plage,
 * interview). Tuple : [durée, luminance, netteté 64×36, mouvement des images
 * mobiles, part figée, contraste, finesse HD, détail HD].
 */
import { describe, it, expect } from 'vitest';
import { evaluerQualiteRushs, SEUILS_QUALITE } from '@/lib/creer/qualite-rushs';
import { mesurerNetteteHD, agregerNetteteHD, HD_L, HD_H, type AnalyseRushQualite } from '@/lib/creer/nettete-hd';
import type { EchantillonRush } from '@/lib/creer/smart-montage';

const M: Record<string, [number, number, number, number, number, number, number, number]> = {"converted_1791985445290":[32.02,0.358,0.1279,0.0588,0.35,0.705,0.618,0.0216],
"converted_1792081208949":[53.63,0.212,0.2355,0.0148,0.86,0.437,0.778,0.0813],
"stock-pexels-video-34521342":[12.01,0.457,0.1214,0.0502,0,0.67,0.614,0.0199],
"stock-pexels-video-35532643":[14.01,0.695,0.0703,0.0197,0,0.881,0.75,0.0192],
"stock-pexels-video-7815139":[5.77,0.426,0.2712,0.0823,0,0.646,0.737,0.074],
"stock-pexels-video-8955360":[8.52,0.482,0.3001,0.1632,0,0.637,0.608,0.0577],
"synth-nuit-contrastee":[12,0.05,0.0664,0.0536,0.65,0.151,0.851,0.0187],
"flou-34521342-10x2":[8.01,0.441,0.0913,0.0462,0,0.667,0.416,0.0059],
"flou-34521342-25x3":[8.01,0.441,0.056,0.0371,0,0.659,0.759,0.0038],
"flou-34521342-4x1":[8.01,0.441,0.1108,0.0498,0,0.673,0.464,0.013],
"flou-34521342-8x1":[8.01,0.441,0.102,0.0483,0,0.67,0.406,0.0083],
"flou-8955360-10x2":[8,0.483,0.1902,0.0598,0,0.604,0.334,0.0102],
"flou-8955360-25x3":[8,0.482,0.0883,0.0394,0,0.589,0.602,0.0046],
"flou-8955360-4x1":[8,0.485,0.2684,0.073,0,0.623,0.449,0.0343],
"flou-8955360-8x1":[8,0.484,0.2346,0.0676,0,0.616,0.363,0.0186],
"flou-rush1-8x1":[8,0.42,0.1247,0.0895,0,0.971,0.38,0.0101],
"qa-interview-quasi-fixe":[8.56,0.471,0.2848,0.0042,0,0.636,0.597,0.056],
"qa-nuit-rue-lampes":[5.77,0.026,0.0468,0.0026,0.27,0.251,0.579,0.0062],
"qa-nuit-tres-sombre-lampe":[8.52,0.025,0.0304,0,1,0.941,0.46,0.0027],
"qa-nuit-zone-lumineuse":[12,0.051,0.072,0.0185,0.74,0.687,0.657,0.0114],
"qa-plage-forte":[12.01,0.823,0.0744,0.0297,0,0.396,0.586,0.0109],
"qa-plage-surexposee":[14.01,0.839,0.052,0.0146,0,0.646,0.743,0.0144]};

function rush(id: string): AnalyseRushQualite {
  const [duree, lum, net, mouv, fige, contr, finesse, detail] = M[id];
  const echantillons: EchantillonRush[] = [];
  const n = Math.max(3, Math.floor(duree / 0.5));
  for (let i = 0; i < n; i++) {
    const figee = i / n < fige;
    echantillons.push({
      t: i * 0.5, mouvement: i === 0 || figee ? 0 : mouv, luminosite: lum, nettete: net, audio: 0.2,
      empreinte: Array.from({ length: 64 }, (_, k) => Math.max(0, lum - contr / 2) + contr * (((k * 17 + i) % 97) / 96)),
    });
  }
  return { url: `https://studiio.pro/storage/v1/object/public/media/u1/${id}.mp4`, duree, echantillons, netteteHD: { finesse, detail, images: 8 } };
}
const REELS = ['converted_1791985445290', 'converted_1792081208949', 'stock-pexels-video-34521342', 'stock-pexels-video-35532643', 'stock-pexels-video-7815139', 'stock-pexels-video-8955360'];
const avecReels = (id: string) => evaluerQualiteRushs([...REELS.map(rush), rush(id)]).rushs.find((q) => q.url.includes(`/${id}.mp4`))!;
const seul = (id: string) => evaluerQualiteRushs([rush(id)]).rushs[0];

describe('6 rushes réels : ok, ensemble et seuls', () => {
  it('aucun motif', () => {
    expect(evaluerQualiteRushs(REELS.map(rush)).rushs.map((q) => q.verdict)).toEqual(Array(6).fill('ok'));
    for (const id of REELS) expect(seul(id).verdict).toBe('ok');
  });
});

describe('flou boxblur 4 / 8 / 10 / 25 — plan détaillé et scène simple', () => {
  const PLANS = ['8955360', '34521342'];
  it.each(PLANS)('plan %s : boxblur ≥ 8 signalé « flou », avec les réels et seul', (p) => {
    for (const b of ['8x1', '10x2', '25x3']) {
      for (const q of [avecReels(`flou-${p}-${b}`), seul(`flou-${p}-${b}`)]) {
        expect(q.verdict).not.toBe('ok');
        expect(q.motifs.some((m) => m.code === 'flou')).toBe(true);
      }
    }
  });
  it('boxblur 4 (léger) : déjà signalé sur ces deux plans', () => {
    for (const p of PLANS) expect(avecReels(`flou-${p}-4x1`).motifs.some((m) => m.code === 'flou')).toBe(true);
  });
  it('rush utilisateur réel flouté (boxblur 8) : signalé', () => {
    expect(avecReels('flou-rush1-8x1').motifs[0]).toMatchObject({ code: 'flou' });
    expect(avecReels('flou-rush1-8x1').motifs[0].texte).toMatch(/^flou : finesse 0,38 < 0,55 \(détail fin 0,01/);
  });
  it('flou fort SANS mouvement : inutilisable ; AVEC mouvement : à vérifier (protection filé)', () => {
    const fixe = rush('flou-34521342-25x3');
    fixe.echantillons.forEach((e) => { e.mouvement = 0.0005; });
    const q = evaluerQualiteRushs([...REELS.map(rush), fixe]).rushs.at(-1)!;
    expect(q.verdict).toBe('inutilisable');
    const bouge = avecReels('flou-34521342-25x3');
    expect(bouge.verdict).toBe('a_verifier');
    expect(bouge.protections.join(' ')).toMatch(/filé/);
  });
});

describe('jamais inutilisables : nuit, plage, interview', () => {
  it.each(['qa-nuit-rue-lampes', 'qa-nuit-tres-sombre-lampe', 'qa-nuit-zone-lumineuse', 'synth-nuit-contrastee', 'qa-plage-forte', 'qa-plage-surexposee', 'qa-interview-quasi-fixe'])('%s', (id) => {
    expect(avecReels(id).verdict).not.toBe('inutilisable');
    expect(seul(id).verdict).not.toBe('inutilisable');
  });
  it('plage et interview : ok (aucun faux flou)', () => {
    for (const id of ['qa-plage-forte', 'qa-plage-surexposee', 'qa-interview-quasi-fixe']) expect(avecReels(id).verdict).toBe('ok');
  });
  it('nuit : jamais « 0 s utiles » (la durée d’une scène sombre n’est pas comptée en images noires)', () => {
    for (const id of ['qa-nuit-rue-lampes', 'qa-nuit-tres-sombre-lampe', 'qa-nuit-zone-lumineuse']) {
      expect(avecReels(id).motifs.map((m) => m.texte).join(' ')).not.toMatch(/s utiles/);
      expect(avecReels(id).motifs.some((m) => m.code === 'trop_court')).toBe(false);
    }
  });
});

describe('mesure HD pure', () => {
  // Texture fine (damier 2 px + bruit fixe), floutée par moyenne glissante.
  const texture = () => {
    const g = new Float32Array(HD_L * HD_H);
    for (let y = 0; y < HD_H; y++) for (let x = 0; x < HD_L; x++) g[y * HD_L + x] = 0.3 + 0.4 * (((x >> 1) + (y >> 1)) % 2) * (0.6 + 0.4 * Math.sin(x * 0.07 + y * 0.03));
    return g;
  };
  const flouter = (g: Float32Array, r: number) => {
    const t = new Float32Array(g.length); const o = new Float32Array(g.length);
    for (let y = 0; y < HD_H; y++) for (let x = 0; x < HD_L; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < HD_L) { s += g[y * HD_L + xx]; n++; } } t[y * HD_L + x] = s / n; }
    for (let y = 0; y < HD_H; y++) for (let x = 0; x < HD_L; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < HD_H) { s += t[yy * HD_L + x]; n++; } } o[y * HD_L + x] = s / n; }
    return o;
  };
  it('le flou fait chuter finesse et détail ; une image uniforme vaut finesse 1, détail 0', () => {
    const net = mesurerNetteteHD(texture());
    const flou = mesurerNetteteHD(flouter(texture(), 1));
    expect(flou.finesse).toBeLessThan(net.finesse);
    expect(flou.detail).toBeLessThan(net.detail);
    expect(mesurerNetteteHD(new Float32Array(HD_L * HD_H).fill(0.5))).toEqual({ detail: 0, finesse: 1 });
    expect(agregerNetteteHD([])).toBeNull();
    expect(agregerNetteteHD([{ finesse: 0.5, detail: 0.01 }, { finesse: 0.7, detail: 0.03 }, { finesse: 0.6, detail: 0.02 }])).toEqual({ finesse: 0.6, detail: 0.02, images: 3 });
  });
  it('seuils documentés', () => {
    expect(SEUILS_QUALITE.finesseFlou).toBe(0.55);
    expect(SEUILS_QUALITE.detailPlancher).toBe(0.008);
  });
});
