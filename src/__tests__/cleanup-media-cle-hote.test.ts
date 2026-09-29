import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le cron protège les médias de post par CLÉ de stockage, quel que soit
 * l'hôte des URL persistées — et ne protège jamais MOINS qu'avant.
 */

const TROIS_JOURS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

let scheduledPosts: unknown[] = [];
let listing: Record<string, Array<{ name: string; id?: string; created_at?: string }>> = {};
const removed: string[] = [];

function tableResult(table: string): { data: unknown; error: unknown } {
  switch (table) {
    case 'scheduled_posts': return { data: scheduledPosts, error: null };
    case 'autopilot_config':
    case 'rushes':
    case 'rush_analyses':
    case 'creer_draft_rushes': return { data: [], error: null };
    default: throw new Error(`table inattendue: ${table}`);
  }
}

function builder(table: string) {
  const api: Record<string, unknown> = {
    select: () => api, in: () => api, eq: () => api, gt: () => api, order: () => api, range: () => api,
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(tableResult(table)).then(onOk, onErr),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({ data: listing[`${bucket}:${prefix}`] ?? [], error: null }),
        // L'hôte de PRODUCTION, comme `NEXT_PUBLIC_APP_URL=https://studiio.pro`.
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${path}` },
        }),
        remove: async (paths: string[]) => { removed.push(...paths); return { data: paths.map(() => ({})), error: null }; },
      }),
    },
  },
}));

const { GET } = await import('@/app/api/cron/cleanup-media/route');
const req = () => ({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer secret' : null) } }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = 'secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
  scheduledPosts = [];
  removed.length = 0;
  listing = {
    'media:': [{ name: 'u1' }],
    'media:u1': [{ name: 'rendus' }, { name: 'library' }],
    'media:u1/rendus': [
      { name: 'x.webm', id: 'x', created_at: TROIS_JOURS },
      { name: 'orphelin.webm', id: 'o', created_at: TROIS_JOURS },
    ],
    'media:u1/library': [
      { name: 'rush.mp4', id: 'r', created_at: TROIS_JOURS },
      { name: 'fond.jpg', id: 'f', created_at: new Date(Date.now() - 30 * 24 * 3600e3).toISOString() },
    ],
    'audio:': [],
  };
});

describe('cleanup-media — protection par clé', () => {
  it('URL du post sous l\'hôte STAGING : le rendu est protégé malgré NEXT_PUBLIC_APP_URL=prod', async () => {
    scheduledPosts = [{
      media_url: null,
      metadata: { videoUrl: 'https://staging.studiio.pro/storage/v1/object/public/media/u1/rendus/x.webm' },
    }];
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(removed).not.toContain('u1/rendus/x.webm');
    expect(removed).toContain('u1/rendus/orphelin.webm');
    expect(body.exemptes.posts).toBe(1);
  });

  it('rush en objet { url } et fond par séquence : protégés par clé', async () => {
    scheduledPosts = [{
      media_url: null,
      metadata: {
        rushUrls: [],
        seqBackgrounds: { intro: { url: 'https://www.studiio.pro/storage/v1/object/public/media/u1/library/fond.jpg' } },
        rawVideoUrl: 'https://old.supabase.co/storage/v1/object/public/media/u1/library/rush.mp4',
      },
    }];
    await GET(req());
    expect(removed).not.toContain('u1/library/fond.jpg');
    expect(removed).not.toContain('u1/library/rush.mp4');
  });

  it('aucune régression : l\'URL de même hôte reste protégée (repli historique inclus)', async () => {
    scheduledPosts = [{
      media_url: 'https://studiio.pro/storage/v1/object/public/media/u1/rendus/x.webm',
      metadata: { posterUrl: 'https://studiio.pro/storage/v1/object/public/media/u1/library/fond.jpg' },
    }];
    await GET(req());
    expect(removed).not.toContain('u1/rendus/x.webm');
    expect(removed).not.toContain('u1/library/fond.jpg');
    expect(removed).toContain('u1/rendus/orphelin.webm');
  });

  it('sans référence, les fichiers expirés partent comme avant', async () => {
    await GET(req());
    expect(removed.sort()).toEqual(
      ['u1/library/fond.jpg', 'u1/library/rush.mp4', 'u1/rendus/orphelin.webm', 'u1/rendus/x.webm'],
    );
  });
});
