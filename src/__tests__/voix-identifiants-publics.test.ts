/**
 * IDENTIFIANTS DE VOIX — neutres dehors, compatibles dedans.
 *
 * Un identifiant de voix fait l'aller-retour : il part au navigateur comme
 * valeur de l'option choisie, puis revient dire quel moteur synthétiser. Il
 * ne pouvait donc pas être supprimé, seulement renommé — et le renommage ne
 * doit casser AUCUNE sélection déjà enregistrée.
 */
import { describe, expect, it } from 'vitest';
import {
  ELEVENLABS_VOICE_PREFIX, HEYGEN_VOICE_PREFIX, PREFIXE_PUBLIC,
  idVoixInterne, idVoixPublic, isElevenLabsVoiceId, isHeyGenVoiceId,
} from '@/lib/types/voice';
import { TTS_VOICES } from '@/lib/tts/edge-tts-client';
import { NOMS_FOURNISSEURS_INTERDITS } from '@/lib/fournisseurs/messages-neutres';

describe('traduction public / interne', () => {
  it('traduit dans les deux sens, sans perte', () => {
    for (const [moteur, prefixe] of Object.entries(PREFIXE_PUBLIC)) {
      const interne = `${moteur}-abc123`;
      expect(idVoixPublic(interne)).toBe(`${prefixe}abc123`);
      expect(idVoixInterne(idVoixPublic(interne))).toBe(interne);
    }
  });

  it('⚠️ une ancienne forme enregistrée reste valide telle quelle', () => {
    for (const ancien of ['elevenlabs-xyz', 'heygen-abc', 'openai-alloy']) {
      expect(idVoixInterne(ancien)).toBe(ancien);
    }
  });

  it('laisse intact un identifiant qui ne porte aucun préfixe (voix Edge)', () => {
    expect(idVoixPublic('fr-FR-DeniseNeural')).toBe('fr-FR-DeniseNeural');
    expect(idVoixInterne('fr-FR-DeniseNeural')).toBe('fr-FR-DeniseNeural');
  });

  it('tolère le vide sans lever', () => {
    for (const v of [null, undefined, '']) {
      expect(idVoixPublic(v)).toBe('');
      expect(idVoixInterne(v)).toBe('');
    }
  });
});

describe('routage par préfixe', () => {
  it('reconnaît les DEUX formes, pour que la synthèse parte au bon moteur', () => {
    expect(isHeyGenVoiceId(`${HEYGEN_VOICE_PREFIX}a`)).toBe(true);
    expect(isHeyGenVoiceId(`${PREFIXE_PUBLIC.heygen}a`)).toBe(true);
    expect(isElevenLabsVoiceId(`${ELEVENLABS_VOICE_PREFIX}b`)).toBe(true);
    expect(isElevenLabsVoiceId(`${PREFIXE_PUBLIC.elevenlabs}b`)).toBe(true);
  });

  it('ne confond pas les moteurs entre eux', () => {
    expect(isHeyGenVoiceId(`${PREFIXE_PUBLIC.elevenlabs}b`)).toBe(false);
    expect(isElevenLabsVoiceId(`${PREFIXE_PUBLIC.heygen}a`)).toBe(false);
    expect(isHeyGenVoiceId('fr-FR-DeniseNeural')).toBe(false);
  });
});

describe('ce qui part au navigateur', () => {
  it('aucun identifiant du catalogue statique ne nomme un prestataire', () => {
    const ids = TTS_VOICES.map((v) => v.id).join(' ').toLowerCase();
    for (const n of NOMS_FOURNISSEURS_INTERDITS) expect(ids, n).not.toContain(n);
  });

  it('les voix naturelles gardent une correspondance avec leur ancienne forme', () => {
    const naturelles = TTS_VOICES.filter((v) => (v as { provider?: string }).provider === 'openai');
    expect(naturelles.length).toBeGreaterThan(0);
    for (const v of naturelles) {
      expect(v.id.startsWith(PREFIXE_PUBLIC.openai), v.id).toBe(true);
      // Une sélection enregistrée sous l'ancienne forme retrouve la même voix.
      const ancien = `openai-${v.id.slice(PREFIXE_PUBLIC.openai.length)}`;
      expect(idVoixInterne(ancien)).toBe(idVoixInterne(v.id));
    }
  });
});

describe('chemins d’API neutres', () => {
  it('les alias servent EXACTEMENT les mêmes gestionnaires que les routes historiques', async () => {
    const paires: Array<[string, string, readonly string[]]> = [
      ['@/app/api/voix/avatar/route', '@/app/api/tts/heygen/route', ['GET', 'POST']],
      ['@/app/api/voix/premium/route', '@/app/api/tts/elevenlabs/route', ['GET', 'POST']],
      ['@/app/api/voix/naturelle/route', '@/app/api/tts/openai/route', ['POST']],
      ['@/app/api/voix/standard/route', '@/app/api/tts/edge/route', ['GET', 'POST']],
      ['@/app/api/photos/route', '@/app/api/pexels/route', ['GET']],
    ];
    for (const [alias, historique, methodes] of paires) {
      const a = await import(alias) as Record<string, unknown>;
      const h = await import(historique) as Record<string, unknown>;
      for (const m of methodes) {
        // Même référence de fonction : aucune duplication de logique, et la
        // route historique continue de répondre à l'identique.
        expect(a[m], `${alias}.${m}`).toBe(h[m]);
      }
    }
  });

  it('aucun chemin d’alias ne nomme un prestataire', () => {
    const chemins = ['/api/voix/avatar', '/api/voix/premium', '/api/voix/naturelle', '/api/voix/standard', '/api/photos'];
    for (const c of chemins) {
      for (const n of NOMS_FOURNISSEURS_INTERDITS) expect(c.toLowerCase(), `${c} / ${n}`).not.toContain(n);
    }
  });
});
