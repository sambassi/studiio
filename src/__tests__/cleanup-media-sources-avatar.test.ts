import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le cron de nettoyage NE TOUCHE JAMAIS aux sources d'avatar.
 *
 * `<userId>/avatar/source-…` (original importé, version préparée) est une
 * vidéo : sous la seule règle d'âge, elle partait après 24 h — la source de
 * l'avatar actif comprise. Ces tests prouvent, par le journal des `remove` :
 *   - une source expirée, de forme historique OU récente, survit ;
 *   - ses voisines du même dossier (vidéo générée) suivent la règle
 *     d'avant, inchangée ;
 *   - une clé qui n'a que l'air d'une source (autre sous-dossier) n'est pas
 *     protégée pour autant.
 */

const TROIS_JOURS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const NONCE = '0123456789abcdef0123456789abcdef';

let listing: Record<string, Array<{ name: string; id?: string; created_at?: string }>> = {};
const removed: string[] = [];

vi.mock('@/lib/db/supabase', () => {
  const builder = () => {
    const api: Record<string, unknown> = {
      select: () => api, in: () => api, eq: () => api, gt: () => api, order: () => api, range: () => api,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    };
    return api;
  };
  return {
    supabaseAdmin: {
      from: () => builder(),
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) => ({ data: listing[`${bucket}:${prefix}`] ?? [], error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${path}` } }),
          remove: async (paths: string[]) => { removed.push(...paths); return { data: [], error: null }; },
        }),
      },
    },
  };
});

const { GET } = await import('@/app/api/cron/cleanup-media/route');
const req = () => ({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer secret' : null) } }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = 'secret';
  removed.length = 0;
  listing = {
    'media:': [{ name: U }],
    [`media:${U}`]: [{ name: 'avatar' }, { name: 'library' }],
    [`media:${U}/avatar`]: [
      { name: `source-1700000000000-${NONCE}.webm`, id: 'a', created_at: TROIS_JOURS },
      { name: `source-1700000000001-${NONCE}.mp4`, id: 'b', created_at: TROIS_JOURS },
      { name: 'source-1690000000000.mov', id: 'c', created_at: TROIS_JOURS },
      { name: '11111111-1111-4111-8111-000000000009.mp4', id: 'd', created_at: TROIS_JOURS },
    ],
    [`media:${U}/library`]: [
      { name: `source-1700000000000-${NONCE}.mp4`, id: 'e', created_at: TROIS_JOURS },
    ],
    'audio:': [],
  };
});

describe('Rétention vs sources d’avatar', () => {
  it('⚠️ les sources expirées survivent ; la vidéo générée voisine et le faux « source » de library suivent la règle d’avant', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(removed).not.toContain(`${U}/avatar/source-1700000000000-${NONCE}.webm`);
    expect(removed).not.toContain(`${U}/avatar/source-1700000000001-${NONCE}.mp4`);
    expect(removed).not.toContain(`${U}/avatar/source-1690000000000.mov`);
    expect(removed).toContain(`${U}/avatar/11111111-1111-4111-8111-000000000009.mp4`);
    expect(removed).toContain(`${U}/library/source-1700000000000-${NONCE}.mp4`);
    expect(body.exemptes.sourcesAvatar).toBe(3);
    expect(body.deleted).toBe(2);
  });
});
