/**
 * V3 — SURIMPRESSIONS : pour CARDIO_DANCE / EVENT_IMMERSIVE, la vidéo ne
 * s'arrête plus : titre, cartes et CTA passent PAR-DESSUS le rush.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { planOverlays, profilEnSurimpression, overlaysDepuisMetadata } from '@/lib/creer/overlays';
import { buildSequences } from '@/lib/creer/designSpec';

describe('placement des surimpressions', () => {
  const o = planOverlays({ duree: 24.8, nbCartes: 3, finHook: 3.6, voix: { titre: 2.8, cartes: 5.5, cta: 2.4 } });

  it('titre sur le HOOK, CTA sur les dernières secondes, rien après la fin', () => {
    expect(o.titre).toEqual([0, 3.6]);
    expect(o.cta![1]).toBeCloseTo(24.8, 3);
    expect(o.cta![1] - o.cta![0]).toBeGreaterThanOrEqual(2.4);
    expect(o.cta![1] - o.cta![0]).toBeLessThanOrEqual(3.1);
  });

  it('cartes une à la fois, 1,5–3 s, entre titre et CTA, sans durée ajoutée', () => {
    expect(o.cartes.length).toBe(3);
    o.cartes.forEach((c, i) => {
      expect(c.fin - c.debut).toBeGreaterThanOrEqual(1.5 - 1e-6);
      expect(c.fin - c.debut).toBeLessThanOrEqual(3 + 1e-6);
      expect(c.debut).toBeGreaterThanOrEqual(o.titre![1]);
      expect(c.fin).toBeLessThanOrEqual(o.cta![0]);
      if (i > 0) expect(c.debut).toBeGreaterThanOrEqual(o.cartes[i - 1].fin);
    });
  });

  it('voix l une après l autre, jamais superposées', () => {
    expect(o.voix.titre).toBe(0);
    expect(o.voix.cartes!).toBeGreaterThanOrEqual(2.8);
    expect(o.voix.cta!).toBeGreaterThanOrEqual(o.voix.cartes! + 5.5);
  });

  it('trop peu de place : moins de cartes, jamais une vidéo rallongée', () => {
    const court = planOverlays({ duree: 9, nbCartes: 5 });
    expect(court.cartes.length).toBeLessThan(5);
    expect(court.cta![1]).toBe(9);
  });

  it('profils : CARDIO / EVENT en surimpression, pas les autres', () => {
    expect(profilEnSurimpression('CARDIO_DANCE')).toBe(true);
    expect(profilEnSurimpression('EVENT_IMMERSIVE')).toBe(true);
    expect(profilEnSurimpression('TUTORIAL_EDUCATION')).toBe(false);
    expect(profilEnSurimpression('STANDARD')).toBe(false);
  });

  it('relecture des métadonnées', () => {
    expect(overlaysDepuisMetadata(JSON.parse(JSON.stringify(o)))).toEqual(o);
    expect(overlaysDepuisMetadata(null)).toBeNull();
  });
});

describe('timeline : la vidéo est tout le montage', () => {
  it('titre / cartes / CTA à 0 s → une seule séquence, la vidéo', () => {
    const seq = buildSequences({
      introDuration: 0, cardsDuration: 0, videoDuration: 24.8, ctaDuration: 0,
      cardCount: 3, hasVideoBackground: true, videoRequested: true,
    });
    expect(seq).toEqual([{ type: 'video', duration: 24.8 }]);
  });
});

describe('câblage', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf-8');

  it('Remotion : textes par-dessus le rush, voix aux départs recalés', () => {
    const r = src('remotion/CreerSimpleMontage.tsx');
    expect(r).toContain("{type === 'video' && props.surimpressions && (");
    expect(r).toContain('{blocTitre(1)}');
    expect(r).toContain('{blocCartes([carte])}');
    expect(r).toContain('{blocCta(1)}');
    expect(r).toContain('const depart = props.surimpressions?.voix[cle];');
    // Le design d'avant est réutilisé tel quel (mêmes composants).
    expect(r).toContain('{blocTitre(anim.reveal)}');
    expect(r).toContain('{blocCta(anim.reveal)}');
  });

  it('Autopilote : profils dynamiques → séquences statiques retirées', () => {
    const p = src('src/lib/autopilot/produire.ts');
    expect(p).toContain('profilVideo = profilMontageDuContexte(contexteMontage).profil;');
    expect(p).toContain('enSurimpression = profilEnSurimpression(profilVideo);');
    expect(p).toContain('...(overlays ? { surimpressions: overlays, introDuration: 0, cardsDuration: 0, ctaDuration: 0 } : {}),');
    expect(p).toContain('const debutVideo = enSurimpression ? 0 :');
    expect(p).toContain('...(overlays ? { surimpressions: overlays } : null),');
  });
});
