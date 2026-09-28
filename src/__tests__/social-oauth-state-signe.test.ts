import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Connexion des réseaux sociaux — `state` OAuth signé.
 *
 * Ce que ces tests protègent : le callback faisait confiance à l'identifiant
 * contenu dans un `state` non signé. Un tiers qui connaissait l'identifiant
 * d'une victime pouvait rattacher son propre compte social au profil de
 * celle-ci. Désormais : `state` signé + session obligatoire + écriture sous
 * l'identifiant de session uniquement.
 */

const SECRET = 'secret-de-test-uniquement-pas-un-vrai';
const VICTIME = '11111111-1111-4111-8111-111111111111';
const ATTAQUANT = '22222222-2222-4222-8222-222222222222';

const authMock = vi.fn();

interface Upsert { table: string; row: Record<string, unknown>; opts: unknown }
const upserts: Upsert[] = [];
let upsertError: unknown = null;

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => ({
    upsert: async (row: Record<string, unknown>, opts: unknown) => {
      upserts.push({ table, row, opts });
      return { data: null, error: upsertError };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

const { createOAuthState, verifyOAuthState, OAUTH_STATE_TTL_MS } = await import('@/lib/social/oauth-state');
const { GET } = await import('@/app/api/social/callback/route');
const { POST } = await import('@/app/api/social/connect/route');

/** Réponses factices des plateformes : aucun appel OAuth réel. */
function fakeFetch(url: string): Response {
  const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes('graph.facebook.com') && url.includes('oauth/access_token')) {
    return j({ access_token: 'tok', expires_in: 3600 });
  }
  if (url.includes('graph.facebook.com') && url.includes('me/accounts')) {
    return j({ data: [{ id: 'page1', name: 'Page', access_token: 'ptok', instagram_business_account: { id: 'ig1' } }] });
  }
  if (url.includes('graph.facebook.com/v24.0/ig1')) return j({ username: 'ig_user' });
  if (url.includes('open.tiktokapis.com')) return j({ access_token: 'tt', refresh_token: 'r', open_id: 'openid123456', expires_in: 3600 });
  if (url.includes('oauth2.googleapis.com')) return j({ access_token: 'yt', refresh_token: 'r', expires_in: 3600 });
  if (url.includes('youtube/v3/channels')) return j({ items: [{ id: 'chan', snippet: { title: 'Chaine' } }] });
  throw new Error('fetch inattendu: ' + url);
}

const fetchMock = vi.fn(async (input: unknown) => fakeFetch(String(input)));

async function callback(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await GET(new Request(`http://localhost/api/social/callback?${qs}`) as never);
  return { status: res.status, html: await res.text() };
}
const isSuccess = (html: string) => html.includes('social-oauth-success');
const isError = (html: string) => html.includes('social-oauth-error');

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  authMock.mockReset();
  upserts.length = 0;
  upsertError = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('oauth-state : signature et validité', () => {
  it('un state valide est accepté et rend l identifiant', () => {
    const r = verifyOAuthState(createOAuthState(VICTIME));
    expect(r).toMatchObject({ ok: true, userId: VICTIME });
  });

  it('ne contient que des caractères sûrs dans une URL et pas l identifiant en clair', () => {
    const s = createOAuthState(VICTIME);
    expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(s).not.toContain(VICTIME);
  });

  it('refuse l ancien format userId:timestamp:random', () => {
    expect(verifyOAuthState(`${VICTIME}:${Date.now()}:abc`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuse un state absent', () => {
    expect(verifyOAuthState(null)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyOAuthState('')).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuse un state dont l identifiant a été substitué', () => {
    const parts = createOAuthState(ATTAQUANT).split('.');
    parts[1] = Buffer.from(VICTIME).toString('base64url');
    expect(verifyOAuthState(parts.join('.'))).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse une signature altérée', () => {
    const s = createOAuthState(VICTIME);
    const last = s.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyOAuthState(s.slice(0, -1) + last)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse un state signé avec un autre secret', () => {
    const s = createOAuthState(VICTIME);
    vi.stubEnv('AUTH_SECRET', 'un-autre-secret');
    expect(verifyOAuthState(s)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse un state expiré (au-delà de 15 min)', () => {
    const t0 = 1_700_000_000_000;
    const s = createOAuthState(VICTIME, t0);
    expect(verifyOAuthState(s, t0 + OAUTH_STATE_TTL_MS - 1000).ok).toBe(true);
    expect(verifyOAuthState(s, t0 + OAUTH_STATE_TTL_MS + 1000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuse un state émis dans le futur', () => {
    const t0 = 1_700_000_000_000;
    expect(verifyOAuthState(createOAuthState(VICTIME, t0 + 10 * 60 * 1000), t0)).toEqual({ ok: false, reason: 'expired' });
  });

  it('sans secret : pas d émission, et tout state est refusé', () => {
    const s = createOAuthState(VICTIME);
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(() => createOAuthState(VICTIME)).toThrow();
    expect(verifyOAuthState(s)).toEqual({ ok: false, reason: 'no_secret' });
  });
});

describe('POST /api/social/connect', () => {
  it('émet un state signé, vérifiable, pour l utilisateur de session', async () => {
    authMock.mockResolvedValue({ user: { id: VICTIME } });
    vi.stubEnv('YOUTUBE_CLIENT_ID', 'cid');
    const res = await POST({ json: async () => ({ platform: 'youtube' }) } as never);
    const body = await res.json();
    expect(body.success).toBe(true);
    const state = new URL(body.authUrl).searchParams.get('state');
    expect(verifyOAuthState(state)).toMatchObject({ ok: true, userId: VICTIME });
  });

  it('refuse sans session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST({ json: async () => ({ platform: 'youtube' }) } as never);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/social/callback', () => {
  it.each(['instagram', 'facebook', 'tiktok', 'youtube'])(
    '%s : state valide + session du même utilisateur → upsert sous l identifiant de session',
    async (platform) => {
      authMock.mockResolvedValue({ user: { id: VICTIME } });
      const { html } = await callback({ platform, code: 'c', state: createOAuthState(VICTIME) });
      expect(isSuccess(html)).toBe(true);
      expect(upserts).toHaveLength(1);
      expect(upserts[0].table).toBe('social_accounts');
      expect(upserts[0].row).toMatchObject({ user_id: VICTIME, platform, connected: true });
      expect(upserts[0].opts).toEqual({ onConflict: 'user_id,platform' });
    },
  );

  it('ATTAQUE : state forgé au nom de la victime, session de l attaquant → refusé, rien écrit', async () => {
    authMock.mockResolvedValue({ user: { id: ATTAQUANT } });
    const { html } = await callback({ platform: 'instagram', code: 'c', state: `${VICTIME}:${Date.now()}:abc` });
    expect(isError(html)).toBe(true);
    expect(upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state valide émis pour un autre utilisateur que la session → refusé, rien écrit', async () => {
    authMock.mockResolvedValue({ user: { id: ATTAQUANT } });
    const { html } = await callback({ platform: 'tiktok', code: 'c', state: createOAuthState(VICTIME) });
    expect(isError(html)).toBe(true);
    expect(upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sans session → refusé, même avec un state valide', async () => {
    authMock.mockResolvedValue(null);
    const { html } = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(VICTIME) });
    expect(isError(html)).toBe(true);
    expect(html).toContain('Session expiree');
    expect(upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state falsifié → refusé avant tout échange de code', async () => {
    authMock.mockResolvedValue({ user: { id: VICTIME } });
    const s = createOAuthState(VICTIME);
    const { html } = await callback({ platform: 'facebook', code: 'c', state: s.slice(0, -2) + 'zz' });
    expect(isError(html)).toBe(true);
    expect(html).toContain('State invalide');
    expect(upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state expiré → refusé', async () => {
    authMock.mockResolvedValue({ user: { id: VICTIME } });
    const vieux = createOAuthState(VICTIME, Date.now() - OAUTH_STATE_TTL_MS - 60_000);
    const { html } = await callback({ platform: 'youtube', code: 'c', state: vieux });
    expect(isError(html)).toBe(true);
    expect(html).toContain('expire');
    expect(upserts).toHaveLength(0);
  });

  it('state absent → refusé', async () => {
    authMock.mockResolvedValue({ user: { id: VICTIME } });
    const { html } = await callback({ platform: 'youtube', code: 'c' });
    expect(isError(html)).toBe(true);
    expect(upserts).toHaveLength(0);
  });

  it('erreur d écriture → message d erreur, aucune seconde tentative sous un autre identifiant', async () => {
    authMock.mockResolvedValue({ user: { id: VICTIME } });
    upsertError = { code: '23503', message: 'fk' };
    const { html } = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(VICTIME) });
    expect(isError(html)).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row.user_id).toBe(VICTIME);
  });
});
