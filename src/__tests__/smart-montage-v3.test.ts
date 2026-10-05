/**
 * SMART MONTAGE V3 — profils, phases HOOK→CTA, coupes sur le rythme,
 * durées de plan par profil, ralenti seulement sur un geste fort.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  planMontage, profilMontageDuContexte, grilleDeCoupes, REGLES_PROFILS, miseEnPageDuProfil,
  type AnalyseRush, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { analyserRythme, rythmeSurFenetre } from '@/lib/creer/rythme-musique';
import { rushSegmentsDepuisMetadata } from '@/lib/creer/multi-rush';

function rush(url: string, duree: number, profil: (t: number) => Partial<EchantillonRush>): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const graine = [...url].reduce((n, c) => n + c.charCodeAt(0), 0) + Math.floor(t * 2) * 13;
    echantillons.push({
      t, mouvement: 0.08, luminosite: 0.5, nettete: 0.1, audio: 0.4,
      empreinte: Array.from({ length: 64 }, (_, i) => ((graine * 31 + i * 17) % 97) / 97),
      ...profil(t),
    });
  }
  return { url, duree, echantillons };
}

/** Piste « clic » à 120 BPM : une impulsion toutes les 0,5 s, drop d'énergie à 16 s. */
function pisteClic(hz: number, secondes: number): Float32Array {
  const s = new Float32Array(hz * secondes);
  for (let t = 0; t < secondes; t += 0.5) {
    const i = Math.round(t * hz);
    const fort = t >= 16 ? 0.9 : 0.4;
    for (let j = 0; j < hz * 0.02 && i + j < s.length; j++) s[i + j] = fort * Math.sin(j / 2);
  }
  for (let i = hz * 16; i < s.length; i++) s[i] += 0.3 * Math.sin(i / 7);
  return s;
}

const DANSE = { theme: 'Danser active plus de muscles que la plupart des sports', objectif: 'remplir mes cours' };

describe('profils', () => {
  it('déduits du thème / brief, sinon STANDARD', () => {
    expect(profilMontageDuContexte(DANSE).profil).toBe('CARDIO_DANCE');
    expect(profilMontageDuContexte({ theme: 'Nouvelle collection de chaussures, élégance' }).profil).toBe('LIFESTYLE_BRAND');
    expect(profilMontageDuContexte({ theme: 'Tuto : comment bien respirer, conseils' }).profil).toBe('TUTORIAL_EDUCATION');
    expect(profilMontageDuContexte({ theme: 'Soirée festival, ambiance du public' }).profil).toBe('EVENT_IMMERSIVE');
    expect(profilMontageDuContexte({ theme: 'xyz' }).profil).toBe('STANDARD');
  });

  it('les profils dynamiques recommandent les titres en surimpression', () => {
    expect(miseEnPageDuProfil('CARDIO_DANCE').overlay).toBe(true);
    expect(miseEnPageDuProfil('TUTORIAL_EDUCATION').overlay).toBe(false);
  });
});

describe('rythme de la musique (local)', () => {
  const r = analyserRythme(pisteClic(11025, 30), 11025);

  it('tempo et temps retrouvés sur une piste à 120 BPM', () => {
    expect(r.bpm).toBeGreaterThanOrEqual(115);
    expect(r.bpm).toBeLessThanOrEqual(125);
    expect(r.beats.length).toBeGreaterThan(40);
    expect(r.forts.length).toBeGreaterThan(0);
  });

  it('recalage sur la fenêtre de la séquence Vidéo', () => {
    const f = rythmeSurFenetre({ bpm: 120, beats: [9, 10.5, 12, 40], forts: [10.5], drop: 12 }, 10, 20);
    expect(f).toEqual({ bpm: 120, beats: [0.5, 2], forts: [0.5], drop: 2 });
  });
});

describe('grille de coupes', () => {
  const regle = REGLES_PROFILS.CARDIO_DANCE;

  it('phases dans l ordre HOOK → BUILD → PEAK → FOCUS → CTA, plans courts', () => {
    const g = grilleDeCoupes(30, regle, null);
    const ordre = ['HOOK', 'BUILD', 'PEAK', 'FOCUS', 'CTA'];
    const vues = [...new Set(g.map((c) => c.phase))];
    expect(vues).toEqual(ordre);
    g.slice(0, -1).forEach((c) => expect(c.fin - c.debut).toBeLessThanOrEqual(regle.hardMax + 1e-6));
    expect(g[g.length - 1].fin).toBe(30);
  });

  it('les coupes se calent sur les temps forts quand la musique est analysée', () => {
    const forts = Array.from({ length: 60 }, (_, i) => i * 0.5);
    const g = grilleDeCoupes(30, regle, { beats: forts, forts, drop: null });
    const cales = g.filter((c) => c.beat !== null);
    expect(cales.length).toBeGreaterThanOrEqual(g.length - 1);
    cales.forEach((c) => expect(Math.abs((c.fin * 2) - Math.round(c.fin * 2))).toBeLessThan(1e-6));
  });

  it('le drop ouvre le PEAK', () => {
    const g = grilleDeCoupes(30, regle, { beats: [], forts: [], drop: 8 });
    const premierPeak = g.find((c) => c.phase === 'PEAK')!;
    expect(premierPeak.debut).toBeGreaterThanOrEqual(8 - 2);
    expect(premierPeak.debut).toBeLessThanOrEqual(8 + 2);
  });
});

describe('plan CARDIO_DANCE sur 3 rushes', () => {
  const A = rush('a.mp4', 45, (t) => ({ mouvement: 0.05 + ((t * 7) % 5) / 40 }));
  const B = rush('b.mp4', 30, (t) => ({ mouvement: 0.06 + ((t * 3) % 4) / 35 }));
  const C = rush('c.mp4', 20, (t) => ({ mouvement: 0.07 + ((t * 5) % 3) / 30 }));
  const forts = Array.from({ length: 80 }, (_, i) => Math.round(i * 0.441 * 1000) / 1000);
  const plan = planMontage([A, B, C], 30, { contexte: DANSE, rythme: { beats: forts, forts, drop: null } })!;
  const durees = plan.map((s) => s.fin - s.debut);

  it('12–20 extraits courts, 3 rushes', () => {
    expect(plan.length).toBeGreaterThanOrEqual(12);
    expect(plan.length).toBeLessThanOrEqual(24);
    // Danse : jamais plus de 2 s hors CTA ; le CTA peut être plus posé (≤ 3 s).
    const horsCta = plan.filter((s) => s.phase !== 'CTA').map((s) => s.fin - s.debut);
    expect(Math.max(...horsCta)).toBeLessThanOrEqual(REGLES_PROFILS.CARDIO_DANCE.hardMax + 1e-6);
    expect(Math.max(...durees)).toBeLessThanOrEqual(REGLES_PROFILS.CARDIO_DANCE.phases.CTA[1] + 1e-6);
    expect(new Set(plan.map((s) => s.url)).size).toBe(3);
  });

  it('narration complète et raisons lisibles', () => {
    expect(plan[0].phase).toBe('HOOK');
    expect(plan[plan.length - 1].phase).toBe('CTA');
    plan.forEach((s) => {
      expect(s.raison).toMatch(/^(HOOK|BUILD|PEAK|FOCUS|CTA) · /);
      expect(typeof s.differenceVisuelle).toBe('number');
    });
    expect(plan.filter((s) => s.beatCible !== null && s.beatCible !== undefined).length).toBeGreaterThan(plan.length / 2);
  });

  it('aucun rush ne domine sans raison (≤ 60 %)', () => {
    const part = (u: string) => plan.filter((s) => s.url === u).reduce((t, s) => t + s.fin - s.debut, 0) / plan[plan.length - 1].fin;
    ['a.mp4', 'b.mp4', 'c.mp4'].forEach((u) => expect(part(u)).toBeLessThanOrEqual(0.6));
  });

  it('pas de ralenti sans geste fort', () => {
    expect(plan.filter((s) => s.effet === 'ralenti').length).toBe(0);
  });

  it('ralenti ponctuel sur un geste fort, jamais plus de 2', () => {
    const sauts = rush('saut.mp4', 30, (t) => ({ mouvement: t % 6 < 0.6 ? 0.6 : 0.05 }));
    const p = planMontage([sauts, B, C], 30, { contexte: DANSE })!;
    const r = p.filter((s) => s.effet === 'ralenti');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.length).toBeLessThanOrEqual(2);
    r.forEach((s) => {
      expect(s.vitesse).toBe(0.6);
      expect(['HOOK', 'PEAK']).toContain(s.phase);
    });
  });

  it('les champs V3 survivent à la relecture des métadonnées', () => {
    const relu = rushSegmentsDepuisMetadata(JSON.parse(JSON.stringify(plan)))!;
    expect(relu[0].phase).toBe('HOOK');
    expect(relu.some((s) => typeof s.beatCible === 'number')).toBe(true);
  });
});

describe('câblage', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');
  it('Autopilote et Créer passent le rythme de la musique au moteur', () => {
    expect(src('src/lib/autopilot/produire.ts')).toContain('rythmeVideo = rythme ? rythmeSurFenetre(rythme, debutVideo, cible) : null;');
    expect(src('src/lib/autopilot/produire.ts')).toContain('rythme: rythmeVideo,');
    expect(src('src/app/dashboard/creer/AssistantWizard.tsx')).toContain('const rythmeVideo = rythme ? rythmeSurFenetre(rythme, debutVideo, cibleEcran) : null;');
    expect(src('src/app/dashboard/creer/AssistantWizard.tsx')).toContain('planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage });');
  });
  it('le ralenti est rendu par Remotion et par le compositeur', () => {
    expect(src('remotion/CreerSimpleMontage.tsx')).toContain('playbackRate: seg.vitesse');
    // Compositeur : la vitesse part dans le plan, le pilote l'applique.
    expect(src('src/lib/video-composer.ts')).toContain('vitesse: seg.vitesse ?? 1');
    expect(src('src/lib/creer/pilote-montage.ts')).toContain('seg.el.playbackRate = vitesse;');
  });
});
