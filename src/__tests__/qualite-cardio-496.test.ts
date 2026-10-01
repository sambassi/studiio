/**
 * #496 — QUALITÉ ÉDITORIALE CARDIO_DANCE (règles partagées Créer + Autopilote).
 *
 * Référence : les 3 rushes DANSE réels (analyses mesurées) et la même musique
 * (percussions mesurées), comparés à l'état d'avant (#493) :
 *   bascules couleur ↔ N&B 2 → ≤ 1 ; plus longue série N&B 6,6 s → ≤ 2,2 s ;
 *   coupes ≤ 80 ms d'une percussion forte 5/18 → ≥ 50 % ; > 120 ms 12/18 → < 50 %.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import {
  planMontage, mesuresSegments, grilleDeCoupes, REGLES_PROFILS, type AnalyseRush, type EchantillonRush,
} from '@/lib/creer/smart-montage';
import { rapportPlan, contexteMontageDepuis, matchCartesImages, carteEnergique } from '@/lib/creer/smart-montage-regles';
import { analyserRythme } from '@/lib/creer/rythme-musique';
import { planOverlays } from '@/lib/creer/overlays';
import { coherenceCarte, signeValeur } from '@/lib/creer/coherence-chiffres';
import { conseilsTextes } from '@/lib/creer/conseiller/textes';
import { miseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO } from '@/lib/creer/designSpec';

const analyses = danse.analyses as AnalyseRush[];
const CARTES = [{ title: 'MÉMOIRE BOOSTÉE' }, { title: 'CARDIO COMPLET' }, { title: 'OS RENFORCÉS' }, { title: 'ANTI-ÂGE' }, { title: '300+ MUSCLES' }];
const contexte = contexteMontageDepuis({ theme: 'danse', titre: 'DANSE', sousTitre: 'Danser active plus de muscles que la plupart des sports', cartes: CARTES });
const plan = planMontage(analyses, 24.288, { rythme: danse.rythme, contexte })!;
const ms = mesuresSegments(plan, analyses)!;
const r = rapportPlan('CARDIO_DANCE', ms, danse.rythme);

describe('référence DANSE — après #496', () => {
  it('COULEUR : au plus 1 passage couleur ↔ N&B, aucune série N&B de plusieurs secondes', () => {
    expect(r.COLOR_STYLE_BREAKS).toBeLessThanOrEqual(1);
    expect(r.LONGEST_BW_SEQUENCE_S!).toBeLessThanOrEqual(REGLES_PROFILS.CARDIO_DANCE.hardMax + 0.25);
  });

  it('PERCUSSIONS : moitié des coupes à ≤ 80 ms d\'une percussion forte, moins de la moitié au-delà de 120 ms', () => {
    expect(r.CUTS_LE_80MS! / r.CUTS_TOTAL).toBeGreaterThanOrEqual(0.5);
    expect(r.CUTS_GT_120MS! / r.CUTS_TOTAL).toBeLessThan(0.5);
  });

  it('MATCH CARTE / IMAGE : sous « 300+ MUSCLES » et « CARDIO COMPLET », des plans énergiques (tous les plans visibles comptent)', () => {
    const o = planOverlays({ duree: plan.at(-1)!.fin, nbCartes: 5, finHook: plan.filter((s) => s.phase === 'HOOK').at(-1)!.fin, profil: 'CARDIO_DANCE' });
    const m = matchCartesImages(ms, o.cartes, CARTES.map((c) => c.title));
    const de = (t: string) => m.find((x) => x.titre === t)!;
    expect(de('300+ MUSCLES').energique).toBe(true);
    expect(de('300+ MUSCLES').energie!).toBeGreaterThanOrEqual(0.75);
    expect(de('CARDIO COMPLET').energie!).toBeGreaterThanOrEqual(0.75);
    expect(m.every((x) => x.plans >= 1)).toBe(true);
  });

  it('jamais un timecode repris, jamais rallongé, narration complète', () => {
    expect(r.DUPLICATE_SEGMENTS).toBe(0);
    expect(plan.at(-1)!.fin).toBeLessThanOrEqual(24.288 + 1e-6);
    expect(plan[0].phase).toBe('HOOK');
    expect(plan.at(-1)!.phase).toBe('CTA');
    expect(r.SHOTS_OVER_2S).toBe(0);
  });
});

describe('percussions fortes', () => {
  /** Signal synthétique : clics forts à 0,6 s, 1,9 s, 3,1 s… et clics faibles entre. */
  const hz = 8000;
  // Léger fond sonore (comme une vraie musique) : sans lui, le moindre clic
  // sortant du silence parfait produirait une montée d'énergie énorme.
  const signal = Float32Array.from({ length: hz * 8 }, (_, k) => 0.03 * Math.sin(k * 0.37) * Math.sin(k * 0.011));
  const clic = (t: number, a: number) => { for (let k = 0; k < 160; k++) signal[Math.round(t * hz) + k] += a * Math.sin(k) * (1 - k / 160); };
  for (let t = 0.3; t < 7.5; t += 0.5) clic(t, 0.05);
  for (const t of [0.6, 1.9, 3.1, 4.4, 5.6, 6.9]) clic(t, 0.9);
  const ry = analyserRythme(signal, hz);

  it('l\'analyse expose les percussions réelles, avec une force 0..1', () => {
    expect(ry.impacts!.length).toBeGreaterThan(5);
    expect(Math.max(...ry.impacts!.map((i) => i.force))).toBe(1);
    // Chaque clic FORT est une percussion forte détectée, à son instant.
    for (const t of [0.6, 1.9, 3.1, 4.4, 5.6, 6.9]) {
      expect(ry.impacts!.some((i) => i.force >= 0.5 && Math.abs(i.t - t) < 0.06)).toBe(true);
    }
  });

  it('CARDIO_DANCE vise la percussion forte ; sans percussion forte proche, la grille d\'avant', () => {
    const grille = grilleDeCoupes(7, REGLES_PROFILS.CARDIO_DANCE, { beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5], forts: [], drop: null, impacts: ry.impacts });
    const fortes = ry.impacts!.filter((i) => i.force >= 0.5).map((i) => i.t);
    const surFortes = grille.slice(0, -1).filter((c) => fortes.some((t) => Math.abs(t - c.fin) < 1e-6)).length;
    expect(surFortes).toBeGreaterThan(0);
    // Sans percussions (analyse antérieure) : exactement la grille d'avant.
    const avant = grilleDeCoupes(7, REGLES_PROFILS.CARDIO_DANCE, { beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5], forts: [], drop: null });
    expect(avant.slice(0, -1).every((c) => Number.isInteger(c.fin * 2))).toBe(true);
  });
});

describe('série noir et blanc plafonnée (synthétique)', () => {
  const rush = (nom: string, duree: number, sat: number, base: number): AnalyseRush => ({
    url: `https://x/storage/v1/object/public/media/u/${nom}.mp4`, duree,
    echantillons: Array.from({ length: duree * 2 }, (_, k): EchantillonRush => ({
      t: k / 2, mouvement: 0.2 + ((k * 7) % 5) / 50, luminosite: 0.5, nettete: 0.3, audio: 0.3, saturation: sat,
      empreinte: Array.from({ length: 64 }, (_, i) => ((base * 97 + Math.floor(k / 6) * 31 + i * 13) % 100) / 100),
    })),
  });
  it('matière surtout en couleur : jamais plus de ~2 s de noir et blanc d\'affilée', () => {
    const p = planMontage([rush('couleur', 60, 0.06, 1), rush('nb1', 15, 0.014, 2), rush('nb2', 15, 0.014, 3)], 20, { contexte })!;
    let serie = 0; let max = 0;
    for (const s of p) { serie = s.url.includes('/nb') ? serie + s.fin - s.debut : 0; max = Math.max(max, serie); }
    expect(max).toBeLessThanOrEqual(REGLES_PROFILS.CARDIO_DANCE.hardMax + REGLES_PROFILS.CARDIO_DANCE.phases.PEAK[1] + 1e-6);
  });
});

describe('cohérence libellé / chiffre', () => {
  it('« MÉMOIRE BOOSTÉE -76% » est refusé, « RISQUE RÉDUIT » proposé d\'après la description', () => {
    const c = coherenceCarte('MÉMOIRE BOOSTÉE', '-76%', "Apprendre des chorégraphies stimule ta mémoire et réduit le risque d'Alzheimer de 76%");
    expect(c.ok).toBe(false);
    expect(c.proposition).toBe('RISQUE RÉDUIT');
    expect(coherenceCarte('MÉMOIRE BOOSTÉE', '-76%').proposition).toBeNull(); // sans description : rien d'inventé
  });
  it('cohérents : baisse annoncée et valeur négative, chiffres neutres, mots sans sens explicite', () => {
    expect(coherenceCarte('RISQUE RÉDUIT', '-76%').ok).toBe(true);
    expect(coherenceCarte('CORTISOL EN CHUTE', '-30%').ok).toBe(true);
    expect(coherenceCarte('300+ MUSCLES', '300+').ok).toBe(true);
    expect(coherenceCarte('CŒUR PROTÉGÉ', '-15%').ok).toBe(true);
    expect(coherenceCarte('BLESSURES EN BAISSE', '+20%').ok).toBe(false);
    expect(signeValeur('3-en-1')).toBe('neutre');
  });
  it('la base de contenus locale ne contient plus AUCUNE carte incohérente', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/smart-content.ts'), 'utf-8');
    const re = /title: "([^"]*)", description: "([^"]*)", value: "([^"]*)"/g;
    const fautives: string[] = [];
    let m: RegExpExecArray | null; let n = 0;
    while ((m = re.exec(src))) { n += 1; if (!coherenceCarte(m[1], m[3], m[2]).ok) fautives.push(`${m[1]} ${m[3]}`); }
    expect(n).toBeGreaterThan(500);
    expect(fautives).toEqual([]);
  });
  it('le conseiller le signale (sans rien modifier)', () => {
    const c = conseilsTextes({ profil: 'CARDIO_DANCE', cartes: [{ titre: 'MÉMOIRE BOOSTÉE', valeur: '-76%' }], fenetres: null });
    expect(c.find((x) => x.id === 'texte:carte-chiffre:0')?.priorite).toBe('IMPORTANTE');
  });
});

describe('accroche moins envahissante', () => {
  it('bloc titre + sous-titre (3 lignes au pire) ≤ 15 % de la hauteur 9:16', () => {
    const m = miseEnPageSurimpression('CARDIO_DANCE')!;
    const titre = 1080 * FONT_RATIO['9:16'].title * m.titleScale * 1.1;
    const sous = 1080 * FONT_RATIO['9:16'].subtitle * m.titleScale * m.subtitleScale * 1.25;
    expect((titre + 3 * sous) / 1920).toBeLessThanOrEqual(0.15);
    expect(m.titlePos.y).toBeLessThanOrEqual(10); // en haut, jamais centré
  });
});

describe('source unique', () => {
  it('cartes « énergiques » : lexique partagé (proxy mesuré : le mouvement)', () => {
    expect(carteEnergique('300+ MUSCLES')).toBe(true);
    expect(carteEnergique('CARDIO COMPLET')).toBe(true);
    expect(carteEnergique('ANTI-ÂGE')).toBe(false);
  });
  it('Créer et Autopilote passent les titres des cartes au moteur par la MÊME fonction', () => {
    const regles = readFileSync(resolve(process.cwd(), 'src/lib/creer/smart-montage-regles.ts'), 'utf-8');
    expect(regles).toContain('...(titres.length ? { cartes: titres } : {}),');
    for (const f of ['src/app/dashboard/creer/AssistantWizard.tsx', 'src/lib/autopilot/produire.ts']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf-8');
      expect(src).toContain('contexteMontageDepuis({');
      expect(src).not.toMatch(/carteEnergique|serieNoirBlanc|FORCE_PERCUSSION_FORTE/);
    }
  });
});
