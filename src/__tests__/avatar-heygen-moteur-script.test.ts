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

const { generateAvatarVideo, moteursSupportesDuLook, infosDuLook } = await import('@/lib/avatar/heygen');

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

describe('moteursSupportesDuLook — `supported_api_engines` (lecture gratuite, simulée)', () => {
  const repondre = (corpsReponse: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => (
    { ok, status: ok ? 200 : 500, json: async () => corpsReponse, text: async () => JSON.stringify(corpsReponse) } as unknown as Response
  )));

  it('⚠️ lit les moteurs confirmés ; ignore les valeurs inconnues', async () => {
    repondre({ data: { supported_api_engines: ['avatar_iv', 'avatar_v', 'autre'] } });
    expect(await moteursSupportesDuLook('look-a', 1)).toEqual(['avatar_iv', 'avatar_v']);
  });
  it('⚠️ réponse muette ou appel en échec : `null` — jamais un moteur supposé', async () => {
    repondre({ data: { status: 'completed' } });
    expect(await moteursSupportesDuLook('look-b', 1)).toBeNull();
    repondre({ error: 'x' }, false);
    expect(await moteursSupportesDuLook('look-c', 1)).toBeNull();
  });
  it('mémorisé 10 min par look (une lecture, pas une par clic)', async () => {
    repondre({ data: { supported_api_engines: ['avatar_iv'] } });
    await moteursSupportesDuLook('look-d', 1000);
    await moteursSupportesDuLook('look-d', 1000 + 5 * 60_000);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

describe('Cadrage HeyGen — `fit`', () => {
  it('⚠️ `cadrage: cover` → `fit: "cover"` envoyé (le format est rempli, jamais de bandes)', async () => {
    await generateAvatarVideo({ avatarId: 'look', script: 'Bonjour', voiceId: 'voix', aspectRatio: '9:16', cadrage: 'cover' });
    expect(corps[0]).toMatchObject({ aspect_ratio: '9:16', fit: 'cover' });
  });
  it('sans cadrage : aucun champ `fit` (corps d’avant)', async () => {
    await generateAvatarVideo({ avatarId: 'look', script: 'Bonjour', voiceId: 'voix' });
    expect(corps[0]).not.toHaveProperty('fit');
  });
});

describe('infosDuLook — orientation native (`preferred_orientation`)', () => {
  it('lit l’orientation et les moteurs en UNE lecture ; valeur inconnue → null', async () => {
    const rep = (b: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) } as unknown as Response));
    vi.stubGlobal('fetch', rep({ data: { supported_api_engines: ['avatar_iv'], preferred_orientation: 'landscape' } }));
    expect(await infosDuLook('look-o1', 1)).toEqual({ moteurs: ['avatar_iv'], orientation: 'landscape' });
    vi.stubGlobal('fetch', rep({ data: { supported_api_engines: [], preferred_orientation: 'diagonale' } }));
    expect(await infosDuLook('look-o2', 1)).toEqual({ moteurs: [], orientation: null });
  });
});
