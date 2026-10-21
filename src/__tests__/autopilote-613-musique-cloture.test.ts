/**
 * #613 — musique de la SÉQUENCE DE CLÔTURE (Autopilote, parole < cible).
 * Pendant la parole : rien ne change (×0,1). Après la dernière parole : la
 * musique remonte progressivement, puis s'éteint en fondu doux. Sans clôture :
 * le comportement A2 est intact (remontée 0,25 s, aucun fondu final).
 */
import { describe, it, expect } from 'vitest';
import {
  facteurMusiqueJumeau, fonduFinalMusique, DUCK_MUSIQUE_JUMEAU, RAMPE_DUCK_JUMEAU_S,
  REMONTEE_CLOTURE_S, FONDU_FINAL_CLOTURE_S,
} from '../../remotion/audio';
import { fenetreVoixJumeau } from '../../remotion/CreerSimpleMontage';

const reperes = { sequences: [{ type: 'video' }] as never, offsets: [0], base: [30 * 30], tFrames: 0, fps: 30 };

describe('fenêtre de la voix du jumeau', () => {
  it('sans fin de parole : toute la séquence Vidéo (A2 inchangé)', () => {
    expect(fenetreVoixJumeau({ voixJumeau: true, videoUrl: 'v.mp4' }, reperes)).toEqual({ debut: 0, fin: 30 });
  });
  it('avec clôture : la fenêtre s’arrête à la dernière parole, remontée longue', () => {
    expect(fenetreVoixJumeau({ voixJumeau: true, videoUrl: 'v.mp4', finVoixJumeauS: 24.682 }, reperes))
      .toEqual({ debut: 0, fin: 24.682, remontee: REMONTEE_CLOTURE_S });
  });
  it('fin de parole ≥ fin de séquence (pas de clôture) : comportement A2', () => {
    expect(fenetreVoixJumeau({ voixJumeau: true, videoUrl: 'v.mp4', finVoixJumeauS: 30 }, reperes)).toEqual({ debut: 0, fin: 30 });
  });
});

describe('facteur de la musique', () => {
  const fen = { debut: 0, fin: 24.682, remontee: REMONTEE_CLOTURE_S };
  it('pendant la parole : exactement ×0,1, à chaque instant', () => {
    for (let t = 0; t <= 24.682; t += 0.1) expect(facteurMusiqueJumeau(t, fen)).toBe(DUCK_MUSIQUE_JUMEAU);
  });
  it('après la parole : remontée progressive, monotone, sans saut, jusqu’à 1', () => {
    let avant = DUCK_MUSIQUE_JUMEAU;
    for (let t = 24.682; t <= 24.682 + REMONTEE_CLOTURE_S + 0.2; t += 1 / 30) {
      const v = facteurMusiqueJumeau(t, fen);
      expect(v).toBeGreaterThanOrEqual(avant - 1e-9);
      expect(v - avant).toBeLessThan(0.08); // aucune marche brusque d'une image à l'autre
      avant = v;
    }
    expect(facteurMusiqueJumeau(24.682 + REMONTEE_CLOTURE_S, fen)).toBe(1);
  });
  it('sans clôture : la remontée A2 (0,25 s, linéaire) est inchangée', () => {
    const a2 = { debut: 0, fin: 30 };
    expect(facteurMusiqueJumeau(30 + RAMPE_DUCK_JUMEAU_S / 2, a2)).toBeCloseTo(DUCK_MUSIQUE_JUMEAU + (1 - DUCK_MUSIQUE_JUMEAU) / 2, 6);
    expect(facteurMusiqueJumeau(30 + RAMPE_DUCK_JUMEAU_S, a2)).toBe(1);
  });
});

describe('fondu final de la musique', () => {
  it('inactif sans clôture', () => {
    expect(fonduFinalMusique(29.9, 30, false)).toBe(1);
  });
  it('clôture : 1 jusqu’au fondu, puis descente douce jusqu’à 0 à la dernière image', () => {
    expect(fonduFinalMusique(30 - FONDU_FINAL_CLOTURE_S - 0.01, 30, true)).toBe(1);
    let avant = 1;
    for (let t = 30 - FONDU_FINAL_CLOTURE_S; t <= 30; t += 1 / 30) {
      const v = fonduFinalMusique(t, 30, true);
      expect(v).toBeLessThanOrEqual(avant + 1e-9);
      expect(avant - v).toBeLessThan(0.06);
      avant = v;
    }
    expect(fonduFinalMusique(30, 30, true)).toBeCloseTo(0, 6);
  });
});
