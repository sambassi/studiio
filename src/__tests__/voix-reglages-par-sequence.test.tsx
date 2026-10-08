/**
 * Voix-off — vitesse et dynamisme PAR SÉQUENCE.
 *
 * Stockés par séquence, utilisés à la génération suivante, traduits pour
 * chaque moteur (Edge `rate`, ElevenLabs `voice_settings`, OpenAI / HeyGen
 * `speed`). Un réglage changé ne touche jamais l'audio existant : il est
 * signalé « périmé ». AUCUN appel réel : `fetch` est doublé partout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  normaliserReglages, memesReglages, rateEdge, audioSequencePerime, voiceSettingsElevenLabs,
  emptySequenceVoices, emptySequenceVoicesUserEdited, type SequenceKey, type SequenceVoice,
} from '@/lib/types/voice';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('réglages : bornés, arrondis, défaut = rien', () => {
  it('bornes et pas', () => {
    expect(normaliserReglages({ vitesse: 1.13, dynamisme: 0.47 })).toEqual({ vitesse: 1.15, dynamisme: 0.5 });
    expect(normaliserReglages({ vitesse: 9, dynamisme: -3 })).toEqual({ vitesse: 1.2, dynamisme: 0 });
    expect(normaliserReglages({ vitesse: 1, dynamisme: 0 })).toBeUndefined();
    expect(normaliserReglages('x')).toBeUndefined();
  });
  it('comparaison : absent = défaut', () => {
    expect(memesReglages(undefined, { vitesse: 1, dynamisme: 0 })).toBe(true);
    expect(memesReglages({ vitesse: 1.1, dynamisme: 0 }, undefined)).toBe(false);
  });
  it('traductions moteur', () => {
    expect(rateEdge(1.1)).toBe('+10%');
    expect(rateEdge(0.85)).toBe('-15%');
    expect(voiceSettingsElevenLabs({ vitesse: 1.1, dynamisme: 0.6 })).toEqual({
      stability: 0.32, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true, speed: 1.1,
    });
  });
});

describe('14. réglage changé → audio signalé périmé, jamais remplacé', () => {
  const sv = (patch: Partial<SequenceVoice>): SequenceVoice => ({
    text: 'Bonjour', audioUrl: 'https://x/a.mp3', source: 'tts', ttsVoice: 'v', textAtGeneration: 'Bonjour', ...patch,
  });
  it('réglages identiques à ceux de la génération : pas périmé', () => {
    expect(audioSequencePerime(sv({ reglages: { vitesse: 1.1, dynamisme: 0 }, reglagesAtGeneration: { vitesse: 1.1, dynamisme: 0 } }), 'v').perime).toBe(false);
  });
  it('vitesse ou dynamisme changés : périmé, motif « reglages »', () => {
    expect(audioSequencePerime(sv({ reglages: { vitesse: 1.2, dynamisme: 0 }, reglagesAtGeneration: { vitesse: 1.1, dynamisme: 0 } }), 'v'))
      .toEqual({ perime: true, motif: 'reglages' });
    expect(audioSequencePerime(sv({ reglages: { vitesse: 1, dynamisme: 0.5 } }), 'v').motif).toBe('reglages');
  });
  it('audio ancien sans réglages : jamais signalé à tort ; enregistrement micro : jamais', () => {
    expect(audioSequencePerime(sv({}), 'v').perime).toBe(false);
    expect(audioSequencePerime(sv({ source: 'record', reglages: { vitesse: 1.2, dynamisme: 0 } }), 'v').perime).toBe(false);
  });
});

describe('11-13. panneau : stocké PAR séquence, « appliquer à toutes »', () => {
  async function monter(voices = emptySequenceVoices()) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, voices: [] }) })));
    const { SequenceVoicesPanel } = await import('@/components/creer/SequenceVoicesPanel');
    const onChange = vi.fn();
    const noop = () => {};
    render(
      <SequenceVoicesPanel
        sequenceVoices={voices} userEdited={emptySequenceVoicesUserEdited()}
        onChange={onChange} onUserEditedChange={noop} onResetText={noop}
        introDuration={4} cardsDuration={6} videoDuration={4} ctaDuration={4}
        hasCardsContent hasVideoOverlay batchCount={1}
        voiceId="elevenlabs-voixclonee01" onVoiceIdChange={noop}
      />,
    );
    return onChange;
  }
  const curseur = (nom: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${nom}"]`)!;

  it('11. la vitesse de « Cartes » ne touche que « cartes »', async () => {
    const onChange = await monter();
    fireEvent.change(curseur('Vitesse de la voix — Cartes'), { target: { value: '110' } });
    expect(onChange).toHaveBeenCalledWith('cartes', { reglages: { vitesse: 1.1, dynamisme: 0 } });
    expect(onChange.mock.calls.every((c) => (c[0] as SequenceKey) === 'cartes')).toBe(true);
  });

  it('12. le dynamisme du CTA est stocké sur « cta »', async () => {
    const onChange = await monter();
    fireEvent.change(curseur('Dynamisme de la voix — CTA'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('cta', { reglages: { vitesse: 1, dynamisme: 0.7 } });
  });

  it('13. « Appliquer ces réglages à toutes les voix » copie ceux de la séquence sur les trois autres', async () => {
    const voices = emptySequenceVoices();
    voices.titre = { ...voices.titre, reglages: { vitesse: 1.15, dynamisme: 0.4 } };
    const onChange = await monter(voices);
    fireEvent.click(document.querySelector('[data-voice-reglages-tous="titre"]')!);
    for (const k of ['cartes', 'video', 'cta'] as const) {
      expect(onChange).toHaveBeenCalledWith(k, { reglages: { vitesse: 1.15, dynamisme: 0.4 } });
    }
    expect(onChange).not.toHaveBeenCalledWith('titre', expect.anything());
  });
});

describe('15. client : chaque moteur reçoit le bon paramètre (fetch doublé, aucun appel réel)', () => {
  const appels: Array<{ url: string; corps: Record<string, unknown> }> = [];
  beforeEach(() => {
    appels.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url: String(url), corps: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }));
  });
  const R = { vitesse: 1.1, dynamisme: 0.5 };

  it('Edge : rate « +10% »', async () => {
    const { synthesize } = await import('@/lib/tts/edge-tts-client');
    await synthesize('Bonjour', 'fr-FR-DeniseNeural', { reglages: R }).catch(() => { /* seule la requête envoyée compte ici */ });
    expect(appels[0].url).toBe('/api/tts/edge');
    expect(appels[0].corps.rate).toBe('+10%');
  });
  it('ElevenLabs : les réglages partent au serveur', async () => {
    const { synthesize } = await import('@/lib/tts/edge-tts-client');
    await synthesize('Bonjour', 'elevenlabs-voixclonee01', { reglages: R }).catch(() => { /* seule la requête envoyée compte ici */ });
    expect(appels[0].url).toBe('/api/tts/elevenlabs');
    expect(appels[0].corps.reglages).toEqual(R);
  });
  it('OpenAI : speed', async () => {
    const { synthesize, TTS_VOICES } = await import('@/lib/tts/edge-tts-client');
    const openai = TTS_VOICES.find((v) => v.provider === 'openai')!;
    await synthesize('Bonjour', openai.id, { reglages: R }).catch(() => { /* seule la requête envoyée compte ici */ });
    expect(appels[0].corps.speed).toBe(1.1);
  });
  it('sans réglage : requêtes d’avant (aucun champ ajouté)', async () => {
    const { synthesize } = await import('@/lib/tts/edge-tts-client');
    await synthesize('Bonjour', 'elevenlabs-voixclonee01').catch(() => { /* seule la requête envoyée compte ici */ });
    expect(appels[0].corps).toEqual({ text: 'Bonjour', voice: 'elevenlabs-voixclonee01' });
  });
});
