/**
 * Double publication Zernio — le cron ne doit remettre a Zernio qu'UNE fois.
 *
 * Le chemin Zernio laisse le post a `publishing` en attendant le webhook
 * `post.published`. Le reset des posts « bloques » (> 10 min a `publishing`)
 * les remettait a `scheduled`, le passage suivant les reclamait, et
 * `createPost` etait rappele : la video partait deux fois sur les reseaux de
 * l'utilisateur.
 *
 * Deux verrous, testes separement puis ensemble :
 * 1. le reset exclut les posts qui portent `metadata.zernioPostId` ;
 * 2. `publierViaZernio` ne recree jamais un post que Zernio a deja accepte.
 *
 * Tout est en memoire : aucune base, aucun appel Zernio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Base en memoire, qui EVALUE les filtres PostgREST utilises ────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = { scheduled_posts: [], social_accounts: [] };
const resets: string[][] = [];

/** Valeur d'une colonne, y compris `metadata->>cle`. */
function valeur(l: Ligne, col: string): unknown {
  const m = col.match(/^(\w+)->>(\w+)$/);
  if (m) {
    const v = l[m[1]]?.[m[2]];
    return v === undefined || v === null ? null : String(v);
  }
  return l[col];
}

function chaine(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let maj: Ligne | null = null;
  let limite = Infinity;
  const executer = () => {
    const lignes = (base[table] ?? []).filter((l) => filtres.every((f) => f(l)));
    if (maj) {
      for (const l of lignes) Object.assign(l, maj);
      if (table === 'scheduled_posts' && maj.status === 'scheduled') resets.push(lignes.map((l) => l.id));
    }
    return { data: lignes.slice(0, limite).map((l) => ({ ...l })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (v: Ligne) => { maj = v; return b; },
    insert: () => b,
    eq: (c: string, v: unknown) => { filtres.push((l) => valeur(l, c) === v); return b; },
    lt: (c: string, v: string) => { filtres.push((l) => String(valeur(l, c)) < v); return b; },
    is: (c: string, v: null) => { filtres.push((l) => valeur(l, c) === v); return b; },
    // Les posts du test sont tous anciens : la fenetre horaire les couvre.
    or: () => b,
    order: () => b,
    limit: (n: number) => { limite = n; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(executer()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/db/supabase', () => {
  const client = { from: (t: string) => chaine(t) };
  return { supabaseAdmin: client, supabase: client };
});

// ── Zernio : tout est simule ─────────────────────────────────────────────
const createPost = vi.fn(async () => ({ _id: 'zernio-post-1' }));
const uploadMedia = vi.fn(async () => 'https://zernio.example/tmp/media.mp4');
vi.mock('@/lib/social/zernio', () => {
  class ZernioError extends Error {
    paymentRequired = false;
    retryable = false;
  }
  return { createPost, uploadMedia, ZernioError };
});

vi.mock('@/lib/social/publishing', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/publishing')>()),
  comptesConnectes: async () => [{ platform: 'instagram', accountId: 'acc-ig' }],
  droitDePublier: async () => ({ autorise: true }),
}));

vi.mock('@/lib/storage/fetch-media', () => ({ downloadMediaToFile: vi.fn() }));
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({ transcodeWebmToMp4WithLadder: vi.fn() }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton' }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false, canUseWhatsApp: () => false, broadcastWhatsApp: vi.fn(),
  resolveRecipients: () => [], MAX_RECIPIENTS: 0, formatBroadcastFailures: () => '',
}));
vi.mock('@/lib/social/subscribers', () => ({ fetchSubscribers: async () => [], unsubscribeUrl: () => '' }));
vi.mock('@/lib/email/unsubscribe', () => ({
  unsubscribeEndpoint: () => '', filterSuppressed: async (l: unknown[]) => l,
  isSuppressed: async () => false, canUnsubscribe: async () => false,
}));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));

const SECRET = 'secret-cron-test';
const IL_Y_A_UNE_HEURE = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function requete(force: boolean) {
  return new NextRequest(`http://localhost:3000/api/cron/publish${force ? '?force=true' : ''}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

async function lancerCron(force = false) {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(requete(force));
  return res.json();
}

function post(id: string, extra: Ligne = {}): Ligne {
  return {
    id,
    user_id: 'user-1',
    title: `Post ${id}`,
    caption: 'legende',
    platforms: ['instagram'],
    status: 'scheduled',
    scheduled_date: '2026-01-01',
    scheduled_time: '08:00',
    updated_at: new Date().toISOString(),
    video_id: null,
    videos: null,
    users: { email: 'user@test.local', name: 'User' },
    media_url: 'https://cdn.example/rendus/montage.mp4',
    metadata: { renderedVideoUrl: 'https://cdn.example/rendus/montage.mp4' },
    ...extra,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  base.scheduled_posts = [];
  base.social_accounts = [];
  resets.length = 0;
  createPost.mockClear();
  uploadMedia.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau ferme en test'); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Reset des posts bloques a `publishing`', () => {
  it('un post deja remis a Zernio n est PAS remis a `scheduled`', async () => {
    base.scheduled_posts = [
      post('zernio', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(), metadata: { zernioPostId: 'z-1' } }),
    ];
    await lancerCron();
    expect(resets.flat()).not.toContain('zernio');
    expect(base.scheduled_posts[0].status).toBe('publishing');
    expect(createPost).not.toHaveBeenCalled();
  });

  it('un post bloque SANS zernioPostId est toujours remis a `scheduled` (comportement inchange)', async () => {
    base.scheduled_posts = [
      post('zernio', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(), metadata: { zernioPostId: 'z-1' } }),
      post('bloque', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(), metadata: {} }),
      post('sans-meta', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(), metadata: null }),
    ];
    await lancerCron();
    expect(resets[0]).toEqual(['bloque', 'sans-meta']);
  });

  it('un post recent a `publishing` n est pas touche', async () => {
    base.scheduled_posts = [post('recent', { status: 'publishing', metadata: {} })];
    await lancerCron();
    expect(resets.flat()).toEqual([]);
  });
});

describe('Deux passages du cron — un seul envoi a Zernio', () => {
  it('le deuxieme passage ne rappelle pas createPost', async () => {
    base.scheduled_posts = [post('p1')];

    const premier = await lancerCron(true);
    expect(premier.results[0].success).toBe(true);
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(base.scheduled_posts[0].status).toBe('publishing');
    expect(base.scheduled_posts[0].metadata.zernioPostId).toBe('zernio-post-1');
    // Les metadonnees existantes sont conservees.
    expect(base.scheduled_posts[0].metadata.renderedVideoUrl).toBe('https://cdn.example/rendus/montage.mp4');

    // Le webhook n'est pas encore arrive, et 10 minutes ont passe.
    base.scheduled_posts[0].updated_at = IL_Y_A_UNE_HEURE();
    await lancerCron();

    expect(createPost).toHaveBeenCalledTimes(1);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(base.scheduled_posts[0].status).toBe('publishing');
  });
});

describe('publierViaZernio — idempotence', () => {
  const entree = {
    id: 'p1', userId: 'user-1', caption: 'x',
    mediaUrl: 'https://cdn.example/rendus/montage.mp4', platforms: ['instagram'],
  };

  it('ne recree pas le post si metadata.zernioPostId existe deja', async () => {
    base.scheduled_posts = [post('p1', { status: 'publishing', metadata: { zernioPostId: 'z-existant' } })];
    const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
    const r = await publierViaZernio(entree);
    expect(r).toMatchObject({ ok: true, zernioPostId: 'z-existant', dejaEnvoye: true });
    expect(createPost).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('deux appels successifs : un seul createPost', async () => {
    base.scheduled_posts = [post('p1', { status: 'publishing' })];
    const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
    const r1 = await publierViaZernio(entree);
    const r2 = await publierViaZernio(entree);
    expect(r1).toMatchObject({ ok: true, zernioPostId: 'zernio-post-1' });
    expect(r2).toMatchObject({ ok: true, zernioPostId: 'zernio-post-1', dejaEnvoye: true });
    expect(createPost).toHaveBeenCalledTimes(1);
  });
});
