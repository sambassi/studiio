import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P1 — identifiant fantôme à la première connexion OAuth.
 *
 * Sans adaptateur, Auth.js fabrique `user.id` avec `crypto.randomUUID()`.
 * Si la base ne répond pas au premier `jwt`, cet UUID ne doit JAMAIS être
 * figé dans le jeton : il passerait `UUID_RE` et le callback `session` ne
 * retenterait plus la résolution par e-mail (0 crédit jusqu'à reconnexion).
 *
 * La base est simulée : chaque requête `from('users')` consomme la réponse
 * suivante de `reponses` (ou lève si l'entrée est une Error).
 */

const REEL = '11111111-2222-4333-8444-555555555555';
const FANTOME = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EMAIL = 'coach@example.com';

let reponses: Array<{ data: unknown; error: unknown } | Error> = [];
const inserts: unknown[] = [];

function requete() {
  const r = reponses.shift() ?? { data: null, error: { message: 'base injoignable' } };
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => q,
    insert: (row: unknown) => {
      inserts.push(row);
      return q;
    },
    update: () => q,
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)).then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => requete() },
  supabase: {},
}));
vi.mock('@/lib/email/notifications', () => ({ sendWelcomeEmailDirect: vi.fn() }));
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }),
}));
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/facebook', () => ({ default: () => ({}) }));

const { authCallbacks } = await import('@/lib/auth/config');

const PANNE = { data: null, error: { message: 'connect ECONNREFUSED' } };

function premiereConnexion(token: Record<string, unknown> = {}) {
  return authCallbacks.jwt({
    token: { email: EMAIL, name: 'Coach', sub: FANTOME, ...token },
    user: { id: FANTOME, email: EMAIL, name: 'Coach', image: null },
    account: { access_token: 'tok', provider: 'google', type: 'oidc', providerAccountId: 'x' },
  } as any);
}

function session(token: Record<string, unknown>) {
  return authCallbacks.session({
    session: { user: { email: EMAIL, name: 'Coach', image: null }, expires: '2999-01-01' },
    token,
  } as any) as Promise<any>;
}

beforeEach(() => {
  reponses = [];
  inserts.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Première connexion avec une base qui ne répond pas', () => {
  it("ne fige pas l'UUID fantôme d'Auth.js dans le jeton", async () => {
    reponses = [PANNE, PANNE, PANNE];
    const token = await premiereConnexion();
    expect(token.id).toBeUndefined();
    expect(token.id).not.toBe(FANTOME);
  });

  it("n'insère aucun compte quand la LECTURE échoue (pas de doublon à 10 crédits)", async () => {
    reponses = [PANNE];
    await premiereConnexion();
    expect(inserts).toHaveLength(0);
  });

  it('ne fige pas non plus le fantôme si la résolution lève une exception', async () => {
    reponses = [new Error('socket hang up')];
    const token = await premiereConnexion();
    expect(token.id).toBeUndefined();
  });

  it("la session n'expose pas le fantôme et retombe sur l'offre gratuite tant que la base est en panne", async () => {
    reponses = [PANNE];
    const token = await premiereConnexion();
    reponses = [PANNE];
    const s = await session(token);
    expect(s.user.id).toBeUndefined();
    expect(s.user.plan).toBe('free');
  });
});

describe('La base revient : le bon identifiant est retrouvé', () => {
  it('le callback session retrouve le compte réel par e-mail', async () => {
    reponses = [PANNE];
    const token = await premiereConnexion();
    reponses = [
      { data: [{ id: REEL, credits: 500, created_at: '2026-01-01' }], error: null },
      { data: { plan: 'pro', role: null }, error: null },
    ];
    const s = await session(token);
    expect(s.user.id).toBe(REEL);
    expect(s.user.plan).toBe('pro');
  });

  it('le passage suivant de jwt persiste le bon identifiant dans le jeton', async () => {
    reponses = [PANNE];
    const token = await premiereConnexion();
    reponses = [{ data: [{ id: REEL, credits: 500, created_at: '2026-01-01' }], error: null }];
    const suivant = await authCallbacks.jwt({ token } as any);
    expect(suivant.id).toBe(REEL);

    // Une fois persisté, plus aucune relecture par e-mail.
    reponses = [];
    const encore = await authCallbacks.jwt({ token: suivant } as any);
    expect(encore.id).toBe(REEL);
    expect(reponses).toHaveLength(0);
  });

  it('jwt sans e-mail dans le jeton ne tente rien', async () => {
    const t = await authCallbacks.jwt({ token: { sub: FANTOME } } as any);
    expect(t.id).toBeUndefined();
  });
});

describe('Cas nominal inchangé', () => {
  it('première connexion : compte existant → identifiant réel sur le jeton', async () => {
    reponses = [
      { data: [{ id: REEL, credits: 500, created_at: '2026-01-01' }], error: null },
      { data: null, error: null }, // mise à jour nom/avatar best-effort
    ];
    const token = await premiereConnexion();
    expect(token.id).toBe(REEL);
    expect(token.accessToken).toBe('tok');
  });

  it('première connexion : compte absent → création puis identifiant créé', async () => {
    reponses = [
      { data: [], error: null },
      { data: { id: REEL }, error: null },
    ];
    const token = await premiereConnexion();
    expect(token.id).toBe(REEL);
    expect(inserts).toHaveLength(1);
  });

  it('session avec un jeton déjà résolu : aucune relecture par e-mail', async () => {
    reponses = [{ data: { plan: 'starter', role: 'admin' }, error: null }];
    const s = await session({ id: REEL, email: EMAIL });
    expect(s.user.id).toBe(REEL);
    expect(s.user.plan).toBe('starter');
    expect(s.user.role).toBe('admin');
    expect(reponses).toHaveLength(0);
  });

  it('jwt sur un jeton déjà résolu ne touche pas la base', async () => {
    reponses = [];
    const t = await authCallbacks.jwt({ token: { id: REEL, email: EMAIL } } as any);
    expect(t.id).toBe(REEL);
  });
});
