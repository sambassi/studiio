/**
 * Voix clonée supprimée puis recréée (prod 2026-10-05) : l'ancien voice_id
 * restait choisi (localStorage, brouillon, Autopilote) → « Unknown voice ».
 */
import { describe, it, expect } from 'vitest';
import { voixCloneeAProposer } from '@/lib/types/voice';

const DEF = 'fr-FR-DeniseNeural';
const actuelle = { id: 'elevenlabs-ZJEvSn6qQM22byw4On8P', cloned: true };

describe('voixCloneeAProposer', () => {
  it('voix ElevenLabs absente de la liste → voix clonée actuelle', () => {
    expect(voixCloneeAProposer('elevenlabs-nnNP5F8CMWGFwXB20SrW', DEF, [actuelle])).toBe(actuelle.id);
  });
  it('voix absente et aucune clonée → défaut', () => {
    expect(voixCloneeAProposer('elevenlabs-nnNP5F8CMWGFwXB20SrW', DEF, [{ id: 'elevenlabs-public123', cloned: false }])).toBe(DEF);
  });
  it('liste ElevenLabs vide (échec de lecture) → choix gardé', () => {
    expect(voixCloneeAProposer('elevenlabs-nnNP5F8CMWGFwXB20SrW', DEF, [{ id: 'heygen-abc', cloned: false }])).toBeNull();
  });
  it('choix explicite présent dans la liste → jamais écrasé', () => {
    expect(voixCloneeAProposer('elevenlabs-public123', DEF, [actuelle, { id: 'elevenlabs-public123' }])).toBeNull();
  });
  it('défaut → voix clonée proposée (inchangé)', () => {
    expect(voixCloneeAProposer(DEF, DEF, [actuelle])).toBe(actuelle.id);
  });
});
