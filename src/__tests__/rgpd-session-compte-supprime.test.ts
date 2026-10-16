import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Session après suppression : un ancien JWT d'un compte supprimé (RGPD) ne
 * rouvre plus rien ; un utilisateur normal est inchangé ; une base en panne
 * ne déconnecte personne (fail-open) ; Google/Facebook inchangés pour un
 * compte normal ; une reconnexion OAuth ne « ressuscite » pas l'ancien uid.
 *
 * Base simulée : chaque `from(table)` consomme la réponse suivante de la file
 * de cette table (ou PANNE si vide). Les écritures sont enregistrées.
 */

const REEL = '11111111-2222-4333-8444-555555555555';
const SUPPRIME = '99999999-8888-4777-8666-555555555555';
const PANNE = { data: null, error: { message: 'connect ECONNREFUSED' } };
/** Base GELÉE : la requête ne répond jamais. */
const GEL = { data: 'gel', error: 'gel' };

let files: Record<string, Array<{ data: unknown; error: unknown }>> = {};
const ecritures: { table: string; op: string; valeur: unknown }[] = [];
const lien = vi.fn();
const bienvenue = vi.fn();

function requete(table: string) {
  let op = 'select';
  let valeur: unknown = null;
  const q: any = {
    select: () => q, eq: () => q, ilike: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
    insert: (v: unknown) => { op = 'insert'; valeur = v; return q; },
    update: (v: unknown) => { op = 'update'; valeur = v; return q; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (op !== 'select') ecritures.push({ table, op, valeur });
      const r = files[table]?.shift() ?? PANNE;
      if (r === GEL) return new Promise(() => {}).then(ok, ko);
      return Promise.resolve(r).then(ok, ko);
    },
  };
  return q;
}

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: (t: string) => requete(t) }, supabase: {} }));
vi.mock('@/lib/email/notifications', () => ({ sendWelcomeEmailDirect: (...a: unknown[]) => bienvenue(...a) }));
vi.mock('@/lib/rgpd/adaptateurs', () => ({ enregistrerLienMetaSilencieux: (...a: unknown[]) => lien(...a) }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }) }));
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/facebook', () => ({ default: () => ({}) }));

const { authCallbacks } = await import('@/lib/auth/config');
const etat = await import('@/lib/auth/etat-compte');

const jwtExistant = (id: string) => authCallbacks.jwt({ token: { id, email: 'x@y.z', sub: id } } as any);
const connexion = (provider: string, email = 'coach@x.com') => authCallbacks.jwt({
  token: { email },
  user: { id: 'fantome', email, name: 'Coach', image: 'https://lh3.googleusercontent.com/c.jpg' },
  account: { access_token: 'tok', provider, type: 'oauth', providerAccountId: '1000001' },
} as any);

beforeEach(() => {
  files = {};
  ecritures.length = 0;
  lien.mockReset();
  bienvenue.mockReset();
  etat.viderCacheEtatCompte();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ancien JWT', () => {
  it('compte supprimé (deleted_at) → session refusée (null)', async () => {
    files.users = [{ data: [{ email: `supprime-${SUPPRIME}@supprime.invalid`, deleted_at: '2026-10-16T10:00:00Z' }], error: null }];
    expect(await jwtExistant(SUPPRIME)).toBeNull();
  });

  it('adresse anonymisée seule (deleted_at absent) → refusée aussi', async () => {
    files.users = [{ data: [{ email: `supprime-${SUPPRIME}@supprime.invalid`, deleted_at: null }], error: null }];
    expect(await jwtExistant(SUPPRIME)).toBeNull();
  });

  it('base ancienne sans colonne deleted_at (42703) → repli sur l’adresse', async () => {
    files.users = [
      { data: null, error: { code: '42703', message: 'column users.deleted_at does not exist' } },
      { data: [{ email: `supprime-${SUPPRIME}@supprime.invalid` }], error: null },
    ];
    expect(await jwtExistant(SUPPRIME)).toBeNull();
  });

  it('utilisateur normal → jeton inchangé', async () => {
    files.users = [{ data: [{ email: 'coach@x.com', deleted_at: null }], error: null }];
    const t = await jwtExistant(REEL);
    expect(t).not.toBeNull();
    expect(t!.id).toBe(REEL);
    expect(ecritures).toEqual([]);
  });

  it('compte bloqué (ban, réversible) mais non supprimé → session conservée (comportement inchangé)', async () => {
    files.users = [{ data: [{ email: 'coach@x.com', deleted_at: null, blocked: true }], error: null }];
    expect((await jwtExistant(REEL))!.id).toBe(REEL);
  });

  it('base en panne → utilisateur normal TOUJOURS connecté (fail-open), et rien mis en cache', async () => {
    files.users = [];
    expect((await jwtExistant(REEL))!.id).toBe(REEL);
    // la panne n'est pas mémorisée : la requête suivante relit la base
    files.users = [{ data: [{ email: `supprime-${REEL}@supprime.invalid`, deleted_at: 'x' }], error: null }];
    expect(await jwtExistant(REEL)).toBeNull();
  });

  it('exception de la base → fail-open', async () => {
    const sb = await import('@/lib/db/supabase');
    const from = (sb.supabaseAdmin as any).from;
    (sb.supabaseAdmin as any).from = () => { throw new Error('boom'); };
    try {
      expect((await jwtExistant(REEL))!.id).toBe(REEL);
    } finally {
      (sb.supabaseAdmin as any).from = from;
    }
  });

  it('ligne introuvable → fail-open (jamais de déconnexion sans preuve)', async () => {
    files.users = [{ data: [], error: null }];
    expect((await jwtExistant(REEL))!.id).toBe(REEL);
  });

  it('cache 60 s : un compte actif n’est relu qu’après expiration', async () => {
    files.users = [{ data: [{ email: 'coach@x.com', deleted_at: null }], error: null }];
    const t0 = 1_000_000;
    expect(await etat.etatCompteSession(REEL, t0)).toBe('actif');
    files.users = [{ data: [{ email: 'coach@x.com', deleted_at: 'x' }], error: null }];
    expect(await etat.etatCompteSession(REEL, t0 + etat.DUREE_CACHE_ETAT_MS - 1)).toBe('actif');
    expect(await etat.etatCompteSession(REEL, t0 + etat.DUREE_CACHE_ETAT_MS + 1)).toBe('supprime');
  });

  it('marquerCompteSupprime coupe immédiatement, sans attendre le cache', async () => {
    files.users = [{ data: [{ email: 'coach@x.com', deleted_at: null }], error: null }];
    expect((await jwtExistant(REEL))!.id).toBe(REEL);
    etat.marquerCompteSupprime(REEL);
    expect(await jwtExistant(REEL)).toBeNull();
  });
});

describe('connexion OAuth (Google / Facebook)', () => {
  it.each(['google', 'facebook'])('%s, compte normal existant : inchangé (id, mise à jour nom/avatar, lien Meta si Facebook)', async (provider) => {
    files.users = [
      { data: [{ id: REEL, credits: 5 }], error: null },              // résolution par e-mail
      { data: [{ email: 'coach@x.com', deleted_at: null }], error: null }, // état du compte
      { data: null, error: null },                                       // mise à jour best-effort
    ];
    const t = await connexion(provider);
    expect(t).not.toBeNull();
    expect(t!.id).toBe(REEL);
    expect(t!.accessToken).toBe('tok');
    await vi.waitFor(() => expect(ecritures.filter((e) => e.op === 'update')).toHaveLength(1));
    if (provider === 'facebook') {
      await vi.waitFor(() => expect(lien).toHaveBeenCalledWith('facebook', '1000001', REEL));
    } else {
      await new Promise((r) => setTimeout(r, 10));
      expect(lien).not.toHaveBeenCalled();
    }
  });

  it.each(['google', 'facebook'])('%s, nouveau compte : création + bienvenue, sans sonde d’état', async (provider) => {
    files.users = [
      { data: [], error: null }, // aucun compte
      { data: [], error: null }, // aucune variante de casse
      { data: { id: REEL }, error: null }, // insert
    ];
    const t = await connexion(provider);
    expect(t!.id).toBe(REEL);
    expect(bienvenue).toHaveBeenCalledTimes(1);
  });

  it('base en panne pendant la sonde d’état → connexion normale (fail-open)', async () => {
    files.users = [{ data: [{ id: REEL, credits: 5 }], error: null }]; // puis PANNE
    const t = await connexion('google');
    expect(t!.id).toBe(REEL);
  });

  it('adresse d’un compte supprimé RGPD : l’ancien uid n’est jamais retrouvé → compte NEUF vierge', async () => {
    // L'adresse d'origine n'existe plus (anonymisée en supprime-…@supprime.invalid) :
    // la recherche ne trouve rien, un nouveau compte est créé, l'ancien uid reste mort.
    files.users = [
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: REEL }, error: null },
    ];
    const t = await connexion('google', 'ancien@x.com');
    expect(t!.id).toBe(REEL);
    expect(t!.id).not.toBe(SUPPRIME);
    const insert = ecritures.find((e) => e.op === 'insert');
    expect(insert?.valeur).toMatchObject({ email: 'ancien@x.com', credits: 10, plan: 'free' });
  });

  it('compte retrouvé mais marqué supprimé (ancien deleted_at admin) → connexion REFUSÉE, aucune écriture, aucun lien', async () => {
    files.users = [
      { data: [{ id: SUPPRIME, credits: 5 }], error: null },
      { data: [{ email: 'coach@x.com', deleted_at: '2026-01-01T00:00:00Z' }], error: null },
    ];
    expect(await connexion('facebook')).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(ecritures).toEqual([]); // ni nom ni avatar réécrits sur la ligne supprimée
    expect(lien).not.toHaveBeenCalled();
  });
});

describe('Edge : le chemin Node (crypto/minio) est hors du middleware', () => {
  it('l’import dynamique des adaptateurs RGPD est sous un `if` de runtime constant', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/auth/config.ts'), 'utf-8');
    const i = src.indexOf("import('@/lib/rgpd/adaptateurs')");
    expect(i).toBeGreaterThan(0);
    const avant = src.slice(0, i);
    expect(avant.lastIndexOf("if (process.env.NEXT_RUNTIME !== 'edge') {")).toBeGreaterThan(avant.lastIndexOf('async jwt'));
    // Aucun import statique RGPD (crypto) dans la config d'auth.
    expect(src).not.toMatch(/^import[^\n]*@\/lib\/rgpd/m);
  });

  it('etat-compte.ts n’importe aucun module Node', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/auth/etat-compte.ts'), 'utf-8');
    const imports = [...src.matchAll(/^import[^\n]*from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/lib/db/supabase']);
  });
});

describe('base GELÉE : la lecture d’état est bornée, la session continue', () => {
  it('répond « inconnu » au délai, garde la session, et ne repaie pas le délai pendant la pause', async () => {
    vi.useFakeTimers();
    try {
      etat.viderCacheEtatCompte();
      files.users = [GEL];
      const t0 = Date.now();
      const p = etat.etatCompteSession(REEL, t0);
      await vi.advanceTimersByTimeAsync(etat.DELAI_LECTURE_ETAT_MS);
      await expect(p).resolves.toBe('inconnu');
      // Pendant la pause : réponse immédiate, aucune nouvelle lecture.
      files.users = [GEL];
      await expect(etat.etatCompteSession(REEL, t0 + 1_000)).resolves.toBe('inconnu');
      expect(files.users).toHaveLength(1);
      // Pause écoulée, base revenue : on relit.
      files.users = [{ data: [{ email: 'coach@x.com', deleted_at: null }], error: null }];
      await expect(etat.etatCompteSession(REEL, t0 + etat.PAUSE_APRES_DELAI_MS + 1)).resolves.toBe('actif');
    } finally {
      vi.useRealTimers();
    }
  });

  it('jwt d’un compte normal avec base gelée : la session reste ouverte après le délai', async () => {
    vi.useFakeTimers();
    try {
      etat.viderCacheEtatCompte();
      files.users = [GEL];
      const p = jwtExistant(REEL);
      await vi.advanceTimersByTimeAsync(etat.DELAI_LECTURE_ETAT_MS);
      const tok = await p;
      expect(tok).not.toBeNull();
      expect((tok as any).id).toBe(REEL);
    } finally {
      vi.useRealTimers();
    }
  });

  it('un compte marqué supprimé reste coupé même si la base gèle ensuite', async () => {
    etat.viderCacheEtatCompte();
    etat.marquerCompteSupprime(SUPPRIME);
    files.users = [GEL];
    await expect(etat.etatCompteSession(SUPPRIME)).resolves.toBe('supprime');
  });
});
