/**
 * SMART MONTAGE V1 — plan de montage à partir de 2 rushes (analyses
 * synthétiques, ≥ 10 s chacun). Exigences du test minimum :
 *  - plusieurs extraits découpés, jamais rush 1 entier puis rush 2 entier ;
 *  - au moins un cut interne dans un rush ;
 *  - alternance des rushes, ordre chronologique dans chaque rush ;
 *  - durée totale = durée cible ;
 *  - passages noirs / flous / statiques écartés.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planMontage, candidatsDuRush, ajusterPlan, dureeCibleMontage, cleMontage, dureePlan,
  type AnalyseRush, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { estPlanMontage, rushsDuPlan, rushSegmentsDepuisMetadata, planRushs } from '@/lib/creer/multi-rush';

const PAS = 0.5;
/** Rush synthétique : `profil(t)` donne les mesures de chaque instant. */
function rush(url: string, duree: number, profil: (t: number) => Partial<EchantillonRush>): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += PAS) {
    echantillons.push({ t, mouvement: 0.05, luminosite: 0.5, nettete: 0.1, audio: 0.2, ...profil(t) });
  }
  return { url, duree, echantillons };
}

// Rush A (12 s) : 0-3 s noir (raté), 3-7 s actif, 7-12 s statique.
const A = rush('A.mp4', 12, (t) => (t < 3 ? { luminosite: 0.02, mouvement: 0 } : t < 7 ? { mouvement: 0.2, audio: 0.6 } : { mouvement: 0.001 }));
// Rush B (14 s) : 2-5 s bon, 5-9 s flou, 9-13 s très bon.
const B = rush('B.mp4', 14, (t) => (t >= 5 && t < 9 ? { nettete: 0.005 } : (t >= 2 && t < 5) || (t >= 9 && t < 13) ? { mouvement: 0.25, audio: 0.7 } : {}));

describe('candidats et score', () => {
  it('écarte les passages noirs et flous', () => {
    const ca = candidatsDuRush(A, 2);
    expect(ca.every((c) => c.depuis >= 3 - 1e-6)).toBe(true); // 0-3 s noir rejeté
    const cb = candidatsDuRush(B, 2);
    expect(cb.some((c) => c.depuis >= 5 && c.jusqua <= 9)).toBe(false); // 5-9 s flou rejeté
  });

  it('le passage actif bat le passage statique', () => {
    const ca = candidatsDuRush(A, 2).sort((x, y) => y.score - x.score);
    expect(ca[0].depuis).toBeGreaterThanOrEqual(3);
    expect(ca[0].jusqua).toBeLessThanOrEqual(7.01);
  });
});

describe('planMontage — 2 rushes, vrai montage', () => {
  const cible = 12;
  const plan = planMontage([A, B], cible)!;

  it('produit un plan de plusieurs extraits', () => {
    expect(plan).not.toBeNull();
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(estPlanMontage(plan)).toBe(true);
  });

  it("n'enchaîne pas simplement rush 1 entier puis rush 2 entier", () => {
    for (const s of plan) {
      const r = s.url === 'A.mp4' ? A : B;
      expect(s.fin - s.debut).toBeLessThan(r.duree);
    }
    const urls = plan.map((s) => s.url);
    expect(urls.join(',')).not.toBe([...urls].sort().join(','));
  });

  it('contient au moins un cut interne dans un rush', () => {
    const parRush = (u: string) => plan.filter((s) => s.url === u);
    expect(parRush('A.mp4').length >= 2 || parRush('B.mp4').length >= 2).toBe(true);
  });

  it('V3 : les deux rushes sont montés ; l ordre suit la narration (phases)', () => {
    // V3 monte par phases (HOOK → CTA) : l'ordre suit la narration, plus la
    // chronologie du rush ; la qualité prime sur l'alternance stricte. Trois
    // plans de suite d'un même rush ne sont permis que si l'autre est épuisé
    // (ici B, dont 5–9 s est flou).
    expect(new Set(plan.map((s) => s.url)).size).toBe(2);
    expect(plan[0].phase).toBe('HOOK');
  });

  it('ne dépasse jamais la durée cible, extraits contigus (V2 : unicité avant remplissage)', () => {
    expect(plan[0].debut).toBe(0);
    const fin = plan[plan.length - 1].fin;
    expect(fin).toBeLessThanOrEqual(cible + 1e-6);
    expect(fin).toBeGreaterThanOrEqual(8);
    plan.slice(1).forEach((s, i) => expect(s.debut).toBeCloseTo(plan[i].fin, 3));
  });

  it('les extraits d un même rush ne se chevauchent pas', () => {
    for (const u of ['A.mp4', 'B.mp4']) {
      const l = plan.filter((s) => s.url === u).map((s) => [s.depuis ?? 0, (s.depuis ?? 0) + s.fin - s.debut]).sort((x, y) => x[0] - y[0]);
      l.slice(1).forEach((x, i) => expect(x[0]).toBeGreaterThanOrEqual(l[i][1] - 1e-6));
    }
  });

  it('écarte les passages ratés de A (noir 0-3 s)', () => {
    plan.filter((s) => s.url === 'A.mp4').forEach((s) => expect(s.depuis ?? 0).toBeGreaterThanOrEqual(3 - 1e-6));
  });
});

describe('repli et compatibilité', () => {
  it('un seul rush fourni : null (enchaînement classique) ; un rush inutilisable : montage du rush valable SEUL', () => {
    expect(planMontage([A], 10)).toBeNull();
    // #496 : avant, le rush noir faisait renvoyer null — et l'enchaînement
    // brut montrait alors l'écran noir. Désormais : le rush valable seul.
    const noir = rush('N.mp4', 10, () => ({ luminosite: 0.01 }));
    const p = planMontage([A, noir], 10)!;
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.every((s) => s.url === A.url)).toBe(true);
  });

  it('matière insuffisante : montage plus court, extraits jamais rallongés', () => {
    const court1 = rush('C1.mp4', 6, () => ({ mouvement: 0.2 }));
    const court2 = rush('C2.mp4', 6, () => ({ mouvement: 0.2 }));
    const p = planMontage([court1, court2], 30)!;
    expect(dureePlan(p)).toBeLessThanOrEqual(12);
    expect(dureePlan(p)).toBeGreaterThan(6);
    const L = 4; // longueur d'extrait pour une cible de 30 s
    p.forEach((s) => expect(s.fin - s.debut).toBeLessThanOrEqual(L + 1e-6));
  });

  it('suit la cible utilisateur quand la matière suffit (15 s, 30 s, 45 s)', () => {
    const long1 = rush('L1.mp4', 45, (t) => ({ mouvement: 0.1 + (t % 7) / 50 }));
    const long2 = rush('L2.mp4', 45, (t) => ({ mouvement: 0.1 + (t % 5) / 40 }));
    for (const cible of [15, 30, 45]) {
      const d = dureePlan(planMontage([long1, long2], cible)!);
      expect(d).toBeLessThanOrEqual(cible + 1e-6);
      expect(d).toBeGreaterThanOrEqual(cible - 2);
    }
  });

  it('un enchaînement classique n est pas un plan de montage', () => {
    expect(estPlanMontage(planRushs([{ url: 'a', secondes: 5 }, { url: 'b', secondes: 5 }], 10))).toBe(false);
  });

  it('metadata : depuis/score relus, rushes sans doublon', () => {
    const lus = rushSegmentsDepuisMetadata([
      { url: 'a', debut: 0, fin: 2, depuis: 3, score: 0.8 },
      { url: 'b', debut: 2, fin: 4, depuis: 1 },
      { url: 'a', debut: 4, fin: 6, depuis: 8 },
    ])!;
    expect(lus[0]).toEqual({ url: 'a', debut: 0, fin: 2, depuis: 3, score: 0.8 });
    expect(estPlanMontage(lus)).toBe(true);
    expect(rushsDuPlan(lus).map((r) => r.url)).toEqual(['a', 'b']);
    // Ancien format (sans depuis) : relu à l'identique.
    expect(rushSegmentsDepuisMetadata([{ url: 'a', debut: 0, fin: 5 }, { url: 'b', debut: 5, fin: 9 }]))
      .toEqual([{ url: 'a', debut: 0, fin: 5 }, { url: 'b', debut: 5, fin: 9 }]);
  });

  it('ajusterPlan garde les points d entrée et n étire jamais (V2)', () => {
    const plus = ajusterPlan([{ url: 'a', debut: 0, fin: 5, depuis: 2 }, { url: 'b', debut: 5, fin: 10, depuis: 4 }], 20);
    expect(plus).toEqual([{ url: 'a', debut: 0, fin: 5, depuis: 2 }, { url: 'b', debut: 5, fin: 20, depuis: 4 }]);
    const moins = ajusterPlan([{ url: 'a', debut: 0, fin: 5, depuis: 2 }, { url: 'b', debut: 5, fin: 10, depuis: 4 }], 5);
    expect(moins).toEqual([{ url: 'a', debut: 0, fin: 2.5, depuis: 2 }, { url: 'b', debut: 2.5, fin: 5, depuis: 4 }]);
  });

  it('durée par défaut plafonnée, empreinte stable', () => {
    // 30 s par défaut (Reel), jamais plus que la matière disponible.
    expect(dureeCibleMontage(90)).toBe(30);
    expect(dureeCibleMontage(22)).toBe(22);
    expect(cleMontage(['a', 'b'], 12)).toBe('a|b@12');
  });
});

describe('câblage des rendus', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');

  it('compositeur : un extrait joue depuis son point d entrée, cut interne repositionné', () => {
    const c = src('src/lib/video-composer.ts');
    expect(c).toContain('montage?: ReadonlyArray<RushSegment> | null;');
    expect(c).toContain('el.currentTime = actif.depuis + (t - (vs + actif.debut)) * vitesse;');
    expect(c).toContain('if (el.paused || k !== extraitCourant) {');
  });

  it('Remotion : trimBefore sur le point d entrée', () => {
    const r = src('remotion/CreerSimpleMontage.tsx');
    expect(r).toContain('trimBefore: Math.round(seg.depuis * fps)');
    expect(r).toContain('ajusterPlan(montage, dureeVideo)');
  });

  it('Calendrier / régénération : le plan part en `montage`', () => {
    const o = src('src/lib/rendus/options-depuis-metadata.ts');
    expect(o).toContain('montage: rushSegmentsDepuisMetadata(meta.rushSegments)!');
  });

  it('Créer : repli sur montage simple TOUJOURS affiché, séquence raccourcie si peu de matière', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain("setMontageNotice('Analyse intelligente indisponible — montage simple utilisé (rushes enchaînés).');");
    expect(w).toContain('{montageNotice && (');
    expect(w).toContain('plateau = { ...plateau, videoDuration: dureePlan(planMontageRushs) };');
  });

  it('Créer : analyse avant rendu, plan persisté dans rushSegments', () => {
    const w = src('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(w).toContain("setRenderStage('Analyse des rushes…');");
    expect(w).toContain("? planMontageRushs ?? planRushs(rushsDurables, duree('video'))");
    expect(w).toContain('...(duree(\'video\') > 0 && planMontageRushs ? { montage: planMontageRushs } : {}),');
  });
});
