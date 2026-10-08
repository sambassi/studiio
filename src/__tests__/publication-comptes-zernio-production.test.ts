/**
 * « 4 réseaux connectés » sur la page Réseaux, mais « Aucun compte social
 * connecté » à la publication — reproduction EXACTE de la production
 * (post 7f4998ac, 2026-10-08).
 *
 * Causes, cumulées et vérifiées en production :
 * 1. Le Calendrier écrit `platforms: ["Instagram"]` ; le cron comparait à
 *    `zernio_accounts.platform = 'instagram'` → zéro cible Zernio.
 * 2. Le cron appelait `droitDePublier(userId, undefined)` : sans email,
 *    l'admin n'était pas reconnu ; le coupe-circuit fermé le refusait.
 * 3. Dans les deux cas, repli SILENCIEUX sur l'ancien chemin Meta
 *    (`social_accounts`, vide) → « Aucun compte social connecté ».
 *
 * Ici, les VRAIES fonctions `comptesConnectes` / `droitDePublier` /
 * `resoudreCibles` tournent sur une base en mémoire. Aucun appel Zernio réel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resoudreCibles, reseauxZernioDemandes } from '@/lib/social/publishing';

// ── Base en memoire, qui EVALUE les filtres PostgREST utilises ────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = { scheduled_posts: [], social_accounts: [], users: [], zernio_accounts: [], site_settings: [] };
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
    in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(valeur(l, c))); return b; },
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

// ── Zernio : simulé ──────────────────────────────────────────────────────
const createPost = vi.fn(async (..._a: unknown[]) => ({ _id: 'zernio-post-1' }));
const uploadMedia = vi.fn(async () => 'https://zernio.example/tmp/media.mp4');
vi.mock('@/lib/social/zernio', () => {
  class ZernioError extends Error {
    paymentRequired = false;
    retryable = false;
  }
  return { createPost, uploadMedia, ZernioError, zernioConfigured: () => true };
});

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
vi.mock('@/lib/admin', () => ({ isAdmin: (e?: string | null) => e === 'admin@studiio.test' }));

const SECRET = 'secret-cron-test';
const MP4 = 'https://cdn.example/rendus/montage.mp4';
const fetchGlobal = vi.fn(async (url: unknown) => { throw new Error(`reseau ferme en test : ${String(url)}`); });

function compte(platform: string, extra: Ligne = {}): Ligne {
  return { user_id: 'user-1', profile_id: 'prof-1', account_id: `acc-${platform}`, platform, username: `@${platform}`, status: 'connected', ...extra };
}
const QUATRE = () => ['instagram', 'facebook', 'tiktok', 'youtube'].map((p) => compte(p));

function post(platforms: string[], extra: Ligne = {}): Ligne {
  return {
    id: 'post-1', user_id: 'user-1', title: 'LE SPORT LE PLUS COMPLET', caption: 'legende',
    platforms, status: 'scheduled', scheduled_date: '2026-01-01', scheduled_time: '08:00',
    updated_at: new Date().toISOString(), video_id: null, videos: null,
    users: { email: 'admin@studiio.test', name: 'Admin' },
    media_url: MP4, metadata: { renderedVideoUrl: MP4 }, ...extra,
  };
}

async function lancerCron() {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(new NextRequest('http://localhost:3000/api/cron/publish?force=true', {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
  return res.json();
}
const cibles = () => (createPost.mock.calls[0]?.[0] as { platforms?: Array<{ platform: string; accountId: string }> } | undefined)?.platforms ?? [];
const erreur = () => String(base.scheduled_posts[0]?.metadata?.error ?? '');

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  base.scheduled_posts = [];
  base.social_accounts = [];
  // Production : admin, option non cochée, coupe-circuit FERMÉ.
  base.users = [{ id: 'user-1', email: 'admin@studiio.test', publishing_enabled: false, zernio_profile_id: 'prof-1' }];
  base.site_settings = [{ key: 'user_publishing_enabled', value: false }];
  base.zernio_accounts = QUATRE();
  createPost.mockClear();
  uploadMedia.mockClear();
  fetchGlobal.mockClear();
  vi.stubGlobal('fetch', fetchGlobal);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('résolution canonique (pure)', () => {
  const comptes = QUATRE().map((c) => ({ accountId: c.account_id, platform: c.platform }));
  it.each([
    [['Instagram'], ['instagram']],
    [['instagram'], ['instagram']],
    [['Instagram', 'facebook', 'TikTok', 'YouTube'], ['instagram', 'facebook', 'tiktok', 'youtube']],
    [['INSTAGRAM', ' Instagram ', 'Email'], ['instagram']],
  ])('%j → cibles %j', (demandees, attendues) => {
    const r = resoudreCibles(demandees, comptes);
    expect(r.cibles.map((c) => c.platform)).toEqual(attendues);
    expect(r.manquants).toEqual([]);
  });
  it('4 comptes, 4 réseaux demandés : 4 connectés, 4 cibles', () => {
    const r = resoudreCibles(['Instagram', 'Facebook', 'TikTok', 'YouTube'], comptes);
    expect(r.comptes).toHaveLength(4);
    expect(r.cibles).toHaveLength(4);
  });
  it('aucun compte réellement connecté : zéro cible, manquants nommés', () => {
    const r = resoudreCibles(['Instagram', 'Facebook'], []);
    expect(r.cibles).toEqual([]);
    expect(r.manquants).toEqual(['instagram', 'facebook']);
  });
  it('les canaux non Zernio ne sont pas des réseaux Zernio', () => {
    expect(reseauxZernioDemandes(['Email', 'WhatsApp', 'Afroboost.com'])).toEqual([]);
  });
});

describe('cron — situation de production', () => {
  it('post « Instagram » (majuscule), 4 comptes Zernio, admin sans email passé : publié via Zernio', async () => {
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(cibles()).toEqual([{ platform: 'instagram', accountId: 'acc-instagram' }]);
    expect(erreur()).not.toContain('Aucun compte social connecté');
    expect(base.scheduled_posts[0].status).toBe('publishing');
  });

  it('les 4 libellés du Calendrier : 4 cibles, jamais « No connected social accounts »', async () => {
    base.scheduled_posts = [post(['Instagram', 'Facebook', 'TikTok', 'YouTube'])];
    await lancerCron();
    expect(cibles().map((c) => c.platform)).toEqual(['instagram', 'facebook', 'tiktok', 'youtube']);
    expect(erreur()).not.toContain('No connected social accounts');
  });

  it('post créé AVANT la connexion du compte : le compte ajouté ensuite est pris en compte', async () => {
    base.zernio_accounts = [];
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(createPost).not.toHaveBeenCalled();
    expect(erreur()).toContain('Aucun compte connecté pour : Instagram');

    base.zernio_accounts = QUATRE();
    Object.assign(base.scheduled_posts[0], { status: 'scheduled', metadata: { renderedVideoUrl: MP4 } });
    await lancerCron();
    expect(cibles()).toEqual([{ platform: 'instagram', accountId: 'acc-instagram' }]);
  });

  it('comptes d’un AUTRE utilisateur : jamais utilisés', async () => {
    base.zernio_accounts = QUATRE().map((c) => ({ ...c, user_id: 'user-2' }));
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(createPost).not.toHaveBeenCalled();
    expect(erreur()).toContain('Aucun compte connecté pour : Instagram');
  });

  it('profile_id du compte ≠ users.zernio_profile_id : le compte de l’utilisateur reste utilisé (résolution par user_id)', async () => {
    base.zernio_accounts = QUATRE().map((c) => ({ ...c, profile_id: 'prof-ancien' }));
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(cibles()).toEqual([{ platform: 'instagram', accountId: 'acc-instagram' }]);
  });

  it('compte déconnecté : zéro cible, échec explicite', async () => {
    base.zernio_accounts = [compte('instagram', { status: 'disconnected' })];
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(createPost).not.toHaveBeenCalled();
    expect(erreur()).toContain('Aucun compte connecté pour : Instagram');
  });

  it('JAMAIS de repli sur l’ancien chemin Meta, même avec un ancien compte `social_accounts`', async () => {
    base.zernio_accounts = [];
    base.social_accounts = [{ id: 'old', user_id: 'user-1', platform: 'instagram', connected: true, access_token: 'vieux', account_id: '17841438810425625' }];
    base.scheduled_posts = [post(['Instagram'])];
    await lancerCron();
    expect(fetchGlobal.mock.calls.some((c) => String(c[0]).includes('graph.facebook.com'))).toBe(false);
    expect(erreur()).toContain('Aucun compte connecté pour : Instagram');
  });

  it('non-admin, coupe-circuit fermé : refus EXPLICITE, sans repli', async () => {
    base.users = [{ id: 'user-1', email: 'client@studiio.test', publishing_enabled: true, zernio_profile_id: 'prof-1' }];
    base.social_accounts = [{ id: 'old', user_id: 'user-1', platform: 'instagram', connected: true, access_token: 'vieux', account_id: '17841438810425625' }];
    base.scheduled_posts = [post(['Instagram'], { users: { email: 'client@studiio.test', name: 'C' } })];
    await lancerCron();
    expect(createPost).not.toHaveBeenCalled();
    expect(fetchGlobal.mock.calls.some((c) => String(c[0]).includes('graph.facebook.com'))).toBe(false);
    expect(erreur()).toContain('momentanément désactivée');
  });
});
