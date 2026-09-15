// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `POST /api/tts/elevenlabs` — une voix n'est synthétisée que si elle est
 * la MIENNE (user_voices du compte, ElevenLabs, utilisable) ou PUBLIQUE
 * (catalogue partagé). La voix clonée d'autrui, un identifiant inconnu ou
 * forgé : 404, et le fournisseur n'est PAS appelé. Les voix publiques que
 * Créer utilise aujourd'hui continuent de marcher.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const MIENNE = 'MaVoixClonee01';
const AUTRUI = 'VoixAutrui0001';
const PUBLIQUE = 'PubliqueRachel';

const store = vi.hoisted(() => ({ voix: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async (userId: string) => store.voix.filter((v) => v.user_id === userId),
}));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));

const eleven = vi.hoisted(() => ({ syntheses: [] as string[], listes: 0 }));
globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://api.elevenlabs.io/v2/voices')) {
    eleven.listes += 1;
    return new Response(JSON.stringify({ voices: [
      { voice_id: PUBLIQUE, name: 'Rachel', category: 'premade', labels: { language: 'fr' } },
      // Une voix clonée d'AUTRUI est dans le compte partagé : le catalogue la FILTRE.
      { voice_id: AUTRUI, name: 'Autrui', category: 'cloned', labels: {} },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    eleven.syntheses.push(u);
    void init;
    return new Response(Buffer.from('AUDIO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';
const { POST } = await import('@/app/api/tts/elevenlabs/route');

const synth = (voice: string, text = 'Bonjour') =>
  POST(new NextRequest('https://studiio.pro/api/tts/elevenlabs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) }));

beforeEach(() => {
  store.voix = [
    { id: '44444444-4444-4444-8444-000000000001', user_id: U, provider: 'elevenlabs', provider_voice_id: MIENNE, name: 'Moi', lang: 'fr', created_at: '2026-08-01' },
    { id: '44444444-4444-4444-8444-000000000009', user_id: 'bbbbbbbb-2222-4222-8222-222222222222', provider: 'elevenlabs', provider_voice_id: AUTRUI, name: 'Autrui', lang: 'fr', created_at: '2026-08-01' },
  ];
  eleven.syntheses.length = 0;
  session.courante = { user: { id: U } };
});

describe('POST /api/tts/elevenlabs — autorisation de la voix', () => {
  it('1. voix clonée du compte → synthèse, avec et sans préfixe client', async () => {
    expect((await synth(`elevenlabs-${MIENNE}`)).status).toBe(200);
    expect((await synth(MIENNE)).status).toBe(200);
    expect(eleven.syntheses).toHaveLength(2);
    expect(eleven.syntheses[0]).toContain(`/v1/text-to-speech/${MIENNE}?`);
  });

  it('⚠️ 2. voix clonée d’un AUTRE utilisateur → 404, aucun appel de synthèse (même si elle est dans le compte ElevenLabs partagé)', async () => {
    const res = await synth(`elevenlabs-${AUTRUI}`);
    expect(res.status).toBe(404);
    expect(eleven.syntheses).toEqual([]);
  });

  it('3. voix publique du catalogue → synthèse (Créer non régressé)', async () => {
    expect((await synth(`elevenlabs-${PUBLIQUE}`)).status).toBe(200);
    expect(eleven.syntheses[0]).toContain(`/v1/text-to-speech/${PUBLIQUE}?`);
  });

  it('⚠️ 4. voice_id inconnu (bien formé) → 404, aucun appel ; 5. malformé → 400, aucun appel', async () => {
    expect((await synth('InconnuMaisBienForme')).status).toBe(404);
    expect((await synth('a/b')).status).toBe(400);
    expect((await synth('court')).status).toBe(400);
    expect((await synth('')).status).toBe(400);
    expect(eleven.syntheses).toEqual([]);
  });

  it('7. le préfixe client ne contourne rien : préfixe doublé, préfixe seul, préfixe + voix d’autrui', async () => {
    expect((await synth(`elevenlabs-elevenlabs-${MIENNE}`)).status).toBe(404);
    expect((await synth('elevenlabs-')).status).toBe(400);
    expect((await synth(`elevenlabs-${AUTRUI}`)).status).toBe(404);
    expect(eleven.syntheses).toEqual([]);
  });

  it('8. sans session → 401, aucun appel ; 6. aucun refus n’atteint le fournisseur', async () => {
    session.courante = null;
    expect((await synth(MIENNE)).status).toBe(401);
    expect(eleven.syntheses).toEqual([]);
  });

  it('10. voix clonée du compte mais inutilisable (provider inconnu) → 404', async () => {
    store.voix = [{ ...store.voix[0], provider: 'heygen' }];
    expect((await synth(MIENNE)).status).toBe(404);
    expect(eleven.syntheses).toEqual([]);
  });

  it('9. la voix personnelle d’un compte n’est jamais « publique » pour un autre : l’autorisation lit user_voices AVANT le catalogue', async () => {
    // Autrui possède MIENNE ? Non : elle est à moi ; pour lui, elle est inconnue.
    session.courante = { user: { id: 'bbbbbbbb-2222-4222-8222-222222222222' } };
    expect((await synth(MIENNE)).status).toBe(404);
    expect((await synth(AUTRUI)).status).toBe(200);
    expect(eleven.syntheses).toHaveLength(1);
  });
});
