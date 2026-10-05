/**
 * #504 — VERROU FINAL DU MOTEUR DE MONTAGE (CARDIO_DANCE).
 * Référence : les 3 rushes DANSE réels + la même musique, deux ordres de cartes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { planMontage, mesuresSegments, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan, estNoirEtBlanc, matchCartesImages, COHERENCE_PROFILS } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';
import { raccourciNecessaire } from '@/lib/creer/raccourci';
import { ajusterCta, CTA_LARGEUR_PART } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO } from '@/lib/creer/designSpec';
import { controleQualite, erreurQualite } from '@/lib/creer/quality-gate';

const analyses = danse.analyses as AnalyseRush[];
const CTA = 'Réservez votre cours d’essai sur afroboost.com.';
const CARTES = [
  { icon: 'Dumbbell', title: '300+ MUSCLES', value: '300+' },
  { icon: 'Brain', title: 'RISQUE RÉDUIT', value: '-76%' },
  { icon: 'Heart', title: 'CARDIO COMPLET', value: '3-en-1' },
  { icon: 'Bone', title: 'OS RENFORCÉS', value: '+2%/an' },
  { icon: 'Sparkles', title: 'ANTI-ÂGE', value: '-10 ans' },
];
const contexte = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', sousTitre: 'Danser active plus de muscles que la plupart des sports', cartes: CARTES });

describe('verrou CARDIO_DANCE uniquement', () => {
  it('les autres profils gardent leurs règles', () => {
    expect(COHERENCE_PROFILS.CARDIO_DANCE.verrou).toBe(true);
    for (const p of ['EVENT_IMMERSIVE', 'LIFESTYLE_BRAND', 'TUTORIAL_EDUCATION', 'STANDARD'] as const) expect(COHERENCE_PROFILS[p].verrou).toBe(false);
  });
});

describe.each([15, 21.45, 24.288, 30.3])('DANSE, %s s demandées', (demande) => {
  const plan = planMontage(analyses, demande, { rythme: danse.rythme, contexte })!;
  const ms = mesuresSegments(plan, analyses)!;
  const r = rapportPlan('CARDIO_DANCE', ms, danse.rythme);
  const fin = plan.at(-1)!.fin;
  const overlays = planOverlays({ duree: fin, nbCartes: 5, finHook: plan.filter((s) => s.phase === 'HOOK').at(-1)!.fin, profil: 'CARDIO_DANCE' });

  it('UNIQUE_RUSH_LOCK : aucun passage répété, jamais rallongé', () => {
    expect(r.DUPLICATE_SEGMENTS).toBe(0);
    expect(fin).toBeLessThanOrEqual(demande + 1e-6);
  });

  it('FULL_COLOR_LOCK : BW_DURATION_TOTAL = 0, COLOR_BREAK_COUNT = 0', () => {
    expect(ms.reduce((t, s) => t + (estNoirEtBlanc(s.saturation) ? s.fin - s.debut : 0), 0)).toBe(0);
    expect(r.COLOR_STYLE_BREAKS).toBe(0);
  });

  it('FIRST_BADGE_2S : première carte entre 1,8 et 2,5 s, les 5 cartes gardées', () => {
    expect(overlays.cartes).toHaveLength(5);
    expect(overlays.cartes[0].debut).toBeGreaterThanOrEqual(1.8 - 1e-6);
    expect(overlays.cartes[0].debut).toBeLessThanOrEqual(2.5 + 1e-6);
  });

  it('BADGE_VISUAL_GATE : chaque carte sur des plans lisibles (accord ≥ 0,5)', () => {
    for (const a of matchCartesImages(ms, overlays.cartes, CARTES.map((c) => c.title))) expect(a.ajustement!).toBeGreaterThanOrEqual(0.5);
  });

  it('QUALITY_GATE : tout passe, aucun blocage', () => {
    const c = controleQualite({
      profil: 'CARDIO_DANCE', mesures: ms, rapport: r, overlays, cartes: CARTES,
      cta: { texte: 'LE SPORT LE PLUS COMPLET', sousTexte: CTA }, ctaUtilisateur: CTA, antiGels: true,
    });
    expect(c.map((x) => x.code)).toEqual(['UNIQUE_RUSH_RULE', 'CTA_FULL_TEXT', 'CTA_SAFE_ZONE', 'FIRST_BADGE_TIMING', 'BADGES_COMPLETE', 'BADGE_VISUAL_FIT', 'COLOR_CONTINUITY', 'FREEZE_RULE', 'BEAT_RULE']);
    expect(c.filter((x) => !x.ok)).toEqual([]);
    expect(erreurQualite(c)).toBeNull();
  });
});

describe('AUTO_SHORTENING + avertissement', () => {
  it('30 s demandées, matière unique ≈ 23 s : vidéo propre plus courte, et la question est posée', () => {
    const plan = planMontage(analyses, 30.3, { rythme: danse.rythme, contexte })!;
    const fin = plan.at(-1)!.fin;
    expect(fin).toBeGreaterThanOrEqual(21);
    const q = raccourciNecessaire(30, fin, new Set(plan.map((s) => s.url)).size)!;
    expect(q).not.toBeNull();
    expect(q.message).toMatch(/permettent une vidéo d’environ \d+ secondes sans répétition\. Pour obtenir une vidéo de 30 secondes, ajoutez davantage de rushs\./);
    expect(q.rushs).toBeGreaterThanOrEqual(1);
    expect(q.supplementaires).toBeGreaterThanOrEqual(1);
  });

  it('écart sous 1 s : aucune question', () => {
    expect(raccourciNecessaire(24, 23.5, 3)).toBeNull();
    expect(raccourciNecessaire(24, 24, 3)).toBeNull();
  });

  it('Créer : la question attend le choix AVANT le rendu ; « Ajouter des rushs » ramène aux rushes sans erreur ni débit', () => {
    const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(w).toContain('const continuer = await new Promise<boolean>((resoudre) => setDemandeRaccourci({ ...raccourci, resoudre }));');
    expect(w).toContain('if (!continuer) throw new ArretPourAjouterDesRushs();');
    expect(w).toContain('if (err instanceof ArretPourAjouterDesRushs) {');
    expect(w).toContain('Continuer avec {Math.round(demandeRaccourci.possible)} s');
    expect(w).toContain('Ajouter des rushs');
    // La question précède la capture et la réservation.
    expect(w.indexOf('throw new ArretPourAjouterDesRushs()')).toBeLessThan(w.indexOf("setRenderStage('Textes sur la vidéo…');"));
  });

  it('Autopilote : sans utilisateur à qui demander, c’est DIT (journal + métadonnées)', () => {
    const a = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(a).toContain('montageRaccourci = raccourciNecessaire(cible, dureePlan(planMontageRushs)');
    expect(a).toContain('qualiteMontage: qualiteMontage.map(');
  });
});

describe('CTA_WRAP_SAFEZONE', () => {
  it('largeur ≤ 80 % (marges ≥ 10 %), URL entière : police réduite si besoin, jamais coupée', () => {
    expect(CTA_LARGEUR_PART).toBeLessThanOrEqual(0.8);
    expect(CTA_LARGEUR_PART).toBeGreaterThanOrEqual(0.5);
    const base = { texte: 'LE SPORT LE PLUS COMPLET', sousTexte: CTA, largeur: 1080, ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true };
    expect(ajusterCta({ ...base, echelle: 1.6 })).toBe(1.6);
    const grand = ajusterCta({ ...base, echelle: 5 });
    expect(grand).toBeLessThan(5);
    // « AFROBOOST.COM. » (14 caractères) tient dans la largeur utile.
    expect(14 * 0.68 * 1080 * FONT_RATIO['9:16'].ctaSub * grand).toBeLessThanOrEqual(1080 * CTA_LARGEUR_PART - 2 * 1080 * 0.04);
  });

  it('le CTA ne coupe jamais un mot', () => {
    const c = readFileSync(resolve(process.cwd(), 'src/components/creer/SequenceCta.tsx'), 'utf-8');
    expect(c).toContain("wordBreak: 'keep-all'");
  });
});

describe('QUALITY_GATE : blocages avant débit', () => {
  const base = { profil: 'CARDIO_DANCE', mesures: null, overlays: null, cartes: [], cta: { texte: 'X', sousTexte: CTA }, ctaUtilisateur: CTA, antiGels: true };
  it('passage répété → bloquant', () => {
    const c = controleQualite({ ...base, rapport: { DUPLICATE_SEGMENTS: 1 } as never });
    expect(erreurQualite(c)).toMatch(/UNIQUE_RUSH_RULE/);
  });
  it('CTA utilisateur absent du rendu → bloquant', () => {
    const c = controleQualite({ ...base, rapport: null, cta: { texte: 'LE SPORT', sousTexte: 'LIEN EN BIO' } });
    expect(erreurQualite(c)).toMatch(/CTA_FULL_TEXT/);
  });
  it('carte incomplète → bloquant', () => {
    const c = controleQualite({ ...base, rapport: null, overlays: { titre: [0, 2], cartes: [{ index: 0, debut: 2, fin: 5 }], cta: [10, 12], voix: {} }, cartes: [{ title: '', value: '-76%' }] });
    expect(erreurQualite(c)).toMatch(/BADGES_COMPLETE/);
  });
});
