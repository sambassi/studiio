/**
 * `POST /api/social/publish` refuse un montage PERIME (409), sans aucun appel
 * reseau ni ecriture.
 *
 * Le drapeau `montagePerime` est pose sur le post du Calendrier par Modifier
 * → Enregistrer. La route le lit sur la video, sur le post nomme par
 * l'appelant (`scheduledPostId`) et sur tout post relie a la video
 * (`video_id`). Default safe : sans drapeau, publication comme avant.
 *
 * Tout est simule : aucune base, aucun reseau social.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const MONTAGE = 'https://cdn.studiio.test/montage.webm';
const MESSAGE = 'Cette vidéo a été modifiée. Régénère-la avant de la publier.';

type Ligne = Record<string, unknown>;
let ligneVideo: Ligne | null = null;
let postsCalendrier: Ligne[] = [];
let comptesSociaux: Ligne[] = [];
let erreurPosts = false;
const ecritures: Array<{ table: string; op: string }> = [];
const requetes: string[] = [];

function makeQuery(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    insert: () => { ecritures.push({ table, op: 'insert' }); return api; },
    update: () => { ecritures.push({ table, op: 'update' }); return api; },
    delete: () => { ecritures.push({ table, op: 'delete' }); return api; },
    single: async () => (
      table === 'videos'
        ? { data: ligneVideo, error: ligneVideo ? null : { message: 'not found' } }
        : { data: null, error: null }
    ),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (ok: (v: unknown) => unknown) => {
      if (table === 'scheduled_posts') {
        if (erreurPosts) return Promise.resolve({ data: null, error: { message: 'panne' } }).then(ok);
        const lignes = postsCalendrier.filter((l) => filtres.every(([c, v]) => l[c] === v));
        return Promise.resolve({ data: lignes, error: null }).then(ok);
      }
      return Promise.resolve({ data: comptesSociaux, error: null }).then(ok);
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'user-1', email: 'a@b.c' } }) }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton-simule' }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false,
  canUseWhatsApp: () => false,
  broadcastWhatsApp: async () => ({ ok: false }),
  resolveRecipients: async () => [],
  formatBroadcastFailures: () => '',
}));

const { POST } = await import('@/app/api/social/publish/route');

const publier = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const VIDEO = { id: 'v1', title: 't', status: 'draft', video_url: null, metadata: { renderedVideoUrl: MONTAGE } };

beforeEach(() => {
  ecritures.length = 0;
  requetes.length = 0;
  ligneVideo = { ...VIDEO };
  postsCalendrier = [];
  erreurPosts = false;
  comptesSociaux = [{ platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    requetes.push(String(url));
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ id: 'post-simule' }), arrayBuffer: async () => new ArrayBuffer(8),
    };
  }));
});

describe('Route de publication manuelle — montage perime', () => {
  it('409 si le post nomme (scheduledPostId) est perime, sans appel reseau ni ecriture', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'user-1', video_id: null, metadata: { montagePerime: true } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'], scheduledPostId: 'sp1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(MESSAGE);
    expect(requetes).toEqual([]);
    expect(ecritures).toEqual([]);
  });

  it('409 si un post relie a la video (video_id) est perime', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'user-1', video_id: 'v1', metadata: { montagePerime: true } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'] });
    expect(res.status).toBe(409);
    expect(requetes).toEqual([]);
  });

  it('409 si la video elle-meme porte le drapeau', async () => {
    ligneVideo = { ...VIDEO, metadata: { renderedVideoUrl: MONTAGE, montagePerime: true } };
    const res = await publier({ videoId: 'v1', platforms: ['instagram'] });
    expect(res.status).toBe(409);
    expect(requetes).toEqual([]);
  });

  it('le post perime d un AUTRE utilisateur n est pas lu (filtre user_id)', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'autre', video_id: 'v1', metadata: { montagePerime: true } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'], scheduledPostId: 'sp1' });
    expect(res.status).not.toBe(409);
  });

  it('montage SERVEUR perime : 409 avec le message qui nomme l issue « Garder la video actuelle »', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'user-1', video_id: 'v1', metadata: { montagePerime: true, serverRendered: true } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'] });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Garder la vidéo actuelle');
    expect(requetes).toEqual([]);
  });

  it('lecture des posts en echec : refus (500), rien ne part', async () => {
    erreurPosts = true;
    const res = await publier({ videoId: 'v1', platforms: ['instagram'] });
    expect(res.status).toBe(500);
    expect(requetes).toEqual([]);
  });
});

describe('Route de publication manuelle — default safe', () => {
  it('drapeau absent : publie le montage comme avant', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'user-1', video_id: 'v1', metadata: { renderedVideoUrl: MONTAGE } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'], scheduledPostId: 'sp1' });
    expect(res.status).not.toBe(409);
    expect(requetes.some((u) => u.includes('graph.facebook.com'))).toBe(true);
  });

  it('drapeau a false (apres Regenerer) : la publication passe', async () => {
    postsCalendrier = [{ id: 'sp1', user_id: 'user-1', video_id: 'v1', metadata: { montagePerime: false } }];
    const res = await publier({ videoId: 'v1', platforms: ['instagram'], scheduledPostId: 'sp1' });
    expect(res.status).not.toBe(409);
    expect(requetes.length).toBeGreaterThan(0);
  });
});

describe('leverMontagePerime — ne retire que l erreur du blocage', () => {
  it('erreur du blocage (navigateur ou serveur) → retiree', async () => {
    const m = await import('@/lib/creer/montage-perime');
    expect(m.leverMontagePerime({ error: m.MESSAGE_MONTAGE_PERIME })).toEqual({ montagePerime: false, error: null });
    expect(m.leverMontagePerime({ error: m.MESSAGE_MONTAGE_PERIME_SERVEUR })).toEqual({ montagePerime: false, error: null });
  });
  it('autre erreur ou aucune → seul le drapeau change', async () => {
    const m = await import('@/lib/creer/montage-perime');
    expect(m.leverMontagePerime({ error: 'Instagram: jeton expire' })).toEqual({ montagePerime: false });
    expect(m.leverMontagePerime(null)).toEqual({ montagePerime: false });
  });
});
