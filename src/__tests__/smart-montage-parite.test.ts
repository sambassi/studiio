/**
 * PARITÉ CRÉER + AUTOPILOTE — un seul moteur Smart Montage.
 *
 * Cas de référence : les 3 rushes DANSE réels (analyses mesurées) + la même
 * musique + la même durée cible. Chaque parcours prépare ses entrées avec
 * SES champs (Créer : sujet choisi + titre généré ; Autopilote : titre du
 * post), mais par la MÊME fonction — et obtient le même profil, le même plan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import {
  planMontage, profilMontageDuContexte, mesuresSegments, REGLES_PROFILS, type AnalyseRush,
} from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan, TEXTES_PROFILS, memeTimecode } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';

const analyses = danse.analyses as AnalyseRush[];
const CIBLE = 24.288;
const TEXTES = {
  sousTitre: 'Danser active plus de muscles que la plupart des sports',
  cartes: [{ title: 'MÉMOIRE BOOSTÉE' }, { title: 'CARDIO COMPLET' }, { title: 'OS RENFORCÉS' }, { title: 'ANTI-ÂGE' }, { title: '300+ MUSCLES' }],
};
// Créer : le sujet choisi dans le wizard + le titre généré.
const contexteCreer = contexteMontageDepuis({ theme: 'danse', titre: 'DANSE', ...TEXTES });
// Autopilote : le titre du post (issu du même sujet).
const contexteAutopilote = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', ...TEXTES });

const CREATE_PLAN = planMontage(analyses, CIBLE, { rythme: danse.rythme, contexte: contexteCreer })!;
const AUTOPILOT_PLAN = planMontage(analyses, CIBLE, { rythme: danse.rythme, contexte: contexteAutopilote })!;
const rapport = (plan: typeof CREATE_PLAN) => rapportPlan('CARDIO_DANCE', mesuresSegments(plan, analyses)!, danse.rythme);

describe('parité Créer / Autopilote (DANSE réel)', () => {
  it('PROFILE_MATCH : CARDIO_DANCE des deux côtés', () => {
    expect(profilMontageDuContexte(contexteCreer).profil).toBe('CARDIO_DANCE');
    expect(profilMontageDuContexte(contexteAutopilote).profil).toBe('CARDIO_DANCE');
  });

  it('même moteur, mêmes entrées → MÊME plan (timecodes compris)', () => {
    expect(AUTOPILOT_PLAN).toEqual(CREATE_PLAN);
  });

  it('SEGMENT / SHOT_DURATION_RULES : accroche 0,8–1,2 s, corps ≤ 2 s, CTA ≤ 3 s', () => {
    for (const plan of [CREATE_PLAN, AUTOPILOT_PLAN]) {
      const d = (s: (typeof plan)[number]) => s.fin - s.debut;
      expect(plan.filter((s) => s.phase === 'HOOK').every((s) => d(s) <= REGLES_PROFILS.CARDIO_DANCE.phases.HOOK[1] + 1e-6)).toBe(true);
      expect(plan.filter((s) => s.phase !== 'CTA').every((s) => d(s) <= REGLES_PROFILS.CARDIO_DANCE.hardMax + 1e-6)).toBe(true);
      expect(plan.every((s) => d(s) <= 3 + 1e-6)).toBe(true);
      // Chaque extrait explique sa sélection.
      plan.forEach((s) => {
        expect(typeof s.energie).toBe('number');
        expect(typeof s.similariteVisuelle).toBe('number');
        expect(typeof s.coherenceVisuelle).toBe('number');
        expect(s.raison).toMatch(/^(HOOK|BUILD|PEAK|FOCUS|CTA) · /);
      });
    }
  });

  it('ANTI_REPEAT : aucun timecode repris, mêmes mesures des deux côtés', () => {
    const r = rapport(CREATE_PLAN);
    expect(r.DUPLICATE_SEGMENTS).toBe(0);
    expect(rapport(AUTOPILOT_PLAN)).toEqual(r);
    const fen = CREATE_PLAN.map((s) => ({ cle: s.url, depuis: s.depuis ?? 0, jusqua: s.jusqua ?? 0, empreinte: null }));
    for (let i = 0; i < fen.length; i++) for (let j = i + 1; j < fen.length; j++) expect(memeTimecode(fen[i], fen[j])).toBe(false);
  });

  it('BEAT_SYNC : toutes les coupes sur un temps de la musique', () => {
    const r = rapport(CREATE_PLAN);
    expect(r.BEAT_SYNC_RATIO).toBe(1);
    expect(r.MAX_BEAT_OFFSET_MS).toBe(0);
  });

  it('VISUAL_COHERENCE : le noir et blanc n\'alterne plus avec la couleur (10 bascules → ≤ 2)', () => {
    const r = rapport(CREATE_PLAN);
    expect(r.COLOR_STYLE_BREAKS).toBeLessThanOrEqual(2);
    expect(r.ENERGY_BREAKS).toBe(0);
    expect(r.SHOTS_OVER_2S).toBe(0);
  });

  it('TEXTES : mêmes règles partagées — cartes ≥ 3 s (adaptées sous 30 s), accroche ≤ 3 s', () => {
    const o = planOverlays({ duree: CIBLE, nbCartes: 5, finHook: CREATE_PLAN.filter((s) => s.phase === 'HOOK').at(-1)!.fin, profil: 'CARDIO_DANCE' });
    expect(o.titre![1]).toBeLessThanOrEqual(TEXTES_PROFILS.CARDIO_DANCE.accroche.dureeMax + 1e-6);
    expect(o.cartes).toHaveLength(5);
    o.cartes.forEach((c) => expect(c.fin - c.debut).toBeGreaterThanOrEqual(3 - 1e-6));
    // Sans profil : les durées d'avant, inchangées (rétrocompatibilité).
    const avant = planOverlays({ duree: CIBLE, nbCartes: 5, finHook: 3 });
    avant.cartes.forEach((c) => expect(c.fin - c.debut).toBeLessThanOrEqual(3 + 1e-6));
  });
});

describe('source de vérité unique', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');
  const creer = src('src/app/dashboard/creer/AssistantWizard.tsx');
  const auto = src('src/lib/autopilot/produire.ts');

  it('Créer et Autopilote appellent les MÊMES fonctions partagées', () => {
    for (const f of [creer, auto]) {
      expect(f).toContain('contexteMontageDepuis({');
      expect(f).toContain('planMontage(analyses');
      expect(f).toContain('profilMontageDuContexte(contexteMontage).profil');
      expect(f).toContain('mesuresSegments(planMontageRushs');
      expect(f).toContain('rapportPlan(');
      expect(f).toContain('conseillerVideo({');
    }
  });

  it('aucune règle de montage recopiée dans les parcours', () => {
    for (const f of [creer, auto]) {
      expect(f).not.toMatch(/SEUIL_NOIR_BLANC\s*=|COHERENCE_PROFILS\s*=|REGLES_PROFILS\s*=|TEXTES_PROFILS\s*=/);
      expect(f).not.toMatch(/saturation\s*<\s*0\.0\d/);
    }
  });

  it('le conseiller juge avec les règles du moteur (pas une copie)', () => {
    const c = src('src/lib/creer/conseiller/montage.ts');
    expect(c).toContain("from '@/lib/creer/smart-montage-regles'");
    expect(c).toContain('saturationNoirBlanc: SEUIL_NOIR_BLANC');
    expect(c).toContain('REGLES_PROFILS.CARDIO_DANCE.phases.HOOK[1]');
  });
});
