// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/tts/elevenlabs` — les voix clonées du compte sont listées MÊME
 * SANS `ELEVENLABS_API_KEY`.
 *
 * Observé en prod : la voix « Bassi » (table `user_voices`) apparaissait dans
 * l'Autopilote — qui lit `/api/voice/clone`, indépendant de la clé — mais pas
 * dans les sélecteurs de Créer, parce que cette route répondait
 * `{ voices: [], configured: false }` AVANT de lire `user_voices`. Deux
 * écrans, deux listes : l'utilisateur croyait sa voix perdue.
 *
 * La clé ne conditionne que le CATALOGUE public (un appel réseau vers
 * ElevenLabs) ; le rattachement des voix clonées est une donnée locale.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRE = 'bbbbbbbb-2222-4222-8222-222222222222';

const store = vi.hoisted(() => ({
  voix: [] as Array<Record<string, unknown>>,
  lectures: [] as string[],
}));
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async (userId: string) => {
    store.lectures.push(userId);
    return store.voix.filter((v) => v.user_id === userId);
  },
}));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));

const reseau = vi.hoisted(() => ({ appels: [] as string[] }));
globalThis.fetch = vi.fn(async (url: unknown) => {
  reseau.appels.push(String(url));
  throw new Error(`fetch inattendu ${String(url)}`);
}) as unknown as typeof fetch;

// Le cas testé : AUCUNE clé. La variable est retirée avant l'import, et
// `apiKey()` la relit à chaque appel, donc l'ordre ne cache rien.
delete process.env.ELEVENLABS_API_KEY;
const { GET } = await import('@/app/api/tts/elevenlabs/route');

beforeEach(() => {
  store.voix = [
    { id: '44444444-4444-4444-8444-000000000001', user_id: U, provider: 'elevenlabs', provider_voice_id: 'MaVoixClonee01', name: 'Bassi', lang: 'fr', created_at: '2026-08-01' },
    { id: '44444444-4444-4444-8444-000000000009', user_id: AUTRE, provider: 'elevenlabs', provider_voice_id: 'VoixAutrui0001', name: 'Autrui', lang: 'fr', created_at: '2026-08-01' },
  ];
  store.lectures.length = 0;
  reseau.appels.length = 0;
  session.courante = { user: { id: U } };
  delete process.env.ELEVENLABS_API_KEY;
});

describe('GET /api/tts/elevenlabs sans ELEVENLABS_API_KEY', () => {
  it('liste la voix clonée du compte, marquée clonée, avec l identifiant préfixé', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { voices: Array<Record<string, unknown>>; configured: boolean };
    expect(body.voices.map((v) => v.id)).toEqual(['elevenlabs-MaVoixClonee01']);
    expect(body.voices[0]).toMatchObject({ name: 'Bassi (ma voix)', cloned: true, provider: 'elevenlabs', lang: 'fr' });
    // La table est lue pour CE compte — jamais pour un autre.
    expect(store.lectures).toEqual([U]);
  });

  it('dit « non configuré » — la synthèse catalogue reste indisponible — mais ne cache pas les voix clonées', async () => {
    const body = await (await GET()).json() as { voices: unknown[]; configured: boolean };
    expect(body.configured).toBe(false);
    expect(body.voices).toHaveLength(1);
  });

  it('ne va PAS chercher le catalogue : aucun appel réseau sans clé', async () => {
    await GET();
    expect(reseau.appels).toEqual([]);
  });

  it('la voix clonée d’un AUTRE compte n’est pas listée', async () => {
    session.courante = { user: { id: AUTRE } };
    const body = await (await GET()).json() as { voices: Array<{ id: string }> };
    expect(body.voices.map((v) => v.id)).toEqual(['elevenlabs-VoixAutrui0001']);
  });

  it('un compte sans voix clonée et sans clé → liste vide, non configuré, pas une erreur', async () => {
    store.voix = [];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voices: [], configured: false });
  });

  it('sans session → 401, et la table n’est pas lue', async () => {
    session.courante = null;
    expect((await GET()).status).toBe(401);
    expect(store.lectures).toEqual([]);
  });

  it('le genre n’est pas inventé : `user_voices` ne le connaît pas', async () => {
    // Avant, chaque voix clonée était « Female » en dur — faux pour la moitié
    // des comptes, et affiché « F » dans le sélecteur.
    const body = await (await GET()).json() as { voices: Array<{ gender: string }> };
    expect(body.voices[0].gender).toBe('Neutral');
  });
});
