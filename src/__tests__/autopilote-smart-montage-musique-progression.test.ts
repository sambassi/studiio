/**
 * Autopilote — P0 staging (2026-09-30) :
 *  - le MÊME moteur Smart Montage que Créer (planMontage), analyse serveur ;
 *  - la musique choisie à la Médiathèque n'est plus effacée (URL relative) ;
 *  - progression réelle par étapes ;
 *  - upload : morceaux relayés, jamais de renvoi complet en boucle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rushsCompagnons, RUSHS_MONTAGE_MAX } from '@/lib/autopilot/produire';
import { pourcentEtape, noterProgression, lireProgression, effacerProgression } from '@/lib/autopilot/progression';
import { imagesDepuisBrut, energieDepuisPcm } from '@/lib/creer/analyse-rush-serveur';
import { mesurerImage, ANALYSE_L, ANALYSE_H, planMontage, type EchantillonRush } from '@/lib/creer/smart-montage';

const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');

describe('Autopilote : plusieurs rushes réunis', () => {
  it('compagnons : autres rushes de la banque, par rotation, sans doublon', () => {
    const banque = ['a', 'b', 'c', 'd', 'b'];
    expect(rushsCompagnons(banque, 'a', 0, 2)).toEqual(['b', 'c']);
    expect(rushsCompagnons(banque, 'a', 1, 2)).toEqual(['c', 'd']);
    expect(rushsCompagnons(['a'], 'a', 0, 2)).toEqual([]); // un seul rush : mono-rush
    expect(RUSHS_MONTAGE_MAX).toBe(3);
  });

  it('produire : plan du moteur de Créer, passé au rendu et aux métadonnées', () => {
    const p = src('src/lib/autopilot/produire.ts');
    expect(p).toContain("import { planMontage, dureeCibleMontage, dureePlan, type AnalyseRush } from '@/lib/creer/smart-montage';");
    expect(p).toContain('planMontageRushs = planMontage(analyses, dureeCibleMontage(disponible));');
    expect(p).toContain('montage: planMontageRushs,');
    expect(p).toContain("{ rushSegments: planMontageRushs, rushUrls: rushsDuPlan(planMontageRushs).map((r) => r.url) }");
    // Jamais de repli silencieux.
    expect(p).toContain('{ montageSimple: true, montageSimpleMotif }');
  });
});

describe('Analyse serveur = même arithmétique que le navigateur', () => {
  it('images brutes → niveaux de gris, mesures partagées', () => {
    const taille = ANALYSE_L * ANALYSE_H;
    const brut = new Uint8Array(taille * 2);
    brut.fill(0, 0, taille);
    brut.fill(255, taille);
    const [a, b] = imagesDepuisBrut(brut);
    expect(mesurerImage(a, null).luminosite).toBe(0);
    const m = mesurerImage(b, a);
    expect(m.luminosite).toBe(1);
    expect(m.mouvement).toBe(1);
    const nav = src('src/lib/creer/analyse-rush.ts');
    expect(nav).toContain('mesurerImage(gris, prec)');
  });

  it('énergie audio par fenêtre', () => {
    const pcm = new Uint8Array(8000 * 2 * 2); // 2 s de silence puis rien
    const v = new DataView(pcm.buffer);
    for (let i = 8000; i < 16000; i++) v.setInt16(i * 2, 16000, true); // 2e seconde forte
    const e = energieDepuisPcm(pcm, 1, 2, 8000);
    expect(e[0]).toBe(0);
    expect(e[1]).toBeGreaterThan(0.5);
  });

  it('plan construit depuis des échantillons serveur', () => {
    const r = (url: string) => ({
      url, duree: 20,
      echantillons: Array.from({ length: 40 }, (_, i): EchantillonRush => ({ t: i / 2, mouvement: 0.1 + (i % 5) / 50, luminosite: 0.5, nettete: 0.1, audio: 0.3 })),
    });
    const plan = planMontage([r('A'), r('B')], 30)!;
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(plan[0].url).not.toBe(plan[1].url);
  });
});

describe('Musique Autopilote', () => {
  it('la musique de la Médiathèque est enregistrée en URL ABSOLUE', () => {
    const panel = src('src/components/creer/AutopilotPanel.tsx');
    expect(panel).toContain('const absolue = url ? urlPubliqueAbsolue(url, window.location.origin) : null;');
    expect(panel).toContain('if (absolue) enregistrer({ musicUrl: absolue });');
  });
});

describe('Progression réelle', () => {
  it('bornes par étape', () => {
    expect(pourcentEtape('analyse', 0)).toBe(0);
    expect(pourcentEtape('analyse', 1)).toBe(15);
    expect(pourcentEtape('preparation', 0)).toBe(15);
    expect(pourcentEtape('composition', 0.5)).toBe(55);
    expect(pourcentEtape('envoi', 0)).toBe(85);
    expect(pourcentEtape('finalisation', 1)).toBe(100);
  });

  it('ne recule jamais, effacée en fin', () => {
    noterProgression('u', 'composition', 0.5);
    noterProgression('u', 'analyse', 0);
    expect(lireProgression('u')?.pourcent).toBe(55);
    expect(lireProgression('u')?.libelle).toBe('Analyse des rushes…');
    effacerProgression('u');
    expect(lireProgression('u')).toBeNull();
  });

  it('câblage : route, rendu et panneau', () => {
    const route = src('src/app/api/autopilot/produire-maintenant/route.ts');
    expect(route).toContain('onProgression: (etape, avancement) => noterProgression(userId, etape, avancement),');
    expect(route).toContain('effacerProgression(userId);');
    const render = src('src/lib/autopilot/render.ts');
    expect(render).toContain('input.onComposition!(Math.min(1, Math.max(0, (progress - 20) / 75)))');
    const panel = src('src/components/creer/AutopilotPanel.tsx');
    expect(panel).toContain("fetch('/api/autopilot/produire-maintenant/progression', { cache: 'no-store' })");
    expect(panel).toContain('{progressionProduction?.pourcent ?? 0} %');
  });
});
