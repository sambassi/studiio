// @vitest-environment node
/**
 * URLs d'un post À L'ÉCRITURE — `POST` / `PUT /api/posts`, `PATCH /api/posts/[id]`.
 *
 * Choix documenté (`src/lib/securite/urls-post.ts`) : une URL non
 * enregistrable est RETIRÉE, la requête passe (jamais de 400) — le Calendrier
 * renvoie le post entier, valeurs anciennes comprises. Les lignes déjà en
 * base ne sont pas touchées : la lecture reste protégée par le fetch sûr.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { urlEcrivable, neutraliserUrlsPost } from '@/lib/securite/urls-post';
import { parsePutPostPayload } from '@/lib/posts/put-payload';
import { parsePatchPostPayload } from '@/lib/posts/patch-payload';

const ORIGINES = ['https://studiio.pro', 'http://localhost:3000'];

const MALVEILLANTES = [
  'http://127.0.0.1/x.mp4',
  'http://localhost:9000/x.mp4',
  'http://10.0.0.5/x.mp4',
  'http://172.16.0.1/x.mp4',
  'http://192.168.1.1/x.mp4',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/x.mp4',
  'http://[fc00::1]/x.mp4',
  'http://[::ffff:127.0.0.1]/x.mp4',
  'http://2130706433/x.mp4',
  'http://0x7f.1/x.mp4',
  'http://studiio-postgrest:3000/users',
  'http://studiio-minio:9000/media/x.mp4',
  'http://metadata.google.internal/x.mp4',
  'https://base.local/x.mp4',
  'https://user:mdp@cdn.example.com/x.mp4',
  'file:///etc/passwd',
  'gopher://127.0.0.1:6379/_',
  'ftp://cdn.example.com/x.mp4',
  'javascript:alert(1)',
  'blob:https://studiio.pro/1234',
  '//evil.example.com/x.mp4',
  ' http://cdn.example.com/x.mp4',
];

const LEGITIMES = [
  null, '',
  '/storage/v1/object/public/media/u1/montage.mp4',
  'https://studiio.pro/storage/v1/object/public/media/u1/montage.mp4',
  'http://localhost:3000/storage/v1/object/public/media/u1/m.mp4', // dev : origine configurée
  'https://lhuqdmlkhezdwzwlpfqo.supabase.co/storage/v1/object/public/media/u1/ancien.webm',
  'https://videos.pexels.com/video-files/1/clip.mp4',
  'https://cdn.example.com/a/b.mp4?token=abc',
  'https://93.184.216.34/x.mp4',
  'ancienne-musique', // sans schéma : inerte
];

describe('urlEcrivable', () => {
  it.each(MALVEILLANTES)('refuse %s', (u) => {
    expect(urlEcrivable(u, { origines: ORIGINES })).toBe(false);
  });
  it.each(LEGITIMES.map((u) => [u]))('accepte %s', (u) => {
    expect(urlEcrivable(u, { origines: ORIGINES })).toBe(true);
  });
  it('data:image seulement pour les champs image', () => {
    expect(urlEcrivable('data:image/jpeg;base64,AAAA', { origines: ORIGINES })).toBe(false);
    expect(urlEcrivable('data:image/jpeg;base64,AAAA', { origines: ORIGINES, imageData: true })).toBe(true);
    expect(urlEcrivable('data:text/html,<script>', { origines: ORIGINES, imageData: true })).toBe(false);
  });
  it('une valeur non chaîne est refusée', () => {
    expect(urlEcrivable(42)).toBe(false);
    expect(urlEcrivable({ toString: () => 'https://x.example.com' })).toBe(false);
  });
});

describe('neutraliserUrlsPost', () => {
  it('retire les champs malveillants, garde tout le reste tel quel', () => {
    const r = neutraliserUrlsPost({
      media_url: 'http://169.254.169.254/latest/meta-data/',
      metadata: {
        renderedVideoUrl: 'http://127.0.0.1:3000/x.mp4',
        videoUrl: 'http://10.0.0.5/v.mp4',
        rawVideoUrl: 'https://cdn.example.com/rush.mp4',
        posterUrl: 'data:image/png;base64,AAAA',
        thumbnailUrl: 'file:///etc/passwd',
        musicUrl: 'gopher://127.0.0.1:6379/_',
        voiceUrl: '/storage/v1/object/public/audio/u/v.mp3',
        rushUrls: ['https://cdn.example.com/r1.mp4', 'http://192.168.0.2/r2.mp4', { url: 'objet' }],
        cover: { mode: 'upload', imageUrl: 'http://[::1]/c.jpg' },
        design: { titleColor: '#FFF' },
        cleInconnue: 'http://127.0.0.1/pas-une-url-lue',
      },
    }, { origines: ORIGINES });
    expect(r.media_url).toBeUndefined();
    expect(r.refusees.sort()).toEqual([
      'media_url', 'metadata.cover.imageUrl', 'metadata.musicUrl', 'metadata.renderedVideoUrl',
      'metadata.rushUrls', 'metadata.thumbnailUrl', 'metadata.videoUrl',
    ]);
    expect(r.metadata).toEqual({
      rawVideoUrl: 'https://cdn.example.com/rush.mp4',
      posterUrl: 'data:image/png;base64,AAAA',
      voiceUrl: '/storage/v1/object/public/audio/u/v.mp3',
      rushUrls: ['https://cdn.example.com/r1.mp4', { url: 'objet' }],
      cover: { mode: 'upload' },
      design: { titleColor: '#FFF' },
      // Clé non lue par le serveur : inchangée (contrat d'avant).
      cleInconnue: 'http://127.0.0.1/pas-une-url-lue',
    });
  });

  it('un post légitime ressort identique', () => {
    const metadata = {
      renderedVideoUrl: '/storage/v1/object/public/media/u/m.mp4',
      posterUrl: 'https://images.unsplash.com/photo-1',
      musicUrl: null,
      design: { a: 1 },
    };
    const r = neutraliserUrlsPost({ media_url: 'https://studiio.pro/storage/v1/object/public/media/u/m.mp4', metadata }, { origines: ORIGINES });
    expect(r.refusees).toEqual([]);
    expect(r.metadata).toEqual(metadata);
    expect(r.media_url).toBe('https://studiio.pro/storage/v1/object/public/media/u/m.mp4');
  });
});

describe('PUT /api/posts — liste blanche : URL retirée et signalée, le reste passe', () => {
  it('media_url et metadata.renderedVideoUrl internes sont écartés', () => {
    const r = parsePutPostPayload({
      id: 'p1', title: 'T', media_url: 'http://10.0.0.5/x.mp4',
      metadata: { renderedVideoUrl: 'http://169.254.169.254/x.mp4', design: { a: 1 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updates.media_url).toBeUndefined();
    expect(r.updates.title).toBe('T');
    expect(r.updates.metadata).toEqual({ design: { a: 1 } });
    expect(r.ignored).toEqual(expect.arrayContaining(['media_url', 'metadata.renderedVideoUrl']));
  });
  it('une URL légitime passe', () => {
    const r = parsePutPostPayload({ id: 'p1', media_url: 'https://cdn.example.com/x.mp4' });
    expect(r.ok && r.updates.media_url).toBe('https://cdn.example.com/x.mp4');
  });
});

describe('PATCH /api/posts/[id] — URL retirée, jamais de 422', () => {
  it('metadata.renderedVideoUrl interne retiré, le reste intact', () => {
    const r = parsePatchPostPayload({
      media_url: 'http://[::1]/x.mp4',
      caption: 'c',
      metadata: { renderedVideoUrl: 'http://127.0.0.1/x.mp4', musicUrl: 'https://cdn.example.com/m.mp3' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ caption: 'c', metadata: { musicUrl: 'https://cdn.example.com/m.mp3' } });
  });
});

// ── POST /api/posts, route réelle ───────────────────────────────────────
const insertions: Array<Record<string, unknown>> = [];
let lignesEnBase: Array<Record<string, unknown>> = [];
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/lib/db/supabase', () => {
  const chaine = () => {
    let inseree: Record<string, unknown> | null = null;
    const b: Record<string, any> = {
      insert: (v: Record<string, unknown>) => { inseree = v; insertions.push(v); return b; },
      select: () => b, eq: () => b, order: () => b, gte: () => b, lt: () => b,
      single: async () => ({ data: { id: 'nouveau', ...inseree }, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: lignesEnBase, error: null }).then(ok),
    };
    return b;
  };
  return { supabaseAdmin: { from: chaine }, supabase: { from: chaine } };
});

async function creer(corps: unknown) {
  const { POST } = await import('@/app/api/posts/route');
  const res = await POST({ json: async () => corps } as never);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  insertions.length = 0;
  lignesEnBase = [];
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST /api/posts — URLs malveillantes neutralisées (champ retiré, 200)', () => {
  it.each(MALVEILLANTES)('media_url + renderedVideoUrl = %s', async (u) => {
    const r = await creer({
      title: 'T', scheduled_date: '2026-10-12', media_url: u,
      metadata: { renderedVideoUrl: u, videoUrl: u, design: { a: 1 } },
    });
    expect(r.status).toBe(200);
    expect(insertions).toHaveLength(1);
    expect(insertions[0].media_url).toBeNull();
    expect(insertions[0].metadata).toEqual({ design: { a: 1 } });
    expect(r.body.ignored).toEqual(['media_url', 'metadata.renderedVideoUrl', 'metadata.videoUrl']);
  });

  it('un post légitime est créé à l identique', async () => {
    const metadata = {
      renderedVideoUrl: '/storage/v1/object/public/media/user-1/m.mp4',
      posterUrl: 'https://images.unsplash.com/photo-1',
      design: { a: 1 },
    };
    const r = await creer({
      title: 'T', scheduled_date: '2026-10-12',
      media_url: 'https://studiio.pro/storage/v1/object/public/media/user-1/m.mp4', metadata,
    });
    expect(r.status).toBe(200);
    expect(insertions[0].media_url).toBe('https://studiio.pro/storage/v1/object/public/media/user-1/m.mp4');
    expect(insertions[0].metadata).toEqual(metadata);
    expect(r.body.ignored).toBeUndefined();
  });

  it('sans metadata ni media_url : comportement d avant', async () => {
    await creer({ title: 'T', scheduled_date: '2026-10-12' });
    expect(insertions[0].media_url).toBeNull();
    expect('metadata' in insertions[0]).toBe(false);
  });
});

describe('GET /api/posts — une ligne ancienne est relue telle quelle', () => {
  it('aucune validation à la lecture', async () => {
    lignesEnBase = [{ id: 'ancien', media_url: 'http://10.0.0.5/ancien.mp4', metadata: { renderedVideoUrl: 'http://127.0.0.1/x.mp4' } }];
    const { GET } = await import('@/app/api/posts/route');
    const res = await GET({ url: 'http://localhost:3000/api/posts' } as never);
    const body = await res.json();
    expect(body.posts).toEqual(lignesEnBase);
  });
});
