/**
 * CONTRAT — MONTAGE (LOCKED, docs/FEATURE_LOCKS.md).
 * Comportement attendu par l'utilisateur, sur les 3 rushes DANSE réels :
 * aucun passage répété, jamais rallongé, pleine couleur, CTA complet, cartes
 * complètes, raccourcissement annoncé. Ne pas modifier pour faire passer la CI.
 */
import { describe, it, expect } from 'vitest';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { planMontage, mesuresSegments, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan, estNoirEtBlanc } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';
import { raccourciNecessaire } from '@/lib/creer/raccourci';
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
const contexte = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', sousTitre: 'Danser active plus de muscles', cartes: CARTES });

describe.each([15, 24.288, 30.3])('MONTAGE — %s s demandées', (demande) => {
  const plan = planMontage(analyses, demande, { rythme: danse.rythme, contexte })!;
  const ms = mesuresSegments(plan, analyses)!;
  const rapport = rapportPlan('CARDIO_DANCE', ms, danse.rythme);
  const fin = plan.at(-1)!.fin;
  const overlays = planOverlays({ duree: fin, nbCartes: 5, finHook: plan.filter((s) => s.phase === 'HOOK').at(-1)!.fin, profil: 'CARDIO_DANCE' });

  it('aucun passage source répété, jamais plus long que demandé', () => {
    expect(rapport.DUPLICATE_SEGMENTS).toBe(0);
    expect(fin).toBeLessThanOrEqual(demande + 1e-6);
  });
  it('pas de noir et blanc quand la couleur existe', () => {
    expect(ms.reduce((t, s) => t + (estNoirEtBlanc(s.saturation) ? s.fin - s.debut : 0), 0)).toBe(0);
    expect(rapport.COLOR_STYLE_BREAKS).toBe(0);
  });
  it('les 5 cartes sont affichées', () => {
    expect(overlays.cartes).toHaveLength(5);
  });
  it('contrôle qualité vert : CTA complet, cartes complètes, anti-gels', () => {
    const c = controleQualite({ profil: 'CARDIO_DANCE', mesures: ms, rapport, overlays, cartes: CARTES, cta: { texte: 'LE SPORT LE PLUS COMPLET', sousTexte: CTA }, ctaUtilisateur: CTA, antiGels: true });
    expect(c.filter((x) => !x.ok)).toEqual([]);
    expect(erreurQualite(c)).toBeNull();
  });
});

describe('MONTAGE — garde-fous bloquants (rien composé ni débité)', () => {
  const base = { profil: 'CARDIO_DANCE', mesures: null, overlays: null, cartes: [], cta: { texte: 'X', sousTexte: CTA }, ctaUtilisateur: CTA, antiGels: true };
  it('passage répété → bloqué', () => {
    expect(erreurQualite(controleQualite({ ...base, rapport: { DUPLICATE_SEGMENTS: 1 } as never }))).toMatch(/UNIQUE_RUSH_RULE/);
  });
  it('CTA utilisateur absent / tronqué → bloqué', () => {
    expect(erreurQualite(controleQualite({ ...base, rapport: null, cta: { texte: 'LE SPORT', sousTexte: 'LIEN EN BIO' } }))).toMatch(/CTA_FULL_TEXT/);
  });
  it('carte incomplète → bloquée', () => {
    const c = controleQualite({ ...base, rapport: null, overlays: { titre: [0, 2], cartes: [{ index: 0, debut: 2, fin: 5 }], cta: [10, 12], voix: {} }, cartes: [{ title: '', value: '-76%' }] });
    expect(erreurQualite(c)).toMatch(/BADGES_COMPLETE/);
  });
});

describe('MONTAGE — raccourcissement si rushes uniques insuffisants', () => {
  it('écart ≥ 1 s → question posée à l’utilisateur ; sinon rien', () => {
    expect(raccourciNecessaire(30, 23, 3)).not.toBeNull();
    expect(raccourciNecessaire(24, 23.5, 3)).toBeNull();
  });
});
