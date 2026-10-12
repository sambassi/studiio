// @vitest-environment node
/**
 * IDOR DE STOCKAGE PAR LA SIGNATURE DE PUBLICATION (« adjoint confus »).
 *
 * `ensurePublicUrl` (route `api/social/publish` ET cron `api/cron/publish`)
 * signait avec le client ADMIN toute URL
 * `/storage/v1/object/(sign|authenticated|private)/<bucket>/<clé>` trouvée
 * dans le média d'un post — sans vérifier à qui appartenait l'objet. A
 * pouvait donc faire publier sur SES réseaux un objet privé de B.
 *
 * Ici : le module partagé (`lib/social/url-publication`), puis les deux
 * routes réellement appelées. Seuls sont doublés la base, la signature
 * (espion) et le réseau (`fetch` global capturé). Aucune publication réelle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const NONCE = '0123456789abcdef0123456789abcdef';
const GEN = '12345678-1234-4234-8234-123456789abc';
const O = 'https://cdn.studiio.test';
const S = `${O}/storage/v1/object`;
const REFUS = 'Média de publication refusé.';
const SIGNEE = 'https://minio.studiio.test/signe?X-Amz-Signature=ok';

// ── Signature espionnée ───────────────────────────────────────────────────
const signer = vi.fn(async (_cle: string, _duree: number) => ({ data: { signedUrl: SIGNEE }, error: null }));
const compartiments: string[] = [];

// ── Base en mémoire, partagée par les deux routes ─────────────────────────
type Ligne = Record<string, any>;
let ligneVideo: Ligne | null = null;
let comptesSociaux: Ligne[] = [];
let postCron: Ligne | null = null;
const majPosts: Ligne[] = [];

function chaine(table: string) {
  const appels: string[] = [];
  let maj: Ligne | null = null;
  const executer = () => {
    if (maj) {
      if (table === 'scheduled_posts') majPosts.push(maj);
      if (table === 'scheduled_posts' && maj.status === 'publishing' && appels.includes('select')) {
        return { data: postCron ? [{ id: postCron.id }] : [], error: null };
      }
      return { data: [], error: null };
    }
    if (appels.includes('insert')) return { data: null, error: null };
    if (table === 'scheduled_posts') return { data: postCron ? [postCron] : [], error: null };
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
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => {
          if (table === 'videos' && !maj) {
            return { data: ligneVideo, error: ligneVideo ? null : { message: 'not found' } };
          }
          return { data: null, error: null };
        };
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
    storage: {
      from: (bucket: string) => {
        compartiments.push(bucket);
        return { createSignedUrl: signer };
      },
    },
  };
  return { supabaseAdmin: client, supabase: client };
});

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: A, email: 'a@test.local' } }) }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton' }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false, canUseWhatsApp: () => false, broadcastWhatsApp: vi.fn(),
  resolveRecipients: async () => [], MAX_RECIPIENTS: 0, formatBroadcastFailures: () => '',
}));
// Cron : on force le chemin DIRECT historique (`social_accounts` + jointure
// `videos`) — le seul qui appelle `ensurePublicUrl`.
vi.mock('@/lib/social/publishing', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/publishing')>()),
  reseauxZernioDemandes: () => [],
  comptesConnectes: async () => [],
  droitDePublier: async () => ({ autorise: true }),
}));
vi.mock('@/lib/storage/fetch-media', () => ({ downloadMediaToFile: vi.fn() }));
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({ transcodeWebmToMp4WithLadder: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/social/subscribers', () => ({ fetchSubscribers: async () => [], unsubscribeUrl: () => '' }));
vi.mock('@/lib/email/unsubscribe', () => ({
  unsubscribeEndpoint: () => '', filterSuppressed: async (l: unknown[]) => l,
  isSuppressed: async () => false, canUnsubscribe: async () => false,
}));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));
// YouTube télécharge le média : doublé ici, l'URL reçue est capturée.
const lectures: string[] = [];
vi.mock('@/lib/social/media-publication', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/media-publication')>()),
  lireMediaPublication: vi.fn(async (url: string) => {
    lectures.push(url);
    return { octets: new Uint8Array(8), typeContenu: 'video/mp4' };
  }),
}));

// ── Réseau ────────────────────────────────────────────────────────────────
type AppelFetch = { url: string; corps: string };
let appelsFetch: AppelFetch[] = [];

beforeEach(() => {
  signer.mockClear();
  compartiments.length = 0;
  lectures.length = 0;
  majPosts.length = 0;
  appelsFetch = [];
  ligneVideo = null;
  postCron = null;
  comptesSociaux = [];
  process.env.CRON_SECRET = 'secret-cron-test';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appelsFetch.push({ url: String(url), corps: init?.body ? String(init.body) : '' });
    if (String(url).includes('graph.facebook.com')) return Response.json({ id: 'fb-1' });
    if (String(url).includes('tiktokapis.com')) return Response.json({ data: { publish_id: 'tt-1' } });
    if (String(url).includes('googleapis.com')) {
      return new Response('{}', { status: 200, headers: { location: 'https://upload.youtube.test/session' } });
    }
    if (String(url).includes('upload.youtube.test')) return Response.json({ id: 'yt-1' });
    throw new Error(`reseau ferme en test : ${url}`);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Objets PRIVÉS de B, sous toutes les formes de chemin signé.
const OBJETS_DE_B: Array<[string, string]> = [
  ['sign', `${S}/sign/videos/${B}/rendus/montage.mp4?token=abc`],
  ['authenticated', `${S}/authenticated/videos/${B}/rendus/montage.mp4`],
  ['private', `${S}/private/media/${B}/library/rush.mp4`],
  ['remontée encodée %2F', `${S}/sign/media/${A}/..%2F${B}/library/rush.mp4`],
  ['remontée %2e%2e', `${S}/sign/media/${A}/%2e%2e/${B}/library/rush.mp4`],
  ['préfixe propriétaire encodé', `${S}/sign/media/${A}%2F..%2F${B}/library/rush.mp4`],
  ['remontée littérale', `${S}/authenticated/media/${A}/../${B}/library/rush.mp4`],
  ['double encodage', `${S}/sign/media/${A}/%252e%252e/${B}/library/rush.mp4`],
  ['compartiment encodé', `${S}/sign/%6dedia/${B}/library/rush.mp4`],
  ['compartiment hors liste', `${S}/sign/secrets/${A}/library/rush.mp4`],
  ['préfixe partagé converted/', `${S}/sign/media/converted/123-x.mp4`],
  ['identifiant voisin', `${S}/sign/media/${A}x/library/rush.mp4`],
];

// Namespaces privés : refusés, à B comme à A (ils ont leurs routes authentifiées).
const NAMESPACES_PRIVES: Array<[string, string]> = [
  ['source avatar de B', `${S}/sign/media/${B}/avatar/source-1700000000000-${NONCE}.jpg`],
  ['consentement avatar de B', `${S}/sign/media/${B}/avatar/consent-1700000000000-${NONCE}.mp4`],
  ['voix avatar de B', `${S}/authenticated/media/${B}/avatar/audio-${GEN}.mp3`],
  ['montage autopilote de B', `${S}/sign/videos/${B}/autopilote/montages/r1/montage.mp4`],
  ['vignette d analyse de B', `${S}/sign/media/${B}/analyse/a1/vignette-01.jpg`],
  ['source avatar de A (soi-même)', `${S}/sign/media/${A}/avatar/source-1700000000000-${NONCE}.jpg`],
  ['montage autopilote de A (soi-même)', `${S}/sign/videos/${A}/autopilote/montages/r1/montage.mp4`],
  ['LUT de A (soi-même)', `${S}/private/media/${A}/lut/look.cube`],
];

// Médias légitimes de A.
const OBJETS_DE_A: Array<[string, string, string, string]> = [
  ['montage rendu (sign)', `${S}/sign/videos/${A}/rendus/montage.mp4?token=t`, 'videos', `${A}/rendus/montage.mp4`],
  ['bibliothèque (authenticated)', `${S}/authenticated/media/${A}/library/rush.mp4`, 'media', `${A}/library/rush.mp4`],
  ['vidéo avatar générée (private)', `${S}/private/media/${A}/avatar/${GEN}.mp4`, 'media', `${A}/avatar/${GEN}.mp4`],
  ['audio complet (propriétaire 2e segment)', `${S}/sign/audio/audio-complet/${A}/0123.mp3`, 'audio', `audio-complet/${A}/0123.mp3`],
  ['copie externe partagée', `${S}/sign/media/externes/0f0e0d0c0b0a.mp4`, 'media', 'externes/0f0e0d0c0b0a.mp4'],
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. Le module partagé
// ═══════════════════════════════════════════════════════════════════════════

describe('ensurePublicUrl(url, userId) — garde avant signature', () => {
  it.each(OBJETS_DE_B)('objet de B (%s) → refusé, aucune signature', async (_nom, url) => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    const { ErreurMediaPublication } = await import('@/lib/social/media-publication');
    const err = await ensurePublicUrl(url, A).catch((e) => e);
    expect(err).toBeInstanceOf(ErreurMediaPublication);
    expect(err.message).toBe(REFUS);
    expect(err.message).not.toContain(B);
    expect(signer).not.toHaveBeenCalled();
    expect(compartiments).toEqual([]);
  });

  it.each(NAMESPACES_PRIVES)('namespace privé (%s) → refusé, aucune signature', async (_nom, url) => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    await expect(ensurePublicUrl(url, A)).rejects.toThrow(REFUS);
    await expect(ensurePublicUrl(url, B)).rejects.toThrow(REFUS);
    expect(signer).not.toHaveBeenCalled();
  });

  it.each(OBJETS_DE_A)('objet de A (%s) → signé', async (_nom, url, bucket, cle) => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    expect(await ensurePublicUrl(url, A)).toBe(SIGNEE);
    expect(compartiments).toEqual([bucket]);
    expect(signer).toHaveBeenCalledWith(cle, 3600);
  });

  it('le même objet de A, demandé pour B → refusé', async () => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    await expect(ensurePublicUrl(OBJETS_DE_A[0][1], B)).rejects.toThrow(REFUS);
    expect(signer).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'a/b'])('publieur absent ou invalide (%s) → refusé', async (userId) => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    await expect(ensurePublicUrl(OBJETS_DE_A[0][1], userId)).rejects.toThrow(REFUS);
    expect(signer).not.toHaveBeenCalled();
  });

  it('URL publique ou externe : inchangée, rien à signer', async () => {
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    const pub = `${S}/public/media/${A}/library/rush.mp4`;
    expect(await ensurePublicUrl(pub, A)).toBe(pub);
    expect(await ensurePublicUrl('https://cdn.example/x.mp4', A)).toBe('https://cdn.example/x.mp4');
    expect(signer).not.toHaveBeenCalled();
  });

  it('échec de signature d un objet de A → URL d origine, comme avant', async () => {
    signer.mockResolvedValueOnce({ data: null, error: { message: 'x' } } as never);
    const { ensurePublicUrl } = await import('@/lib/social/url-publication');
    const url = OBJETS_DE_A[1][1];
    expect(await ensurePublicUrl(url, A)).toBe(url);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Route `api/social/publish` — publieur = session (A)
// ═══════════════════════════════════════════════════════════════════════════

async function publierSocial(plateforme: string) {
  const { POST } = await import('@/app/api/social/publish/route');
  const res = await POST({ json: async () => ({ videoId: 'v1', platforms: [plateforme] }) } as never);
  return res.json();
}

function compte(plateforme: string) {
  return { id: `c-${plateforme}`, user_id: A, platform: plateforme, connected: true, access_token: 'jeton', account_id: `id-${plateforme}` };
}

const HOTES: Record<string, string> = {
  instagram: 'graph.facebook.com', facebook: 'graph.facebook.com', tiktok: 'tiktokapis.com', youtube: 'googleapis.com',
};

describe('route social/publish — objet de B dans la vidéo de A', () => {
  const VARIANTES = OBJETS_DE_B.slice(0, 3).concat(NAMESPACES_PRIVES.slice(0, 1));

  describe.each(['instagram', 'facebook', 'tiktok', 'youtube'])('%s', (plateforme) => {
    it.each(VARIANTES)('%s → refusé, aucune signature, aucun appel réseau', async (_nom, url) => {
      ligneVideo = { id: 'v1', user_id: A, title: 'T', video_url: url, metadata: {} };
      comptesSociaux = [compte(plateforme)];
      const corps = await publierSocial(plateforme);
      expect(corps.success).toBe(false);
      expect(corps.results[0].message).toBe(REFUS);
      expect(JSON.stringify(corps)).not.toContain(B);
      expect(signer).not.toHaveBeenCalled();
      expect(lectures).toEqual([]);
      expect(appelsFetch.some((a) => a.url.includes(HOTES[plateforme]))).toBe(false);
    });
  });
});

describe('route social/publish — objet de A : signé puis publié', () => {
  it.each(['facebook', 'tiktok'])('%s reçoit l URL signée', async (plateforme) => {
    ligneVideo = { id: 'v1', user_id: A, title: 'T', video_url: OBJETS_DE_A[0][1], metadata: {} };
    comptesSociaux = [compte(plateforme)];
    const corps = await publierSocial(plateforme);
    expect(corps.success).toBe(true);
    expect(signer).toHaveBeenCalledWith(`${A}/rendus/montage.mp4`, 3600);
    const appel = appelsFetch.find((a) => a.url.includes(HOTES[plateforme]));
    expect(appel?.corps).toContain(SIGNEE);
  });

  it('youtube télécharge l URL signée', async () => {
    ligneVideo = { id: 'v1', user_id: A, title: 'T', video_url: OBJETS_DE_A[1][1], metadata: {} };
    comptesSociaux = [compte('youtube')];
    await publierSocial('youtube');
    expect(lectures).toEqual([SIGNEE]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Cron — chemin direct historique, publieur = post.user_id (A)
//    `videos.video_url` (jointure `videos:video_id`) suit la MÊME règle.
// ═══════════════════════════════════════════════════════════════════════════

async function lancerCron() {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(new NextRequest('http://localhost:3000/api/cron/publish?force=true', {
    headers: { authorization: 'Bearer secret-cron-test' },
  }));
  return res.json();
}

function fabriquerPost(plateforme: string, media: { media_url?: string | null; video?: Ligne | null }): Ligne {
  return {
    id: 'post-1', user_id: A, title: 'T', caption: 'legende',
    platforms: [plateforme], status: 'scheduled',
    scheduled_date: '2026-01-01', scheduled_time: '08:00',
    video_id: media.video ? 'v1' : null, videos: media.video ?? null,
    users: { email: 'a@test.local', name: 'A' },
    media_url: media.media_url ?? null, metadata: {},
  };
}

describe('cron — objet de B → refusé, motif neutre dans metadata', () => {
  const sources = [
    ['media_url du post', (url: string) => ({ media_url: url })],
    // Post de A relié à une ligne `videos` portant l'objet de B (ou à la
    // vidéo de B elle-même) : seule compte la propriété du PUBLIEUR.
    ['videos.video_url (ligne historique)', (url: string) => ({ video: { id: 'v1', user_id: A, title: 'T', video_url: url } })],
    ['videos.video_url d une vidéo de B', (url: string) => ({ video: { id: 'v1', user_id: B, title: 'T', video_url: url } })],
  ] as const;

  describe.each(['instagram', 'facebook', 'tiktok', 'youtube'])('%s', (plateforme) => {
    it.each(sources)('%s', async (_nom, fabrique) => {
      comptesSociaux = [compte(plateforme)];
      postCron = fabriquerPost(plateforme, fabrique(OBJETS_DE_B[0][1]));
      const corps = await lancerCron();
      expect(signer).not.toHaveBeenCalled();
      expect(lectures).toEqual([]);
      expect(appelsFetch.some((a) => a.url.includes(HOTES[plateforme]))).toBe(false);
      expect(corps.results[0].success).toBe(false);
      const finale = majPosts.find((m) => m.metadata?.cron_publish_results);
      expect(finale?.metadata.cron_publish_results[0].error).toBe(REFUS);
      expect(JSON.stringify(finale)).not.toContain(B);
    });
  });

  it.each(NAMESPACES_PRIVES.slice(0, 4))('namespace privé (%s) → refusé', async (_nom, url) => {
    comptesSociaux = [compte('facebook')];
    postCron = fabriquerPost('facebook', { video: { id: 'v1', user_id: A, title: 'T', video_url: url } });
    await lancerCron();
    expect(signer).not.toHaveBeenCalled();
    expect(appelsFetch.some((a) => a.url.includes('graph.facebook.com'))).toBe(false);
  });
});

describe('cron — objet de A → signé puis publié', () => {
  it.each(['facebook', 'tiktok'])('%s via media_url', async (plateforme) => {
    comptesSociaux = [compte(plateforme)];
    postCron = fabriquerPost(plateforme, { media_url: OBJETS_DE_A[0][1] });
    const corps = await lancerCron();
    expect(corps.results[0].success).toBe(true);
    expect(signer).toHaveBeenCalledWith(`${A}/rendus/montage.mp4`, 3600);
    expect(appelsFetch.find((a) => a.url.includes(HOTES[plateforme]))?.corps).toContain(SIGNEE);
  });

  it('facebook via videos.video_url (ligne historique de A)', async () => {
    comptesSociaux = [compte('facebook')];
    postCron = fabriquerPost('facebook', { video: { id: 'v1', user_id: A, title: 'T', video_url: OBJETS_DE_A[1][1] } });
    const corps = await lancerCron();
    expect(corps.results[0].success).toBe(true);
    expect(signer).toHaveBeenCalledWith(`${A}/library/rush.mp4`, 3600);
  });

  it('youtube télécharge l URL signée', async () => {
    comptesSociaux = [compte('youtube')];
    postCron = fabriquerPost('youtube', { media_url: OBJETS_DE_A[1][1] });
    await lancerCron();
    expect(lectures).toEqual([SIGNEE]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Une seule implémentation
// ═══════════════════════════════════════════════════════════════════════════

describe('plus de copie locale de ensurePublicUrl', () => {
  it.each(['src/app/api/social/publish/route.ts', 'src/app/api/cron/publish/route.ts'])('%s importe le module partagé', async (fichier) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(fichier, 'utf8');
    expect(src).not.toMatch(/function ensurePublicUrl/);
    expect(src).toContain("from '@/lib/social/url-publication'");
    expect(src).not.toMatch(/ensurePublicUrl\([^,)]*\)/);
  });
});
