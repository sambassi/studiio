import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Doublons d'e-mail à la casse près (migrations/2026-09-29-users-contraintes.sql).
 *
 * Avant : recherche exacte puis INSERT → `Coach@x.com` (Facebook) créait un
 * second compte à côté de `coach@x.com` (Google). Après l'index
 * `users_email_lower_unique`, cet INSERT échouerait et la connexion
 * bouclerait sans compte. Le rattrapage casse-insensible, appelé SEULEMENT
 * quand la recherche exacte est vide, rattache la personne à son compte.
 *
 * Chaque requête `from('users')` consomme la réponse suivante et journalise
 * les filtres appliqués.
 */

const REEL = '11111111-2222-4333-8444-555555555555';
const FANTOME = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Rep = { data: unknown; error: unknown };
let reponses: Rep[] = [];
const inserts: any[] = [];
const filtres: Array<[string, string, string]> = [];

function requete() {
  const r = reponses.shift() ?? { data: null, error: { message: 'base injoignable' } };
  const q: any = {
    select: () => q,
    eq: (c: string, v: string) => { filtres.push(['eq', c, v]); return q; },
    ilike: (c: string, v: string) => { filtres.push(['ilike', c, v]); return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: () => q,
    insert: (row: unknown) => { inserts.push(row); return q; },
    update: () => q,
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => requete() }, supabase: {} }));
vi.mock('@/lib/email/notifications', () => ({ sendWelcomeEmailDirect: vi.fn() }));
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }),
}));
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/facebook', () => ({ default: () => ({}) }));

const { authCallbacks, cleEmail, motifEmailExact } = await import('@/lib/auth/config');

function connexion(email: string) {
  return authCallbacks.jwt({
    token: { email, sub: FANTOME },
    user: { id: FANTOME, email, name: 'Coach', image: null },
    account: { access_token: 'tok', provider: 'facebook', type: 'oauth', providerAccountId: 'x' },
  } as any);
}

beforeEach(() => {
  reponses = [];
  inserts.length = 0;
  filtres.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('cleEmail / motifEmailExact', () => {
  it('reprend lower(btrim(email)), l’expression de l’index', () => {
    expect(cleEmail('  Coach@Example.COM ')).toBe('coach@example.com');
  });
  it('échappe les jokers LIKE pour ne jamais élargir la recherche', () => {
    expect(motifEmailExact('a_b%c\\d@x.com')).toBe('a\\_b\\%c\\\\d@x.com');
    expect(motifEmailExact('coach@x.com')).toBe('coach@x.com');
  });
});

describe('Connexion avec une variante de casse', () => {
  it('rattache au compte existant au lieu d’en créer un second', async () => {
    reponses = [
      { data: [], error: null }, // exacte : rien
      { data: [{ id: REEL, email: 'coach@x.com', credits: 500 }], error: null }, // insensible
      { data: null, error: null }, // mise à jour nom/avatar
    ];
    const t = await connexion('Coach@X.com');
    expect(t.id).toBe(REEL);
    expect(inserts).toHaveLength(0);
    expect(filtres).toContainEqual(['ilike', 'email', 'coach@x.com']);
  });

  it('refiltre : une ligne qui ne correspond pas exactement n’est jamais rattachée', async () => {
    reponses = [
      { data: [], error: null },
      { data: [{ id: 'autre', email: 'coachX@x.com', credits: 900 }], error: null },
      { data: { id: REEL }, error: null }, // insert
    ];
    const t = await connexion('coach@x.com');
    expect(t.id).toBe(REEL);
    expect(inserts).toHaveLength(1);
  });

  it('lecture insensible en échec → aucun INSERT (pas de doublon à 10 crédits)', async () => {
    reponses = [
      { data: [], error: null },
      { data: null, error: { message: 'ECONNREFUSED' } },
    ];
    const t = await connexion('coach@x.com');
    expect(t.id).toBeUndefined();
    expect(inserts).toHaveLength(0);
  });

  it('INSERT refusé par l’index (course) → retrouve le compte par la casse', async () => {
    reponses = [
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { code: '23505', message: 'users_email_lower_unique' } }, // insert
      { data: [], error: null }, // relecture exacte
      { data: [{ id: REEL, email: 'coach@x.com', credits: 10 }], error: null }, // relecture insensible
    ];
    const t = await connexion('Coach@x.com');
    expect(t.id).toBe(REEL);
  });

  it('cas nominal inchangé : correspondance exacte, aucune requête insensible', async () => {
    reponses = [
      { data: [{ id: REEL, credits: 500 }], error: null },
      { data: null, error: null },
    ];
    const t = await connexion('coach@x.com');
    expect(t.id).toBe(REEL);
    expect(filtres.some(([k]) => k === 'ilike')).toBe(false);
  });

  it('retire les espaces de bord avant recherche et insertion, conserve la casse', async () => {
    reponses = [
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: REEL }, error: null },
    ];
    await connexion('  Coach@x.com ');
    expect(filtres[0]).toEqual(['eq', 'email', 'Coach@x.com']);
    expect(inserts[0].email).toBe('Coach@x.com');
  });

  it('une adresse contenant le joker PostgREST `*` ne déclenche pas de recherche insensible', async () => {
    reponses = [
      { data: [], error: null },
      { data: { id: REEL }, error: null },
    ];
    const t = await connexion('a*b@x.com');
    expect(t.id).toBe(REEL);
    expect(filtres.some(([k]) => k === 'ilike')).toBe(false);
  });
});
