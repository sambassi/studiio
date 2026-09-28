/**
 * Cron de publication — un montage PERIME ne part jamais.
 *
 * `metadata.montagePerime === true` : le post a ete modifie (Modifier ->
 * Enregistrer) sans etre re-rendu ; `renderedVideoUrl` montre l'ancienne
 * version. Le cron doit le passer en `failed` avec un message clair, sans
 * AUCUN appel au fournisseur (Zernio ou reseau direct), et ne jamais le
 * reprendre de lui-meme.
 *
 * Default safe : drapeau absent ou `false` -> publication comme avant.
 * Tout est en memoire : aucune base, aucun appel reseau.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Base en memoire, qui EVALUE les filtres PostgREST utilises ────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = { scheduled_posts: [], social_accounts: [] };
const resets: string[][] = [];
let echecEcritureFailed = false;

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
    // Panne simulee de l'ecriture `failed` : rien n'est ecrit.
    if (maj && echecEcritureFailed && table === 'scheduled_posts' && (maj as Ligne).status === 'failed') {
      return { data: null, error: { message: 'panne simulee' } };
    }
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

// ── Zernio : tout est simule ─────────────────────────────────────────────
const comptesConnectes = vi.fn(async (..._a: unknown[]) => [{ platform: 'instagram', accountId: 'acc-ig' }] as unknown[]);
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
  comptesConnectes: (...a: unknown[]) => comptesConnectes(...a),
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
  echecEcritureFailed = false;
  createPost.mockClear();
  comptesConnectes.mockClear();
  comptesConnectes.mockImplementation(async () => [{ platform: 'instagram', accountId: 'acc-ig' }]);
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

const MESSAGE = 'Cette vidéo a été modifiée. Régénère-la avant de la publier.';

describe('Cron — montage perime', () => {
  it('passe le post en failed avec le message, sans appeler Zernio', async () => {
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'https://cdn.example/ancien.mp4', montagePerime: true } })];
    const r = await lancerCron(true);
    expect(createPost).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(comptesConnectes).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(r.results[0]).toMatchObject({ postId: 'p1', success: false });
    const ligne = base.scheduled_posts[0];
    expect(ligne.status).toBe('failed');
    expect(ligne.metadata.error).toBe(MESSAGE);
    // Le drapeau et le reste de la metadata sont conserves.
    expect(ligne.metadata.montagePerime).toBe(true);
    expect(ligne.metadata.renderedVideoUrl).toBe('https://cdn.example/ancien.mp4');
  });

  it('chemin reseau direct (sans Zernio) : aucune requete sortante non plus', async () => {
    comptesConnectes.mockImplementation(async () => []);
    base.social_accounts = [{ user_id: 'user-1', platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'https://cdn.example/ancien.mp4', montagePerime: true } })];
    await lancerCron(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(base.scheduled_posts[0].status).toBe('failed');
  });

  it('n est pas repris aux passages suivants (ni selection, ni reset des bloques)', async () => {
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', montagePerime: true } })];
    await lancerCron(true);
    expect(base.scheduled_posts[0].status).toBe('failed');
    // Du temps passe : le reset ne vise que `publishing`.
    base.scheduled_posts[0].updated_at = IL_Y_A_UNE_HEURE();
    const r2 = await lancerCron();
    const r3 = await lancerCron(true);
    expect(resets.flat()).not.toContain('p1');
    expect(base.scheduled_posts[0].status).toBe('failed');
    expect(createPost).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((r2.results ?? []).length + (r3.results ?? []).length).toBe(0);
  });

  it('reste a `publishing` (ecriture ratee) : reset puis bloque a nouveau, jamais publie', async () => {
    base.scheduled_posts = [post('p1', {
      status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(),
      metadata: { renderedVideoUrl: 'x', montagePerime: true },
    })];
    await lancerCron();
    expect(createPost).not.toHaveBeenCalled();
    expect(base.scheduled_posts[0].status).toBe('failed');
  });
});

describe('Cron — default safe', () => {
  it('drapeau absent : publie via Zernio comme avant', async () => {
    base.scheduled_posts = [post('p1')];
    const r = await lancerCron(true);
    expect(r.results[0]).toMatchObject({ success: true, details: 'Zernio' });
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(base.scheduled_posts[0].status).toBe('publishing');
  });

  it('drapeau a false (apres Regenerer) : publie le nouveau montage', async () => {
    base.scheduled_posts = [post('p1', { media_url: null, metadata: { renderedVideoUrl: 'https://cdn.example/nouveau.mp4', montagePerime: false } })];
    const r = await lancerCron(true);
    expect(r.results[0]).toMatchObject({ success: true, details: 'Zernio' });
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(uploadMedia.mock.calls[0])).toContain('nouveau.mp4');
    expect(base.scheduled_posts[0].metadata.error).toBeUndefined();
  });

  it('drapeau non booleen (`"true"`) : traite comme a jour', async () => {
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', montagePerime: 'true' } })];
    await lancerCron(true);
    expect(createPost).toHaveBeenCalledTimes(1);
  });
});

describe('Cron — montage serveur et ecriture en echec', () => {
  it('un montage SERVEUR perime recoit le message qui nomme « Garder la video actuelle »', async () => {
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', montagePerime: true, serverRendered: true } })];
    await lancerCron(true);
    expect(createPost).not.toHaveBeenCalled();
    expect(base.scheduled_posts[0].status).toBe('failed');
    expect(base.scheduled_posts[0].metadata.error).toContain('Garder la vidéo actuelle');
    expect(base.scheduled_posts[0].metadata.error).not.toContain('Régénère-la');
  });

  it('l ecriture `failed` en echec est journalisee, et rien ne part', async () => {
    echecEcritureFailed = true;
    base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', montagePerime: true } })];
    await lancerCron(true);
    expect(createPost).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const erreurs = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(' '));
    expect(erreurs.some((e) => e.includes('p1') && e.includes('panne simulee'))).toBe(true);
    // Reste a `publishing` (le claim a eu lieu) : le reset le rendra, le
    // passage suivant le bloquera de nouveau.
    expect(base.scheduled_posts[0].status).toBe('publishing');
  });
});
