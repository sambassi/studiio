// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `generateAvatarVideo` (texte + voix HeyGen) — le moteur de rendu.
 *
 * Doc HeyGen (developers.heygen.com, « models ») : sans `engine`, le
 * fournisseur prend Avatar IV. Le moteur n'est donc posé QUE sur demande
 * explicite (qualité choisie) ; sans demande, le corps est strictement
 * celui d'avant. `fetch` simulé : aucun appel réel.
 */
const corps: Array<Record<string, unknown>> = [];
beforeEach(() => {
  corps.length = 0;
  process.env.HEYGEN_API_KEY = 'cle-de-test';
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    corps.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 200, json: async () => ({ video_id: 'v1', status: 'pending', data: { video_id: 'v1', status: 'pending' } }), text: async () => JSON.stringify({ data: { video_id: 'v1', status: 'pending' } }) } as unknown as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const { generateAvatarVideo } = await import('@/lib/avatar/heygen');

describe('generateAvatarVideo — moteur', () => {
  it('⚠️ sans moteur demandé : aucun champ `engine` (corps inchangé)', async () => {
    await generateAvatarVideo({ avatarId: 'look', script: 'Bonjour', voiceId: 'voix' });
    expect(corps[0]).not.toHaveProperty('engine');
  });
  it('⚠️ moteur demandé : `engine: { type }` explicite', async () => {
    await generateAvatarVideo({ avatarId: 'look', script: 'Bonjour', voiceId: 'voix', moteur: 'avatar_iii' });
    expect(corps[0].engine).toEqual({ type: 'avatar_iii' });
  });
});
