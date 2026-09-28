import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Callback OAuth social — page de retour.
 *
 * Ce que ces tests protègent :
 *  1. une exception ne doit plus afficher son message ni sa stack trace à
 *     l'utilisateur (fuite d'information) : message générique côté page,
 *     détail dans console.error côté serveur ;
 *  2. le postMessage vers la fenêtre parente cible l'origine de l'application,
 *     jamais '*' ;
 *  3. le chemin de succès est inchangé.
 */

const SECRET = 'secret-de-test-uniquement-pas-un-vrai';
const USER = '11111111-1111-4111-8111-111111111111';

const authMock = vi.fn();
const upserts: Record<string, unknown>[] = [];
let upsertError: unknown = null;

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    upsert: async (row: Record<string, unknown>) => {
      upserts.push(row);
      return { data: null, error: upsertError };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

const { createOAuthState } = await import('@/lib/social/oauth-state');
const { GET } = await import('@/app/api/social/callback/route');

const GENERIQUE = 'Une erreur est survenue pendant la connexion';

let fetchImpl: (url: string) => Response;
const fetchMock = vi.fn(async (input: unknown) => fetchImpl(String(input)));
const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

/** Réponses factices : aucun appel OAuth réel. */
function fakeFetchOk(url: string): Response {
  if (url.includes('oauth2.googleapis.com')) return j({ access_token: 'yt', refresh_token: 'r', expires_in: 3600 });
  if (url.includes('youtube/v3/channels')) return j({ items: [{ id: 'chan', snippet: { title: 'Chaine' } }] });
  if (url.includes('graph.facebook.com') && url.includes('oauth/access_token')) return j({ access_token: 'tok' });
  if (url.includes('graph.facebook.com') && url.includes('me/accounts')) return j({ data: [] });
  throw new Error('fetch inattendu: ' + url);
}

async function callback(params: Record<string, string>, base = 'http://localhost') {
  const qs = new URLSearchParams(params).toString();
  const res = await GET(new Request(`${base}/api/social/callback?${qs}`) as never);
  return res.text();
}

/** Toutes les cibles passées à postMessage dans la page. */
function postMessageTargets(html: string): string[] {
  return [...html.matchAll(/postMessage\(\{[^}]*\},\s*("[^"]*"|'[^']*')\)/g)].map((m) => JSON.parse(m[1].replace(/^'|'$/g, '"')));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.stubEnv('NEXTAUTH_URL', '');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  vi.stubGlobal('fetch', fetchMock);
  fetchImpl = fakeFetchOk;
  fetchMock.mockClear();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: USER } });
  upserts.length = 0;
  upsertError = null;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callback social : aucune fuite d erreur', () => {
  it('exception inattendue → message générique, ni message ni stack trace dans le HTML', async () => {
    fetchImpl = () => {
      throw new Error('SECRET_INTERNE connexion refusee 10.0.0.12:5432');
    };
    const html = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });

    expect(html).toContain('social-oauth-error');
    expect(html).toContain(GENERIQUE);
    expect(html).not.toContain('SECRET_INTERNE');
    expect(html).not.toContain('10.0.0.12');
    // Aucune trace de pile : ni "at fonction (fichier:ligne)", ni chemin de source.
    expect(html).not.toMatch(/\bat\s+\S+\s+\(/);
    expect(html).not.toMatch(/\.(ts|js):\d+/);
    expect(html).not.toContain('route.ts');
    expect(html).not.toContain(' | ');
  });

  it('le détail (message + stack) part dans console.error côté serveur', async () => {
    fetchImpl = () => {
      throw new Error('SECRET_INTERNE');
    };
    await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });

    const appel = consoleError.mock.calls.find((c: unknown[]) => c[0] === '[SOCIAL_CALLBACK_ERROR]');
    expect(appel).toBeDefined();
    const detail = appel![1] as { platform: string; msg: string; stack: string };
    expect(detail.platform).toBe('youtube');
    expect(detail.msg).toBe('SECRET_INTERNE');
    expect(detail.stack).toContain('SECRET_INTERNE');
  });

  it('erreur renvoyée par la plateforme (message brut) → message générique', async () => {
    fetchImpl = (url) => {
      if (url.includes('oauth2.googleapis.com')) return j({ error: 'invalid_grant', error_description: 'Bad Request interne xyz' });
      return fakeFetchOk(url);
    };
    const html = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });
    expect(html).toContain(GENERIQUE);
    expect(html).not.toContain('interne xyz');
  });

  it('message rédigé pour l utilisateur (aucune Page Facebook) → conservé', async () => {
    const html = await callback({ platform: 'facebook', code: 'c', state: createOAuthState(USER) });
    expect(html).toContain('Aucune Page Facebook');
    expect(html).not.toContain(GENERIQUE);
  });

  it('erreur base de données → ni code, ni message, ni hint Postgres dans le HTML', async () => {
    upsertError = { code: '42P01', message: 'relation "social_accounts" does not exist', hint: 'schema cache' };
    const html = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });
    expect(html).toContain('social-oauth-error');
    expect(html).not.toContain('42P01');
    expect(html).not.toContain('does not exist');
    expect(html).not.toContain('schema cache');
  });

  it('paramètre de requête hostile → ni balise injectée, ni sortie de la chaîne JS', async () => {
    const html = await callback({ error: `\\'</script><script>alert(1)</script>` });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('</script><script>');
    // La chaîne JS du postMessage reste un littéral JSON valide.
    const m = html.match(/message: ("(?:[^"\\]|\\.)*")/);
    expect(m).not.toBeNull();
    expect(() => JSON.parse(m![1])).not.toThrow();
  });
});

describe('callback social : postMessage cible l origine de l application', () => {
  it('jamais la cible "*"', async () => {
    const ok = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });
    const ko = await callback({ platform: 'youtube' });
    expect(ok).not.toMatch(/postMessage\([^)]*['"]\*['"]\)/);
    expect(ko).not.toMatch(/postMessage\([^)]*['"]\*['"]\)/);
  });

  it('NEXTAUTH_URL prioritaire (même source que /api/social/connect)', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://studiio.pro/');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://autre.example');
    const html = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });
    expect(postMessageTargets(html)).toEqual(['https://studiio.pro']);
  });

  it('à défaut, NEXT_PUBLIC_APP_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.studiio.pro/chemin');
    const html = await callback({ platform: 'youtube' });
    expect(postMessageTargets(html)).toEqual(['https://app.studiio.pro']);
  });

  it('à défaut, l origine de la requête', async () => {
    const html = await callback({ platform: 'youtube' }, 'http://localhost:3000');
    expect(postMessageTargets(html)).toEqual(['http://localhost:3000']);
  });

  it('variable mal formée → on passe à la source suivante', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'pas une url');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
    const html = await callback({ platform: 'youtube' });
    expect(postMessageTargets(html)).toEqual(['https://studiio.pro']);
  });
});

describe('callback social : chemin de succès inchangé', () => {
  it('upsert sous la session + page de succès qui poste social-oauth-success et se ferme', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://studiio.pro');
    const html = await callback({ platform: 'youtube', code: 'c', state: createOAuthState(USER) });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ user_id: USER, platform: 'youtube', account_id: 'chan', account_name: 'Chaine', connected: true });
    expect(html).toContain('<title>Connexion reussie</title>');
    expect(html).toContain(`postMessage({ type: 'social-oauth-success', message: "youtube connecte avec succes!" }, "https://studiio.pro")`);
    expect(html).toContain('youtube connecte avec succes!');
    expect(html).toContain('window.close()');
    expect(html).not.toContain('social-oauth-error');
  });
});
