import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DELETE /api/posts — un media partage avec un autre post n'est pas supprime.
 *
 * Ce que ces tests protegent : « Dupliquer » recopie les metadonnees telles
 * quelles, donc l'original et sa copie designent les MEMES fichiers. La
 * suppression en cascade emportait tout ce que `collectStorageUrlsFromPost`
 * ramenait — dont le montage, le poster et l'audio encore utilises par
 * l'autre post.
 *
 * La preuve recherchee est la liste des chemins effectivement transmis a
 * `storage.from(bucket).remove(...)`, et les filtres de la lecture.
 */

const authMock = vi.fn();

const USER = 'user-A';
const POST_ID = 'post-1';
const base = 'https://studiio.pro/storage/v1/object/public/media';

interface Call {
  table: string;
  op: 'read' | 'delete';
  filters: Array<[string, string, unknown]>;
  range?: [number, number];
}
const calls: Call[] = [];
const removed: Array<{ bucket: string; paths: string[] }> = [];

let postRow: Record<string, unknown> | null = null;
/** Pages rendues successivement par la lecture des autres posts. */
let autresPages: Array<Array<Record<string, unknown>>> = [];
let autresError: { message: string } | null = null;
let autresThrow = false;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read', filters: [] };
  const result = () => {
    if (table === 'autopilot_config') return { data: [], error: null };
    if (table === 'scheduled_posts' && call.op === 'delete') return { data: null, error: null };
    if (table === 'scheduled_posts' && call.range) {
      if (autresThrow) throw new Error('reseau coupe');
      if (autresError) return { data: null, error: autresError };
      const page = Math.floor(call.range[0] / 1000);
      return { data: autresPages[page] ?? [], error: null };
    }
    return { data: null, error: null };
  };
  const api: Record<string, unknown> = {
    select: () => api,
    delete: () => { call.op = 'delete'; return api; },
    eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return api; },
    neq: (k: string, v: unknown) => { call.filters.push(['neq', k, v]); return api; },
    order: () => api,
    range: (a: number, b: number) => { call.range = [a, b]; return api; },
    single: async () => { calls.push(call); return { data: postRow, error: null }; },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
      calls.push(call);
      try {
        return Promise.resolve(result()).then(onOk, onErr);
      } catch (e) {
        return Promise.reject(e).then(onOk, onErr);
      }
    },
  };
  return api;
}

const storage = {
  from: (bucket: string) => ({
    remove: async (paths: string[]) => {
      removed.push({ bucket, paths: [...paths] });
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
  }),
};

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeQuery(t), storage },
  supabase: { from: (t: string) => makeQuery(t), storage },
}));

const { DELETE } = await import('@/app/api/posts/route');

async function del(id = POST_ID) {
  const res = await DELETE({ url: `https://studiio.pro/api/posts?id=${id}` } as never);
  // La suppression des fichiers est lancee sans attendre : on laisse la
  // file de micro-taches se vider.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, body: await res.json() };
}

const removedPaths = () => removed.flatMap((r) => r.paths.map((p) => `${r.bucket}/${p}`)).sort();
const rowDeleted = () => calls.some((c) => c.table === 'scheduled_posts' && c.op === 'delete');

const META = {
  videoUrl: `${base}/u/montage.webm`,
  posterUrl: `${base}/u/poster.jpg`,
  musicUrl: `${base}/u/music.mp3`,
  thumbnailUrl: `${base}/u/thumb.jpg`,
};

beforeEach(() => {
  calls.length = 0;
  removed.length = 0;
  autresPages = [];
  autresError = null;
  autresThrow = false;
  postRow = { metadata: { ...META } };
  authMock.mockResolvedValue({ user: { id: USER } });
});

describe('DELETE /api/posts — medias partages', () => {
  it('aucun autre post : tous les medias du post sont supprimes (non-regression)', async () => {
    const { status, body } = await del();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(rowDeleted()).toBe(true);
    expect(removedPaths()).toEqual([
      'media/u/montage.webm', 'media/u/music.mp3', 'media/u/poster.jpg', 'media/u/thumb.jpg',
    ]);
  });

  it('post duplique : les fichiers encore references par la copie sont conserves', async () => {
    autresPages = [[
      { id: 'copie', media_url: null, metadata: { videoUrl: META.videoUrl, posterUrl: META.posterUrl } },
    ]];
    await del();
    expect(removedPaths()).toEqual(['media/u/music.mp3', 'media/u/thumb.jpg']);
  });

  it('la comparaison se fait sur la cle, pas sur l URL brute (signee, sans hote)', async () => {
    autresPages = [[
      {
        id: 'copie',
        media_url: '/storage/v1/object/public/media/u/thumb.jpg',
        metadata: {
          videoUrl: 'https://autre.hote/storage/v1/object/sign/media/u/montage.webm?token=abc',
          rushUrls: [{ url: `${base}/u/music.mp3` }],
        },
      },
    ]];
    await del();
    expect(removedPaths()).toEqual(['media/u/poster.jpg']);
  });

  it('photo des cartes et fonds par sequence : supprimes avec le post, conserves si partages', async () => {
    postRow = {
      metadata: {
        cardsSnapshot: { url: `${base}/u/cartes.png`, rect: { x: 0, y: 0, width: 1, height: 1 }, empreinte: 'e' },
        seqBackgrounds: {
          titre: { url: `${base}/u/fond-titre.jpg`, transform: { scale: 1, offsetX: 0, offsetY: 0 } },
          cta: { url: `${base}/u/fond-cta.jpg`, transform: { scale: 1, offsetX: 0, offsetY: 0 } },
        },
      },
    };
    // Un autre post (une copie) utilise encore le fond du CTA.
    autresPages = [[
      { id: 'copie', media_url: null, metadata: { seqBackgrounds: { cta: { url: `${base}/u/fond-cta.jpg` } } } },
    ]];
    await del();
    expect(removedPaths()).toEqual(['media/u/cartes.png', 'media/u/fond-titre.jpg']);
  });

  it('la lecture est restreinte au compte de session et exclut le post supprime', async () => {
    await del();
    const lecture = calls.find((c) => c.table === 'scheduled_posts' && c.range);
    expect(lecture).toBeDefined();
    expect(lecture!.filters).toContainEqual(['eq', 'user_id', USER]);
    expect(lecture!.filters).toContainEqual(['neq', 'id', POST_ID]);
  });

  it('lecture paginee : une reference sur la deuxieme page protege aussi', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `p${String(i).padStart(4, '0')}`, media_url: null, metadata: {},
    }));
    autresPages = [page1, [{ id: 'z', media_url: null, metadata: { musicUrl: META.musicUrl } }]];
    await del();
    const ranges = calls.filter((c) => c.range).map((c) => c.range);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(removedPaths()).toEqual(['media/u/montage.webm', 'media/u/poster.jpg', 'media/u/thumb.jpg']);
  });

  it('lecture des autres posts en erreur : le post est supprime, AUCUN fichier ne l est', async () => {
    autresError = { message: 'db down' };
    const { status, body } = await del();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(rowDeleted()).toBe(true);
    expect(removed).toHaveLength(0);
  });

  it('lecture des autres posts qui leve : le post est supprime, AUCUN fichier ne l est', async () => {
    autresThrow = true;
    const { status } = await del();
    expect(status).toBe(200);
    expect(rowDeleted()).toBe(true);
    expect(removed).toHaveLength(0);
  });
});
