import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sources d'avatar ORPHELINES : un visage n'est pas gardé sans usage.
 *
 *   - référencée par une identité ou une version (source, original) → gardée ;
 *   - non référencée mais récente (< 7 jours : préparation en cours) → gardée ;
 *   - non référencée et ancienne → retirée ;
 *   - références illisibles (table des versions pas encore migrée, panne)
 *     → TOUT est gardé, rien n'est deviné.
 */

const DIX_JOURS = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
const DEUX_JOURS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const N = '0123456789abcdef0123456789abcdef';
const ACTIVE = `${U}/avatar/source-1700000000001-${N}.mp4`;
const ORIGINAL = `${U}/avatar/source-1700000000002-${N}.webm`;
const ORPHELINE = `${U}/avatar/source-1700000000003-${N}.mp4`;
const RECENTE = `${U}/avatar/source-1700000000004-${N}.mp4`;

const tables = { user_avatars: [] as unknown[], avatar_versions: [] as unknown[], erreurVersions: false };
const removed: string[] = [];

vi.mock('@/lib/db/supabase', () => {
  const builder = (table: string) => {
    const resultat = () => {
      if (table === 'avatar_versions' && tables.erreurVersions) return { data: null, error: { message: 'relation "avatar_versions" does not exist' } };
      if (table === 'user_avatars') return { data: tables.user_avatars, error: null };
      if (table === 'avatar_versions') return { data: tables.avatar_versions, error: null };
      return { data: [], error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api, in: () => api, eq: () => api, gt: () => api, order: () => api, range: () => api, limit: () => api,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultat()).then(ok, ko),
    };
    return api;
  };
  return {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) => ({ data: (listing as Record<string, unknown>)[`${bucket}:${prefix}`] ?? [], error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${path}` } }),
          remove: async (paths: string[]) => { removed.push(...paths); return { data: [], error: null }; },
        }),
      },
    },
  };
});

const listing: Record<string, unknown> = {
  'media:': [{ name: U }],
  [`media:${U}`]: [{ name: 'avatar' }],
  [`media:${U}/avatar`]: [
    { name: ACTIVE.split('/')[2], id: '1', created_at: DIX_JOURS },
    { name: ORIGINAL.split('/')[2], id: '2', created_at: DIX_JOURS },
    { name: ORPHELINE.split('/')[2], id: '3', created_at: DIX_JOURS },
    { name: RECENTE.split('/')[2], id: '4', created_at: DEUX_JOURS },
  ],
  'audio:': [],
};

const { GET } = await import('@/app/api/cron/cleanup-media/route');
const req = () => ({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer secret' : null) } }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = 'secret';
  removed.length = 0;
  tables.user_avatars = [{ source_object_key: ACTIVE }];
  tables.avatar_versions = [{ source_object_key: ACTIVE, original_source_object_key: ORIGINAL }];
  tables.erreurVersions = false;
});

describe('Sources d’avatar orphelines', () => {
  it('⚠️ référencées (active, original) et récentes gardées ; l’orpheline ancienne retirée', async () => {
    const body = await (await GET(req())).json();
    expect(removed).toEqual([ORPHELINE]);
    expect(body.exemptes.sourcesAvatarOrphelinesRetirees).toBe(1);
  });

  it('⚠️ références illisibles (versions non migrées) → rien n’est retiré', async () => {
    tables.erreurVersions = true;
    await GET(req());
    expect(removed).toEqual([]);
  });
});
