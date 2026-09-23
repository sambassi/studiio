import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeDb, type FakeDb } from './helpers/fake-supabase';

/**
 * Bibliothèque → ligne `videos` → « Modifier ».
 *
 * Une vidéo s'édite TOUJOURS à travers un `scheduled_posts` relié par
 * `scheduled_posts.video_id` (colonne existante, aucune migration) :
 *
 * 1. un post relié existe → on l'ouvre ;
 * 2. sinon, action EXPLICITE « Créer un post modifiable depuis cette vidéo »,
 *    qui crée AU PLUS UN post, pose `video_id`, reste owner-scopée, ne touche
 *    pas à la vidéo, ne rend rien et ne débite rien.
 *
 * Le faux Supabase filtre réellement : un oubli de `user_id` ou de `video_id`
 * dans une requête se voit ici.
 */

const authMock = vi.fn();
let db: FakeDb;

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  get supabaseAdmin() { return db; },
  get supabase() { return db; },
}));

const { POST } = await import('@/app/api/videos/[id]/editable-post/route');
const videosRoute = await import('@/app/api/videos/route');
const { pickLinkedPost, buildEditablePostRow, linkedPostIdByVideo } = await import('@/lib/videos/editable-post');

const MOI = 'user-moi';
const AUTRE = 'user-autre';

const video = (over: Record<string, unknown> = {}) => ({
  id: 'vid-1',
  user_id: MOI,
  title: 'Ma vidéo',
  format: 'reel',
  status: 'draft',
  video_url: null,
  thumbnail_url: 'https://cdn/thumb.jpg',
  metadata: {
    title: 'Ma vidéo',
    subtitle: 'Sous-titre',
    salesPhrase: 'Phrase',
    posterPhotoUrl: 'https://cdn/poster.jpg',
    rushUrls: ['https://cdn/rush.mp4'],
    musicUrl: 'https://cdn/music.mp3',
    voiceUrl: null,
    renderedVideoUrl: 'https://cdn/montage.webm',
  },
  created_at: '2026-09-01T10:00:00.000Z',
  ...over,
});

const appeler = async (id = 'vid-1') => {
  const res = await POST({} as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};

const posts = () => db.tables.scheduled_posts ?? [];

beforeEach(() => {
  db = createFakeDb({ videos: [video()], scheduled_posts: [], users: [{ id: MOI, credits: 100 }] });
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: MOI } });
});

describe('POST /api/videos/[id]/editable-post — accès', () => {
  it('sans session : 401, aucune écriture', async () => {
    authMock.mockResolvedValue(null);
    expect((await appeler()).status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it('vidéo d’un autre utilisateur : 404, aucun post créé', async () => {
    db.tables.videos = [video({ user_id: AUTRE })];
    expect((await appeler()).status).toBe(404);
    expect(db.writes).toEqual([]);
  });

  it('vidéo inexistante : 404', async () => {
    expect((await appeler('absente')).status).toBe(404);
    expect(db.writes).toEqual([]);
  });
});

describe('POST /api/videos/[id]/editable-post — post déjà relié', () => {
  it('renvoie le post relié existant, sans rien créer', async () => {
    db.tables.scheduled_posts = [{ id: 'post-lie', user_id: MOI, video_id: 'vid-1', created_at: '2026-09-02T00:00:00Z' }];
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, postId: 'post-lie', created: false });
    expect(db.writes).toEqual([]);
  });

  it('ignore un post d’autrui qui pointerait sur la même vidéo', async () => {
    db.tables.scheduled_posts = [{ id: 'post-intrus', user_id: AUTRE, video_id: 'vid-1', created_at: '2026-09-02T00:00:00Z' }];
    const r = await appeler();
    expect(r.body.postId).not.toBe('post-intrus');
    expect(r.body.created).toBe(true);
  });
});

describe('POST /api/videos/[id]/editable-post — création', () => {
  it('crée UN post brouillon relié, owner-scopé, depuis la vidéo', async () => {
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    const mine = posts().filter((p) => p.video_id === 'vid-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: r.body.postId,
      user_id: MOI,
      video_id: 'vid-1',
      status: 'draft',
      title: 'Ma vidéo',
      platforms: [],
      media_url: 'https://cdn/montage.webm',
    });
  });

  it('second clic : même post, aucun doublon', async () => {
    const a = await appeler();
    const b = await appeler();
    expect(b.body).toMatchObject({ postId: a.body.postId, created: false });
    expect(posts().filter((p) => p.video_id === 'vid-1')).toHaveLength(1);
  });

  it('deux clics concurrents convergent vers UN seul post', async () => {
    // Pendant le premier insert, un « autre onglet » insère son propre post.
    let rival = true;
    db.beforeInsert = (table) => {
      if (table !== 'scheduled_posts' || !rival) return;
      rival = false;
      db.tables.scheduled_posts.push({ id: 'aaa-rival', user_id: MOI, video_id: 'vid-1', created_at: '2026-01-01T00:00:00Z' });
    };
    const r = await appeler();
    expect(r.body).toMatchObject({ postId: 'aaa-rival', created: false });
    expect(posts().filter((p) => p.video_id === 'vid-1').map((p) => p.id)).toEqual(['aaa-rival']);
  });

  it('ne modifie PAS la vidéo (statut compris), ni crédits, ni rendu', async () => {
    await appeler();
    expect(db.tables.videos[0].status).toBe('draft');
    expect(db.writes.map((w) => w.table)).toEqual(['scheduled_posts']);
    expect(db.tables.users[0].credits).toBe(100);
    expect(db.tables.render_jobs).toBeUndefined();
    expect(db.tables.credit_transactions).toBeUndefined();
  });

  it('les metadata du post sont lisibles par le parcours guidé', async () => {
    await appeler();
    const meta = posts()[0].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      subtitle: 'Sous-titre',
      salesPhrase: 'Phrase',
      posterUrl: 'https://cdn/poster.jpg',
      rushUrls: ['https://cdn/rush.mp4'],
      musicUrl: 'https://cdn/music.mp3',
      renderedVideoUrl: 'https://cdn/montage.webm',
    });
    // `null` n'est pas une valeur à recopier : l'absence reste l'absence.
    expect('voiceUrl' in meta).toBe(false);
  });
});

describe('logique pure', () => {
  it('pickLinkedPost : le plus ancien, puis le plus petit id — déterministe', () => {
    expect(pickLinkedPost([])).toBeNull();
    expect(pickLinkedPost([
      { id: 'b', created_at: '2026-02-01' },
      { id: 'c', created_at: '2026-01-01' },
      { id: 'a', created_at: '2026-01-01' },
    ])?.id).toBe('a');
  });

  it('linkedPostIdByVideo : ignore les posts sans video_id', () => {
    const m = linkedPostIdByVideo([
      { id: 'p1', video_id: 'v1', created_at: '2026-02-01' },
      { id: 'p0', video_id: 'v1', created_at: '2026-01-01' },
      { id: 'p2', video_id: null, created_at: '2026-01-01' },
    ]);
    expect(Object.fromEntries(m)).toEqual({ v1: 'p0' });
  });

  it('buildEditablePostRow : vidéo Remotion sans metadata connue → post sobre, pas d’invention', () => {
    const row = buildEditablePostRow(
      { id: 'v', title: 'R', format: 'tv', metadata: { compositionId: 'x', batchIndex: 0 } },
      MOI,
      '2026-09-23',
    );
    expect(row).toMatchObject({ user_id: MOI, video_id: 'v', format: 'tv', scheduled_date: '2026-09-23', status: 'draft' });
    expect(row.metadata).toEqual({});
  });
});

describe('GET /api/videos — lien vers le post relié', () => {
  it('chaque vidéo porte `linked_post_id` de SON propriétaire seulement', async () => {
    db.tables.videos = [video(), video({ id: 'vid-2', created_at: '2026-09-01T09:00:00Z' })];
    db.tables.scheduled_posts = [
      { id: 'post-lie', user_id: MOI, video_id: 'vid-1', title: 'x', metadata: {}, created_at: '2026-09-02T00:00:00Z' },
      { id: 'post-intrus', user_id: AUTRE, video_id: 'vid-2', title: 'y', metadata: {}, created_at: '2026-09-02T00:00:00Z' },
    ];
    const res = await videosRoute.GET({ url: 'https://studiio.pro/api/videos?page=1&limit=20' } as never);
    const body = await res.json();
    const parId = Object.fromEntries(body.data.map((i: Record<string, unknown>) => [i.id, i]));
    expect(parId['vid-1'].linked_post_id).toBe('post-lie');
    expect(parId['vid-2'].linked_post_id).toBeNull();
  });
});

describe('POST /api/videos — contenus futurs reliés à leur post', () => {
  const creer = (body: unknown) => videosRoute.POST({ json: async () => body } as never);

  it('`post_id` de l’appelant : le post reçoit `video_id`', async () => {
    db.tables.scheduled_posts = [{ id: 'post-neuf', user_id: MOI, video_id: null }];
    const res = await creer({ title: 'T', post_id: 'post-neuf' });
    const { data } = await res.json();
    expect(db.tables.scheduled_posts[0].video_id).toBe(data.id);
  });

  it('`post_id` d’autrui : rien n’est relié', async () => {
    db.tables.scheduled_posts = [{ id: 'post-autre', user_id: AUTRE, video_id: null }];
    await creer({ title: 'T', post_id: 'post-autre' });
    expect(db.tables.scheduled_posts[0].video_id).toBeNull();
  });

  it('un post déjà relié n’est jamais re-pointé', async () => {
    db.tables.scheduled_posts = [{ id: 'post-lie', user_id: MOI, video_id: 'vid-ancienne' }];
    await creer({ title: 'T', post_id: 'post-lie' });
    expect(db.tables.scheduled_posts[0].video_id).toBe('vid-ancienne');
  });

  it('sans `post_id` : aucune écriture sur scheduled_posts', async () => {
    await creer({ title: 'T' });
    expect(db.writes.filter((w) => w.table === 'scheduled_posts')).toEqual([]);
  });
});
