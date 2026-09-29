import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/media/delete` — un média utilisé par un contenu n'est JAMAIS
 * supprimé depuis la Médiathèque.
 *
 * Le stockage et PostgREST sont simulés ; le journal des `remove` est la
 * seule preuve qui vaille.
 */

const UID = 'u1';
const HOTE = 'https://staging.studiio.pro/storage/v1/object/public';

let posts: unknown[] = [];
let postsError: unknown = null;
let autopilotRows: unknown[] = [];
let draftRows: unknown[] = [];
let rushesRows: unknown[] = [];
let analysesRows: unknown[] = [];
const removed: Array<{ bucket: string; paths: string[] }> = [];
const filtres: Array<{ table: string; col: string; val: unknown }> = [];

function tableResult(table: string): { data: unknown; error: unknown } {
  switch (table) {
    case 'scheduled_posts': return postsError ? { data: null, error: postsError } : { data: posts, error: null };
    case 'autopilot_config': return { data: autopilotRows, error: null };
    case 'creer_draft_rushes': return { data: draftRows, error: null };
    case 'rushes': return { data: rushesRows, error: null };
    case 'rush_analyses': return { data: analysesRows, error: null };
    default: throw new Error(`table inattendue: ${table}`);
  }
}

function builder(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    eq: (col: string, val: unknown) => { filtres.push({ table, col, val }); return api; },
    gt: () => api,
    order: () => api,
    range: () => api,
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(tableResult(table)).then(onOk, onErr),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: UID } }) }));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => { removed.push({ bucket, paths }); return { data: paths.map(() => ({})), error: null }; },
      }),
    },
  },
}));

const { POST } = await import('@/app/api/media/delete/route');

const req = (body: unknown) => ({ json: async () => body }) as never;
const tousSupprimes = () => removed.flatMap((r) => r.paths.map((p) => `${r.bucket}/${p}`));

beforeEach(() => {
  posts = [];
  postsError = null;
  autopilotRows = [];
  draftRows = [];
  rushesRows = [];
  analysesRows = [];
  removed.length = 0;
  filtres.length = 0;
});

describe('Suppression d\'un média référencé', () => {
  it('rendu d\'un post brouillon → 409, message FR, remove JAMAIS appelé', async () => {
    posts = [{ id: 'p1', media_url: null, metadata: { videoUrl: `${HOTE}/media/${UID}/rendus/x.webm` } }];
    const res = await POST(req({ bucket: 'media', path: `${UID}/rendus/x.webm` }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('utilisé par un contenu');
    expect(body.refuses[0].motif).toBe('post');
    expect(removed).toHaveLength(0);
  });

  it('les références sont lues pour le SEUL compte connecté', async () => {
    await POST(req({ bucket: 'media', path: `${UID}/library/libre.mp4` }));
    const tables = new Set(filtres.filter((f) => f.col === 'user_id' && f.val === UID).map((f) => f.table));
    expect([...tables].sort()).toEqual(
      ['autopilot_config', 'creer_draft_rushes', 'rush_analyses', 'rushes', 'scheduled_posts'],
    );
  });

  it('un logo ou un fond enfoui dans la metadata protège aussi', async () => {
    posts = [{
      id: 'p1',
      media_url: null,
      metadata: {
        branding: { logoUrl: `/storage/v1/object/public/media/${UID}/logo/l.png` },
        seqBackgrounds: { intro: { url: `${HOTE}/media/${UID}/fonds/f.jpg` } },
      },
    }];
    const a = await POST(req({ bucket: 'media', path: `${UID}/logo/l.png` }));
    const b = await POST(req({ bucket: 'media', path: `${UID}/fonds/f.jpg` }));
    expect(a.status).toBe(409);
    expect(b.status).toBe(409);
    expect(removed).toHaveLength(0);
  });

  it('rush de la banque Autopilote, de brouillon et de tournage → 409', async () => {
    autopilotRows = [{ rush_urls: [`${HOTE}/media/${UID}/library/a.mp4`] }];
    draftRows = [{ object_key: `media/${UID}/library/b.mp4` }];
    rushesRows = [{ id: 'r', bucket: 'media', cle_objet: `${UID}/rush/c.mp4` }];
    for (const [path, motif] of [
      [`${UID}/library/a.mp4`, 'autopilote'],
      [`${UID}/library/b.mp4`, 'brouillon'],
      [`${UID}/rush/c.mp4`, 'tournage'],
    ]) {
      const res = await POST(req({ bucket: 'media', path }));
      expect(res.status).toBe(409);
      expect((await res.json()).refuses[0].motif).toBe(motif);
    }
    expect(removed).toHaveLength(0);
  });

  it('URL persistée encodée (%20) → la clé décodée est protégée', async () => {
    posts = [{ id: 'p1', media_url: `${HOTE}/media/${UID}/library/mon%20rush.mp4`, metadata: null }];
    const res = await POST(req({ bucket: 'media', path: `${UID}/library/mon rush.mp4` }));
    expect(res.status).toBe(409);
    expect(removed).toHaveLength(0);
  });
});

describe('Suppression d\'un média libre', () => {
  it('clé libre → 200 et supprimée', async () => {
    posts = [{ id: 'p1', media_url: `${HOTE}/media/${UID}/rendus/autre.webm`, metadata: {} }];
    const res = await POST(req({ bucket: 'media', path: `${UID}/library/libre.mp4` }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(tousSupprimes()).toEqual([`media/${UID}/library/libre.mp4`]);
  });

  it('préfixe d\'un autre compte ou traversée → 403, rien supprimé', async () => {
    const a = await POST(req({ bucket: 'media', path: 'u2/library/x.mp4' }));
    const b = await POST(req({ bucket: 'media', path: `${UID}/../u2/x.mp4` }));
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(removed).toHaveLength(0);
  });

  it('corps incomplet → 400', async () => {
    const res = await POST(req({ bucket: 'media' }));
    expect(res.status).toBe(400);
  });
});

describe('Suppression groupée', () => {
  it('mixte : les libres partent, les référencés sont listés et restent', async () => {
    posts = [{ id: 'p1', media_url: null, metadata: { rawVideoUrl: `${HOTE}/media/${UID}/library/rush.mp4` } }];
    const res = await POST(req({
      items: [
        { bucket: 'media', path: `${UID}/library/rush.mp4` },
        { bucket: 'media', path: `${UID}/library/libre1.mp4` },
        { bucket: 'audio', path: `${UID}/musique/libre2.mp3` },
      ],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('utilisé par un contenu');
    expect(body.refuses).toEqual([{ bucket: 'media', path: `${UID}/library/rush.mp4`, motif: 'post' }]);
    expect(body.supprimes).toHaveLength(2);
    expect(tousSupprimes().sort()).toEqual([`audio/${UID}/musique/libre2.mp3`, `media/${UID}/library/libre1.mp4`]);
    expect(tousSupprimes()).not.toContain(`media/${UID}/library/rush.mp4`);
  });

  it('tous référencés → 409, rien supprimé', async () => {
    posts = [{ id: 'p1', media_url: `${HOTE}/media/${UID}/a.webm`, metadata: {} }];
    const res = await POST(req({ items: [{ bucket: 'media', path: `${UID}/a.webm` }] }));
    expect(res.status).toBe(409);
    expect(removed).toHaveLength(0);
  });
});

describe('Source illisible', () => {
  it('posts illisibles → 503, RIEN supprimé (même les clés libres)', async () => {
    postsError = { message: 'base injoignable' };
    const res = await POST(req({
      items: [{ bucket: 'media', path: `${UID}/library/libre.mp4` }],
    }));
    expect(res.status).toBe(503);
    expect((await res.json()).success).toBe(false);
    expect(removed).toHaveLength(0);
  });
});
