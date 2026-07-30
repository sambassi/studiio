import { describe, it, expect } from 'vitest';
import {
  compareVoiceToSequence,
  voiceFitMessage,
  VOICE_FIT_TOLERANCE_S,
} from '@/lib/creer/voiceFit';

/**
 * Correspondance voix off ↔ durée de séquence.
 *
 * Ce que ces tests protègent : l'utilisateur doit savoir dans quel SENS agir,
 * et de combien. Un « ça ne colle pas » sans chiffre ne lui apprend rien.
 */

describe('Comparaison voix / séquence', () => {
  it('dit OK quand l écart tient dans la tolérance', () => {
    expect(compareVoiceToSequence(4.0, 4).status).toBe('ok');
    expect(compareVoiceToSequence(4.3, 4).status).toBe('ok');   // pile la tolérance
    expect(compareVoiceToSequence(3.7, 4).status).toBe('ok');
    expect(VOICE_FIT_TOLERANCE_S).toBe(0.3);
  });

  it('signale le dépassement dès qu on sort de la tolérance', () => {
    const fit = compareVoiceToSequence(6.2, 4);
    expect(fit.status).toBe('over');
    expect(fit.deltaSec).toBeCloseTo(2.2, 5);
  });

  it('signale AUSSI la voix trop courte — le cas qui n était pas couvert', () => {
    const fit = compareVoiceToSequence(2.5, 6);
    expect(fit.status).toBe('under');
    expect(fit.deltaSec).toBeCloseTo(-3.5, 5);
  });

  it('propose une durée de séquence entière, jamais inférieure à la voix', () => {
    // L'éditeur règle les séquences en secondes entières : arrondir au
    // supérieur évite de retomber sous la voix à cause de l'arrondi.
    expect(compareVoiceToSequence(6.2, 4).suggestedSeqSec).toBe(7);
    expect(compareVoiceToSequence(6.0, 4).suggestedSeqSec).toBe(6);
    expect(compareVoiceToSequence(0.4, 4).suggestedSeqSec).toBe(1); // jamais 0
  });

  it('reste muet quand il n y a rien à comparer', () => {
    for (const bad of [undefined, null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compareVoiceToSequence(bad as number, 4).status, String(bad)).toBe('unknown');
    }
    // Séquence désactivée (durée nulle) : rien à dire non plus.
    expect(compareVoiceToSequence(3, 0).status).toBe('unknown');
  });

  it('accepte une tolérance personnalisée', () => {
    expect(compareVoiceToSequence(5, 4, 1.5).status).toBe('ok');
    expect(compareVoiceToSequence(5, 4, 0.5).status).toBe('over');
  });
});

describe('Message affiché', () => {
  it('dit d ALLONGER, avec l écart chiffré', () => {
    const msg = voiceFitMessage(compareVoiceToSequence(6.2, 4), 6.2, 4);
    expect(msg).toContain('allonger');
    expect(msg).toContain('2,2 s');   // virgule décimale française
    expect(msg).toContain('6,2 s');
    expect(msg).toContain('4 s');
  });

  it('dit de RACCOURCIR, avec l écart chiffré', () => {
    const msg = voiceFitMessage(compareVoiceToSequence(2.5, 6), 2.5, 6);
    expect(msg).toContain('raccourcir');
    expect(msg).toContain('3,5 s');
  });

  it('confirme quand ça colle, sans chiffre d écart inutile', () => {
    const msg = voiceFitMessage(compareVoiceToSequence(4.1, 4), 4.1, 4);
    expect(msg).toContain('bonne durée');
    expect(msg).not.toContain('allonger');
    expect(msg).not.toContain('raccourcir');
  });

  it('ne dit rien quand il n y a rien à dire', () => {
    expect(voiceFitMessage(compareVoiceToSequence(undefined, 4), 0, 4)).toBe('');
  });

  it('n affiche jamais un écart négatif de zéro', () => {
    const msg = voiceFitMessage(compareVoiceToSequence(4, 4), 4, 4);
    expect(msg).not.toContain('-0');
  });
});
