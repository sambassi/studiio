/**
 * Créer — fonds en mouvement Titre / CTA : plusieurs passages propres ENCHAÎNÉS.
 *
 * Démo « LE SPORT » (analyses du banc) : Titre de 6 s sur le 1er plan propre
 * du rush 1 (3,5 s) → le fond rebouclait à 3,5 s (même plan revu) ; CTA de
 * 4,5 s sur 4 s propres du rush 3 → rebouclage 0,25 s avant la dernière image.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from '@/__tests__/fixtures/demo-sport-analyses.json';
import { plansPropres, type AnalyseRush } from '@/lib/creer/smart-montage';
import { fondsRushTexte, SEGMENT_FOND_MIN_S, type SegmentFond } from '@/lib/creer/fond-rush-texte';

const analyses = fixture.analyses as unknown as AnalyseRush[];
const [R1, R2, R3] = analyses.map((a) => a.url);
const propres = Object.fromEntries(analyses.map((a) => [a.url, plansPropres(a)] as const));
const rushs = analyses.map((a) => ({ url: a.url, secondes: a.duree }));
const L = (s: SegmentFond) => s.jusqua - s.depuis;
const total = (s: SegmentFond[]) => s.reduce((t, x) => t + L(x), 0);
const chevauche = (a: SegmentFond, b: SegmentFond) => a.url === b.url && a.depuis < b.jusqua - 1e-6 && a.jusqua > b.depuis + 1e-6;
const dansPropre = (s: SegmentFond) => (propres[s.url] ?? []).some(([x, y]) => s.depuis >= x - 1e-6 && s.jusqua <= y + 1e-6);

describe('fond d’ouverture / CTA : passages propres enchaînés', () => {
  const f = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, dureeIntro: 6, plansPropres: propres })!;

  it('Titre 6 s : le plan propre du rush 1 PUIS un autre rush, sans reboucler (couvre la séquence)', () => {
    expect(f.intro!.segments).toEqual([
      // Plages qui vont au bout du fichier : arrêtées une image avant (comme le lecteur du compositeur).
      { url: R1, depuis: 0.5, jusqua: 3.95 },
      { url: R2, depuis: 0.5, jusqua: 3.15 },
    ]);
    expect(total(f.intro!.segments!)).toBeGreaterThanOrEqual(6);
    // Premier passage montré = champs historiques (aperçu, plan Vidéo, cartes).
    expect([f.intro!.url, f.intro!.depuis, f.intro!.jusqua]).toEqual([R1, 0.5, 3.95]);
  });

  it('CTA 4,5 s : finit sur la fin du dernier rush, matière neuve (pas celle du Titre), durée exacte', () => {
    const s = f.cta!.segments!;
    expect(s.at(-1)).toEqual({ url: R3, depuis: 1.25, jusqua: 4.95 });
    expect(total(s)).toBeCloseTo(4.5, 6);
    for (const x of s) for (const y of f.intro!.segments!) expect(chevauche(x, y), `${x.url}@${x.depuis}`).toBe(false);
    expect([f.cta!.url, f.cta!.depuis]).toEqual([s[0].url, s[0].depuis]);
  });

  it('chaque passage : dans un plan propre, jamais plus court que le minimum, jamais deux fois le même', () => {
    for (const c of [f.intro!.segments!, f.cta!.segments!]) {
      for (const s of c) { expect(dansPropre(s)).toBe(true); expect(L(s)).toBeGreaterThanOrEqual(SEGMENT_FOND_MIN_S - 1e-6); }
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(chevauche(c[i], c[j])).toBe(false);
    }
  });

  it('Default safe : un seul rush, sans durée du Titre, sans mesures, ou base suffisante → comportement d’avant', () => {
    const seul = fondsRushTexte({ lisible: true, affiche: false, rushs: [rushs[0]], dureeCta: 4.5, dureeIntro: 6, plansPropres: propres })!;
    expect(seul.intro).toEqual({ url: R1, depuis: 0.5, jusqua: 4 });
    expect(seul.cta).toEqual({ url: R1, depuis: 0.5, jusqua: 4 });
    const sansDuree = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, plansPropres: propres })!;
    expect(sansDuree.intro).toEqual({ url: R1, depuis: 0.5, jusqua: 4 });
    expect(fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, dureeIntro: 6 })).toEqual({
      intro: { url: R1, depuis: 0 }, cta: { url: R3, depuis: 0.5 },
    });
    const court = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 3, dureeIntro: 3, plansPropres: propres })!;
    expect(court.intro!.segments).toBeUndefined();
    expect(court.cta).toEqual({ url: R3, depuis: 2, jusqua: 5 });
  });

  it('matière insuffisante : tout est enchaîné une fois (rejoué ensuite par le lecteur), rien n’est inventé', () => {
    const g = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, dureeIntro: 30, plansPropres: propres })!;
    const s = g.intro!.segments!;
    expect(new Set(s.map((x) => x.url))).toEqual(new Set([R1, R2, R3]));
    expect(total(s)).toBeLessThan(30);
  });

  it('parité : aperçu et export passent la même durée du Titre ; le compositeur et l’aperçu jouent les segments', () => {
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(w).toMatch(/dureeIntro: introDuration,/);
    expect(w).toContain('fond.segments');
    const c = readFileSync(resolve(process.cwd(), 'src/lib/video-composer.ts'), 'utf8');
    expect(c).toContain('f.segments');
  });
});
