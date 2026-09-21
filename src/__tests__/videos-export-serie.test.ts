/**
 * Le telechargement depuis la Bibliotheque doit fonctionner pour une video de
 * Serie.
 *
 * `GET /api/videos` fusionne `videos` ET `scheduled_posts` : une video creee
 * par le createur simple porte l'id d'un post. Historiquement,
 * `POST /api/videos/[id]/export` ne regardait que `videos` → 404 au clic.
 *
 * Ce fichier verifie la seconde recherche, dans `scheduled_posts`, sans rien
 * relacher : meme proprietaire, meme corps de 404 pour un inconnu et pour le
 * post d'un autre, URL absolue http(s) seule, image seule refusee.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const MONTAGE = 'https://cdn.test/serie/montage.mp4';
const MEDIA = 'https://cdn.test/serie/media.mp4';
const RUSH = 'https://cdn.test/serie/rush-brut.mp4';

const authMock = vi.fn();
const tables: Record<string, Array<Record<string, unknown>>> = { videos: [], scheduled_posts: [] };
/** Toute ecriture tentee, quelle qu'elle soit. */
const ecritures: Array<{ table: string; op: string; values?: unknown }> = [];

/**
 * Mock conscient de la table : `single()` filtre `tables[table]` sur TOUTES
 * les clauses `eq` accumulees. Un `id` d'un autre compte ne remonte pas.
 */
function makeQuery(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => { filtres.push([col, val]); return api; },
    order: () => Promise.resolve({ data: tables[table] ?? [], count: (tables[table] ?? []).length, error: null }),
    insert: (values: unknown) => { ecritures.push({ table, op: 'insert', values }); return api; },
    update: (values: unknown) => { ecritures.push({ table, op: 'update', values }); return api; },
    delete: () => { ecritures.push({ table, op: 'delete' }); return api; },
    single: async () => {
      const ligne = (tables[table] ?? []).find((l) => filtres.every(([c, v]) => l[c] === v)) ?? null;
      return { data: ligne, error: ligne ? null : { message: 'not found' } };
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeQuery(t) },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST } = await import('@/app/api/videos/[id]/export/route');
const { resolveExportableUrl } = await import('@/lib/videos/playable-url');

const exporter = async (id: string) => {
  const res = await POST({} as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};

const VIDEO_USER1 = {
  id: 'v-1',
  user_id: 'user-1',
  title: 'Mon infographie',
  video_url: null,
  metadata: { renderedVideoUrl: 'https://cdn.test/info/montage.webm', rushUrls: [RUSH] },
};

const POST_SERIE = {
  id: 'p-serie',
  user_id: 'user-1',
  title: 'Episode 3',
  media_url: MEDIA,
  media_type: 'video',
  metadata: { renderedVideoUrl: MONTAGE, videoUrl: RUSH },
};

beforeEach(() => {
  tables.videos = [];
  tables.scheduled_posts = [];
  ecritures.length = 0;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('A. Une ligne `videos` garde son comportement historique', () => {
  it('sert le resultat de resolveExportableUrl et le titre', async () => {
    tables.videos = [VIDEO_USER1];
    const { status, body } = await exporter('v-1');
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      url: resolveExportableUrl(VIDEO_USER1),
      title: 'Mon infographie',
    });
    expect(body.url).toBe('https://cdn.test/info/montage.webm');
  });

  it('une ligne `videos` d un autre compte est invisible', async () => {
    tables.videos = [{ ...VIDEO_USER1, user_id: 'user-2' }];
    const { status, body } = await exporter('v-1');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Video not found' });
  });
});

describe('B. Un post de Serie du proprietaire est telechargeable', () => {
  it('sert metadata.renderedVideoUrl en priorite', async () => {
    tables.scheduled_posts = [POST_SERIE];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, url: MONTAGE, title: 'Episode 3' });
  });

  it('retombe sur media_url quand il n y a pas de montage', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, metadata: {} }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body.url).toBe(MEDIA);
  });

  it('ignore metadata.videoUrl, cle ambigue qui porte le rush', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, media_url: null, metadata: { videoUrl: RUSH } }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'No exportable file found' });
  });

  it('un post sans metadata du tout retombe sur media_url', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, metadata: null }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body.url).toBe(MEDIA);
  });
});

describe('C. et D. Le post d un autre compte repond comme un id inconnu', () => {
  it('post de user-2 → 404, corps identique a un id inconnu, aucune ecriture', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, user_id: 'user-2' }];
    const autre = await exporter('p-serie');
    const inconnu = await exporter('id-qui-n-existe-pas');

    expect(autre.status).toBe(404);
    expect(inconnu.status).toBe(404);
    expect(autre.body).toEqual({ success: false, error: 'Video not found' });
    expect(autre.body).toEqual(inconnu.body);
    expect(ecritures).toEqual([]);
  });

  it('id inconnu → 404 Video not found', async () => {
    const { status, body } = await exporter('nope');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Video not found' });
  });
});

describe('E. Un post image seule n est pas une video', () => {
  it('media_type image sans montage → 404 No exportable file found', async () => {
    tables.scheduled_posts = [{
      ...POST_SERIE,
      media_type: 'image',
      media_url: 'https://cdn.test/affiche.jpg',
      metadata: {},
    }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'No exportable file found' });
  });

  it('media_type image AVEC montage reste telechargeable', async () => {
    tables.scheduled_posts = [{
      ...POST_SERIE,
      media_type: 'image',
      media_url: 'https://cdn.test/affiche.jpg',
      metadata: { renderedVideoUrl: MONTAGE },
    }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body.url).toBe(MONTAGE);
  });
});

describe('F. Seule une URL absolue http(s) est renvoyee', () => {
  it.each([
    ['javascript:alert(1)'],
    ['/etc/passwd'],
    ['file:///etc/passwd'],
    ['data:video/mp4;base64,AAAA'],
    [''],
  ])('renderedVideoUrl = %j → 404', async (mauvaise) => {
    tables.scheduled_posts = [{ ...POST_SERIE, media_url: null, metadata: { renderedVideoUrl: mauvaise } }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'No exportable file found' });
  });

  it('media_url forge → 404, meme avec media_type video', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, media_url: 'javascript:alert(1)', metadata: {} }];
    const { status } = await exporter('p-serie');
    expect(status).toBe(404);
  });

  it('un montage forge vaut « absent » : le media_url http(s) valide est servi', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, metadata: { renderedVideoUrl: '/etc/passwd' } }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body.url).toBe(MEDIA);
  });

  it('http: est accepte', async () => {
    tables.scheduled_posts = [{ ...POST_SERIE, metadata: { renderedVideoUrl: 'http://cdn.test/m.mp4' } }];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(200);
    expect(body.url).toBe('http://cdn.test/m.mp4');
  });
});

describe('G. Sans session', () => {
  it('→ 401 Unauthorized, sans toucher aux tables', async () => {
    authMock.mockResolvedValue(null);
    tables.scheduled_posts = [POST_SERIE];
    const { status, body } = await exporter('p-serie');
    expect(status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Unauthorized' });
    expect(ecritures).toEqual([]);
  });
});

describe('Aucune ecriture, jamais', () => {
  it('exporter un post n ecrit strictement rien', async () => {
    tables.scheduled_posts = [POST_SERIE];
    await exporter('p-serie');
    expect(ecritures).toEqual([]);
  });
});
