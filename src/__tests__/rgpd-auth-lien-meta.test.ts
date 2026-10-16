import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Connexion Facebook → lien « identifiant Facebook → compte Studiio »,
 * seul moyen de rattacher une demande de suppression Meta au bon compte.
 * Google n'écrit rien ; un échec de résolution n'écrit rien ; la connexion
 * n'attend jamais le lien.
 */

const REEL = '11111111-2222-4333-8444-555555555555';
let reponses: { data: unknown; error: unknown }[] = [];
const lien = vi.fn();

function requete() {
  const r = reponses.shift() ?? { data: null, error: { message: 'base injoignable' } };
  const q: any = {
    select: () => q, eq: () => q, ilike: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
    insert: () => q, update: () => q,
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => requete() }, supabase: {} }));
vi.mock('@/lib/email/notifications', () => ({ sendWelcomeEmailDirect: vi.fn() }));
vi.mock('@/lib/rgpd/adaptateurs', () => ({ enregistrerLienMetaSilencieux: (...a: unknown[]) => lien(...a) }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }) }));
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/facebook', () => ({ default: () => ({}) }));

const { authCallbacks } = await import('@/lib/auth/config');

const connexion = (provider: string) => authCallbacks.jwt({
  token: { email: 'coach@x.com' },
  user: { id: 'fantome', email: 'coach@x.com', name: 'Coach', image: null },
  account: { access_token: 'tok', provider, type: 'oauth', providerAccountId: '1000001' },
} as any);

beforeEach(() => {
  lien.mockReset();
  reponses = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('lien Meta à la connexion', () => {
  it('Facebook : lien enregistré avec l’identifiant Facebook et le compte RÉSOLU', async () => {
    reponses = [{ data: [{ id: REEL, credits: 5 }], error: null }, { data: null, error: null }];
    const t = await connexion('facebook');
    expect(t.id).toBe(REEL);
    await vi.waitFor(() => expect(lien).toHaveBeenCalled());
    expect(lien).toHaveBeenCalledWith('facebook', '1000001', REEL);
  });

  it('Google : aucun lien', async () => {
    reponses = [{ data: [{ id: REEL, credits: 5 }], error: null }, { data: null, error: null }];
    await connexion('google');
    await new Promise((r) => setTimeout(r, 20));
    expect(lien).not.toHaveBeenCalled();
  });

  it('résolution impossible : aucun lien', async () => {
    reponses = [];
    await connexion('facebook');
    await new Promise((r) => setTimeout(r, 20));
    expect(lien).not.toHaveBeenCalled();
  });
});
