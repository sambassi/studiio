/**
 * Régression réelle staging 30/09 16:00 (post fc8aaf68) : MP4 de 5,85 s,
 * A → B → A → B. Le plan STOCKÉ avait déjà 4 extraits / 5,808 s : la durée
 * ne se perdait PAS au rendu. L'analyse du rush `lv_0` (4K, 234 Mo) dépassait
 * son délai (lu par l'adresse publique) → plan bâti sur deux rushes de 8 s.
 *
 * Ce test verrouille la CHAÎNE : plan → surimpressions → design → entrée de
 * rendu → composition Remotion, et le repli d'un rush non mesuré.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { planMontage, ajusterPlan, dureePlan, cleSource, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';
import { planOverlays } from '@/lib/creer/overlays';
import { analyseNeutre, objetDeUrlPublique } from '@/lib/creer/analyse-rush-serveur';
import { planFromProps } from '../../remotion/CreerSimpleMontage';
import { totalDurationFrames } from '@/lib/creer/designSpec';

function rush(url: string, duree: number, graine: number): AnalyseRush {
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

const B = 'https://staging.studiio.pro/storage/v1/object/public/media/u/library/';
const HOMME = rush(`${B}13_homme.mp4`, 8, 3);
const COUPLE = rush(`${B}05_couple.mp4`, 8, 11);
const LV0 = rush(`${B}lv_0.mp4`, 41.6, 29);
const CTX = { theme: 'danse', objectif: 'remplir mes cours bonne ambiance' };
const forts = Array.from({ length: 80 }, (_, i) => Math.round(i * 0.441 * 1000) / 1000);

describe('la chaîne ne perd ni durée ni extrait', () => {
  const plan = planMontage([HOMME, LV0, COUPLE], 30, { contexte: CTX, rythme: { beats: forts, forts, drop: null } })!;
  const duree = dureePlan(plan);

  it('plan : 12–20 extraits, 3 rushes, ~20–30 s', () => {
    expect(plan.length).toBeGreaterThanOrEqual(12);
    expect(new Set(plan.map((s) => cleSource(s.url))).size).toBe(3);
    expect(duree).toBeGreaterThan(18);
  });

  it('surimpressions + durées titre/cartes/CTA à 0 : la séquence vidéo garde TOUTE la durée', () => {
    const surimpressions = planOverlays({ duree, nbCartes: 5, finHook: plan[1].fin });
    const props = {
      title: 'DANSE', cards: Array.from({ length: 5 }, () => ({ title: 'x', value: '1' })),
      videoUrl: plan[0].url, montage: plan, surimpressions,
      introDuration: 0, cardsDuration: 0, ctaDuration: 0, videoDuration: duree,
    };
    const sequences = planFromProps(props as never);
    expect(sequences).toEqual([{ type: 'video', duration: duree }]);
    // calculateMetadata (remotion/index.tsx) : même calcul.
    expect(totalDurationFrames(sequences, 30)).toBe(Math.round(duree * 30));
  });

  it('au rendu : ajusterPlan garde les 18 extraits, sans remapper une plage source', () => {
    const rendu = ajusterPlan(plan, duree);
    expect(rendu.length).toBe(plan.length);
    rendu.forEach((s, i) => {
      expect(s.depuis).toBe(plan[i].depuis);
      expect(s.url).toBe(plan[i].url);
    });
  });

  it('aucune plage source réutilisée', () => {
    const p = plan.map((s) => ({ c: cleSource(s.url), a: s.depuis ?? 0, b: s.jusqua ?? 0 }));
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        if (p[i].c === p[j].c) expect(p[i].b <= p[j].a || p[j].b <= p[i].a).toBe(true);
      }
    }
  });
});

describe('rush dont la mesure échoue : il reste montable', () => {
  it('sans lv_0 : le plan s effondre (la régression reproduite)', () => {
    const p = planMontage([HOMME, COUPLE], 16, { contexte: CTX })!;
    expect(dureePlan(p)).toBeLessThan(12);
  });

  it('avec lv_0 en mesures neutres : beaucoup plus de matière, 3 rushes', () => {
    const p = planMontage([HOMME, analyseNeutre(LV0.url, 41.6), COUPLE], 30, { contexte: CTX })!;
    expect(dureePlan(p)).toBeGreaterThan(18);
    expect(new Set(p.map((s) => cleSource(s.url))).size).toBe(3);
  });

  it('analyse lue en INTERNE : l URL publique donne le bucket et la clé', () => {
    expect(objetDeUrlPublique(`${B}lv_0.mp4`)).toEqual({ bucket: 'media', cle: 'u/library/lv_0.mp4' });
    expect(objetDeUrlPublique('https://cdn.example.com/x.mp4')).toBeNull();
  });

  it('câblage : ffmpeg lit l URL interne ; la production garde le rush non mesuré', () => {
    const a = readFileSync(resolve(process.cwd(), 'src/lib/creer/analyse-rush-serveur.ts'), 'utf-8');
    expect(a).toContain("'-t', String(duree), '-i', source,");
    expect(a).toContain('const source = await urlDeLecture(url);');
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain('if (s && s >= 1) analysesRushs.push(analyseNeutre(u, s));');
  });
});
