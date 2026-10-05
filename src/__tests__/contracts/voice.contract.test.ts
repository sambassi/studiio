/**
 * CONTRAT — VOIX CLONÉE (EN_VALIDATION, pas encore LOCKED).
 * La voix d'un compte n'est jamais utilisée par un autre ; une voix inconnue
 * n'entraîne AUCUN appel payant ; la bonne voix part, sans préfixe, une fois.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const VOIX_U = '44444444-4444-4444-8444-000000000001';
const VOIX_AUTRUI = '44444444-4444-4444-8444-000000000002';
const ABC = 'abc12345678';
const ZZZ = 'zzz98765432';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ voices: [] as Ligne[] }));
vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_voices' ? base.voices : [];
    const filtres: Array<(l: Ligne) => boolean> = [];
    let limite: number | undefined;
    const exec = () => {
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map((l) => ({ ...l })), error: null };
    };
    const api = {
      select() { return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { return api; },
      async limit(n: number) { limite = n; return exec(); },
      then(ok: (v: unknown) => void, ko: (e: unknown) => void) { return Promise.resolve().then(exec).then(ok, ko); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});
vi.mock('@/lib/storage/upload', () => ({ uploadToStorage: async (a: { storagePath: string }) => `https://stockage.test/${a.storagePath}` }));
vi.mock('@remotion/media-parser', () => ({ parseMedia: async () => ({ durationInSeconds: 3 }) }));

import { resoudreVoixParIdentifiant } from '@/lib/voice/profil';
import { buildAutopilotVoices } from '@/lib/autopilot/voice';
import type { PreparedPost } from '@/lib/autopilot/engine';

const voix = (id: string, userId: string, p: string): Ligne => ({
  id, user_id: userId, provider: 'elevenlabs', provider_voice_id: p, name: 'Ma voix', lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});
const POST = {
  title: 't', caption: '', scheduledDate: '2026-10-05', scheduledTime: '18:00', platforms: [],
  content: { title: 'Bonjour', subtitle: '', tagLine: '', cards: [] },
  voiceSequences: ['titre'],
} as unknown as PreparedPost;

let appels: string[] = [];
beforeEach(() => {
  appels = [];
  base.voices = [voix(VOIX_U, USER, ABC), voix(VOIX_AUTRUI, AUTRUI, ZZZ)];
  vi.stubEnv('ELEVENLABS_API_KEY', 'cle-de-test');
  vi.stubEnv('ELEVENLABS_VOICE_ID', 'voixServeurDefaut');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.startsWith('https://api.elevenlabs.io/')) appels.push(u);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]).buffer, text: async () => '', json: async () => ({}) };
  }));
});

describe('VOIX — appartenance au compte', () => {
  it('ma voix (UUID ou elevenlabs-<id>) → mon provider_voice_id', async () => {
    expect(await resoudreVoixParIdentifiant(USER, VOIX_U)).toEqual({ providerVoiceId: ABC, userVoiceId: VOIX_U });
    expect(await resoudreVoixParIdentifiant(USER, `elevenlabs-${ABC}`)).toEqual({ providerVoiceId: ABC, userVoiceId: VOIX_U });
  });
  it('voix d’un autre compte ou inconnue → refusée, AUCUN appel ElevenLabs', async () => {
    expect(await resoudreVoixParIdentifiant(USER, VOIX_AUTRUI)).toBeNull();
    expect(await resoudreVoixParIdentifiant(USER, `elevenlabs-${ZZZ}`)).toBeNull();
    expect(await buildAutopilotVoices({ userId: USER, jobId: 'c1', post: POST, voiceId: `elevenlabs-${ZZZ}` })).toEqual({});
    expect(appels).toEqual([]);
  });
  it('ma voix → un seul appel, avec l’identifiant nu (jamais le préfixe)', async () => {
    await buildAutopilotVoices({ userId: USER, jobId: 'c2', post: POST, voiceId: `elevenlabs-${ABC}` });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toContain(`/v1/text-to-speech/${ABC}?`);
  });
});
