// @vitest-environment node
/**
 * Routes TTS — réglages de voix par séquence, côté serveur (fetch doublé,
 * aucun appel réel).
 *  - ElevenLabs : `reglages` → `voice_settings` bornés ; sans réglage, la
 *    requête d'avant au caractère près.
 *  - Edge : `rate` / `pitch` partent tels quels dans le SSML de msedge-tts —
 *    seule la forme attendue passe (« +10% », « -5Hz »).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const VOIX = 'MaVoixClonee01';
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async () => [{ id: '44444444-4444-4444-8444-000000000001', user_id: U, provider: 'elevenlabs', provider_voice_id: VOIX, name: 'Moi', lang: 'fr', created_at: '2026-08-01' }],
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));
vi.mock('@/lib/voice/profil', async (orig) => ({
  ...(await orig<typeof import('@/lib/voice/profil')>()),
  prononciationsDuCompte: async () => [],
  texteParleDuCompte: async (_u: string, t: string) => t,
}));
const prosodies = vi.hoisted(() => ({ liste: [] as Array<Record<string, unknown>> }));
vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3' },
  MsEdgeTTS: class {
    async setMetadata() {}
    toStream(_t: string, opts: Record<string, unknown>) {
      prosodies.liste.push(opts);
      const { Readable } = require('stream');
      return { audioStream: Readable.from([Buffer.alloc(2000, 1)]) };
    }
    close() {}
  },
}));

const corps = vi.hoisted(() => ({ liste: [] as Array<Record<string, unknown>> }));
globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  if (!String(url).startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) throw new Error(`fetch inattendu ${String(url)}`);
  corps.liste.push(JSON.parse(String(init?.body)));
  return new Response(Buffer.from('AUDIO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}) as unknown as typeof fetch;
process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const poster = async (route: string, body: Record<string, unknown>) => {
  const { POST } = await import(`@/app/api/tts/${route}/route`);
  return POST(new NextRequest(`https://studiio.pro/api/tts/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
};

beforeEach(() => { corps.liste.length = 0; prosodies.liste.length = 0; });

describe('ElevenLabs : voice_settings depuis les réglages', () => {
  it('réglages → voice_settings (speed, style, stabilité), bornés', async () => {
    await poster('elevenlabs', { text: 'Bonjour', voice: `elevenlabs-${VOIX}`, reglages: { vitesse: 1.15, dynamisme: 0.6 } });
    expect(corps.liste[0].voice_settings).toEqual({ stability: 0.32, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true, speed: 1.15 });
  });
  it('valeurs hors bornes : ramenées', async () => {
    await poster('elevenlabs', { text: 'Bonjour', voice: `elevenlabs-${VOIX}`, reglages: { vitesse: 5, dynamisme: 9 } });
    expect(corps.liste[0].voice_settings).toMatchObject({ speed: 1.2, style: 1 });
  });
  it('sans réglage (ou réglage par défaut) : la requête d’avant, sans voice_settings', async () => {
    await poster('elevenlabs', { text: 'Bonjour', voice: `elevenlabs-${VOIX}` });
    await poster('elevenlabs', { text: 'Bonjour', voice: `elevenlabs-${VOIX}`, reglages: { vitesse: 1, dynamisme: 0 } });
    for (const c of corps.liste) expect(c).toEqual({ text: 'Bonjour', model_id: 'eleven_multilingual_v2' });
  });
});

describe('Edge : rate / pitch validés avant le SSML', () => {
  it('« +10% » passe', async () => {
    await poster('edge', { text: 'Bonjour', voice: 'fr-FR-DeniseNeural', rate: '+10%', pitch: '+0Hz' });
    expect(prosodies.liste[0]).toMatchObject({ rate: '+10%', pitch: '+0Hz' });
  });
  it('une valeur piégée n’atteint jamais le SSML', async () => {
    await poster('edge', { text: 'Bonjour', voice: 'fr-FR-DeniseNeural', rate: '0%"><voice name="x">', pitch: 'x"/>' });
    expect(prosodies.liste[0]?.rate).toBeUndefined();
    expect(prosodies.liste[0]?.pitch).toBeUndefined();
  });
});
