/**
 * URLs de media envoyees aux reseaux — toujours absolues.
 *
 * Sous MinIO, `/api/upload/signed-url` enregistre une `publicUrl` RELATIVE
 * (`/storage/v1/object/public/…`). Meta, TikTok et Zernio vont chercher le
 * fichier eux-memes : un chemin sans hote leur est inutilisable. Seul YouTube
 * passait par `toAbsoluteMediaUrl`.
 *
 * Tout est simule : `fetch` est capture, aucun appel reseau ne part.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, any>;
let post: Ligne = {};
let comptesSociaux: Ligne[] = [];

function chaine(table: string) {
  const appels: string[] = [];
  let maj: Ligne | null = null;
  const executer = () => {
    if (maj) {
      if (table === 'scheduled_posts' && maj.status === 'publishing' && appels.includes('select')) {
        return { data: [{ id: post.id }], error: null };
      }
      return { data: [], error: null };
    }
    if (appels.includes('insert')) return { data: null, error: null };
    if (table === 'scheduled_posts') return { data: [post], error: null };
    if (table === 'social_accounts') return { data: comptesSociaux, error: null };
    return { data: [], error: null };
  };
  const p: any = new Proxy({}, {
    get(_c, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(executer()).then(res, rej);
      }
      return (...args: unknown[]) => {
        appels.push(prop);
        if (prop === 'update') maj = args[0] as Ligne;
        return p;
      };
    },
  });
  return p;
}

vi.mock('@/lib/db/supabase', () => {
  const client = {
    from: (t: string) => chaine(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error('non') }) }) },
  };
  return { supabaseAdmin: client, supabase: client };
});

const uploadMedia = vi.fn(async (_url: string) => 'https://zernio.example/tmp/media.mp4');
const createPost = vi.fn(async () => ({ _id: 'zernio-post-1' }));
vi.mock('@/lib/social/zernio', () => {
  class ZernioError extends Error {
    paymentRequired = false;
    retryable = false;
  }
  return { createPost, uploadMedia, ZernioError };
});

// Pour le cron : aucun compte Zernio → chemin historique `social_accounts`.
// Pour `publierViaZernio` appele directement : un compte Instagram.
let comptesZernio: Array<{ platform: string; accountId: string }> = [];
vi.mock('@/lib/social/publishing', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/publishing')>()),
  comptesConnectes: async () => comptesZernio,
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
const ORIGINE = 'https://studiio.test';
const RELATIVE = '/storage/v1/object/public/media/user-1/rendus/montage.mp4';
const ABSOLUE = 'https://cdn.example/storage/v1/object/public/media/user-1/rendus/montage.mp4';

type AppelFetch = { url: string; corps: any };
let appelsFetch: AppelFetch[] = [];

function fabriquerPost(mediaUrl: string, plateforme: string): Ligne {
  return {
    id: 'post-1', user_id: 'user-1', title: 'T', caption: 'legende',
    platforms: [plateforme], status: 'scheduled',
    scheduled_date: '2026-01-01', scheduled_time: '08:00',
    video_id: null, videos: null, users: { email: 'u@test.local', name: 'U' },
    media_url: mediaUrl, metadata: {},
  };
}

async function lancerCron() {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(new NextRequest('http://localhost:3000/api/cron/publish?force=true', {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
  return res.json();
}

const envAvant = { app: process.env.NEXT_PUBLIC_APP_URL, auth: process.env.NEXTAUTH_URL };

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = ORIGINE;
  appelsFetch = [];
  comptesZernio = [];
  uploadMedia.mockClear();
  createPost.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appelsFetch.push({ url: String(url), corps: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes('graph.facebook.com')) {
      return new Response(JSON.stringify({ id: 'fb-video-1' }), { status: 200 });
    }
    if (String(url).includes('tiktokapis.com')) {
      return new Response(JSON.stringify({ data: { publish_id: 'tt-1' } }), { status: 200 });
    }
    throw new Error(`reseau ferme en test : ${url}`);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_APP_URL = envAvant.app;
  if (envAvant.app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('Facebook — file_url envoye a Meta', () => {
  beforeEach(() => {
    comptesSociaux = [{ id: 'c-fb', user_id: 'user-1', platform: 'facebook', connected: true, access_token: 'jeton', account_id: 'page-1' }];
  });

  it('une URL relative MinIO devient absolue', async () => {
    post = fabriquerPost(RELATIVE, 'facebook');
    const corps = await lancerCron();
    const appel = appelsFetch.find((a) => a.url.includes('graph.facebook.com'));
    expect(appel?.corps.file_url).toBe(`${ORIGINE}${RELATIVE}`);
    expect(corps.succeeded).toBe(1);
  });

  it('une URL deja absolue reste inchangee', async () => {
    post = fabriquerPost(ABSOLUE, 'facebook');
    await lancerCron();
    const appel = appelsFetch.find((a) => a.url.includes('graph.facebook.com'));
    expect(appel?.corps.file_url).toBe(ABSOLUE);
  });
});

describe('TikTok — video_url envoye en PULL_FROM_URL', () => {
  beforeEach(() => {
    comptesSociaux = [{ id: 'c-tt', user_id: 'user-1', platform: 'tiktok', connected: true, access_token: 'jeton', account_id: 'tt' }];
  });

  it('une URL relative MinIO devient absolue', async () => {
    post = fabriquerPost(RELATIVE, 'tiktok');
    await lancerCron();
    const appel = appelsFetch.find((a) => a.url.includes('tiktokapis.com'));
    expect(appel?.corps.source_info.video_url).toBe(`${ORIGINE}${RELATIVE}`);
  });

  it('une URL deja absolue reste inchangee', async () => {
    post = fabriquerPost(ABSOLUE, 'tiktok');
    await lancerCron();
    const appel = appelsFetch.find((a) => a.url.includes('tiktokapis.com'));
    expect(appel?.corps.source_info.video_url).toBe(ABSOLUE);
  });
});

describe('Zernio — media transmis a uploadMedia', () => {
  beforeEach(() => {
    comptesZernio = [{ platform: 'instagram', accountId: 'acc-ig' }];
    post = fabriquerPost(RELATIVE, 'instagram');
  });

  it('une URL relative MinIO devient absolue (et n est plus refusee par le garde)', async () => {
    const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
    const r = await publierViaZernio({ id: 'post-1', userId: 'user-1', caption: 'x', mediaUrl: RELATIVE, platforms: ['instagram'] });
    expect(r.ok).toBe(true);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(uploadMedia.mock.calls[0][0]).toBe(`${ORIGINE}${RELATIVE}`);
  });

  it('une URL deja absolue reste inchangee', async () => {
    const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
    await publierViaZernio({ id: 'post-1', userId: 'user-1', caption: 'x', mediaUrl: ABSOLUE, platforms: ['instagram'] });
    expect(uploadMedia.mock.calls[0][0]).toBe(ABSOLUE);
  });

  it('le cron transmet a Zernio une URL absolue', async () => {
    const corps = await lancerCron();
    expect(corps.results[0].details).toBe('Zernio');
    expect(uploadMedia.mock.calls[0][0]).toBe(`${ORIGINE}${RELATIVE}`);
  });
});
