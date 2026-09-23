/**
 * Les trois crons « maison » (publish, cleanup-media, cleanup-db) comparaient
 * l'en-tête à `Bearer ${process.env.CRON_SECRET}`. Sans secret configuré, la
 * chaîne attendue devenait littéralement `Bearer undefined` : n'importe qui
 * l'envoyant publiait, supprimait des médias ou purgeait des tables.
 *
 * Invariant protégé ici : secret absent, vide ou blanc → TOUT est refusé,
 * avant le moindre accès base. Seul `Bearer <secret>` exact passe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Base : un faux client qui enregistre chaque accès et répond « vide ». ──
const acces = vi.hoisted(() => ({ from: [] as string[], storage: 0 }));

vi.mock('@/lib/db/supabase', () => {
  const chaine = (): any =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
        }
        return () => chaine();
      },
      apply() {
        return chaine();
      },
    });
  const client = {
    from: (t: string) => {
      acces.from.push(t);
      return chaine();
    },
    get storage() {
      acces.storage++;
      return chaine();
    },
    rpc: () => chaine(),
  };
  return { supabaseAdmin: client, supabase: client };
});

// Dépendances lourdes du cron de publication : jamais exercées ici.
vi.mock('@/lib/social/publishing', () => ({ comptesConnectes: vi.fn(), droitDePublier: vi.fn() }));
vi.mock('@/lib/social/publishViaZernio', () => ({ publierViaZernio: vi.fn() }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));

const fetchEspion = vi.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  acces.from.length = 0;
  acces.storage = 0;
  fetchEspion.mockClear();
  vi.stubGlobal('fetch', fetchEspion);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ROUTES = [
  { nom: '/api/cron/publish', charger: () => import('@/app/api/cron/publish/route') },
  { nom: '/api/cron/cleanup-media', charger: () => import('@/app/api/cron/cleanup-media/route') },
  { nom: '/api/cron/cleanup-db', charger: () => import('@/app/api/cron/cleanup-db/route') },
] as const;

function requete(nom: string, authorization?: string, query = ''): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new NextRequest(`http://localhost${nom}${query}`, { headers });
}

function aucunAcces() {
  expect(acces.from).toEqual([]);
  expect(acces.storage).toBe(0);
  expect(fetchEspion).not.toHaveBeenCalled();
}

describe.each(ROUTES)('$nom — secret absent : tout est refusé', ({ nom, charger }) => {
  for (const secret of [undefined, '', '   ']) {
    describe(`CRON_SECRET=${JSON.stringify(secret)}`, () => {
      beforeEach(() => {
        vi.stubEnv('CRON_SECRET', secret as string);
      });

      // `Bearer ${secret}` retombe sur l'un de ceux-ci (« Bearer undefined »,
      // « Bearer », « Bearer    ») : dédoublonné pour garder des noms uniques.
      for (const entete of [...new Set(['Bearer undefined', 'Bearer ', 'Bearer', undefined, `Bearer ${secret}`, `Bearer ${secret ?? ''}`])]) {
        it(`refuse ${JSON.stringify(entete)} en 401, sans accès base`, async () => {
          const { GET } = await charger();
          const res = await GET(requete(nom, entete));
          expect(res.status).toBe(401);
          expect(await res.json()).toEqual({ error: 'Unauthorized' });
          aucunAcces();
        });
      }

      it('?force=true ne contourne rien', async () => {
        const { GET } = await charger();
        const res = await GET(requete(nom, 'Bearer undefined', '?force=true'));
        expect(res.status).toBe(401);
        aucunAcces();
      });
    });
  }
});

describe.each(ROUTES)('$nom — secret configuré', ({ nom, charger }) => {
  const SECRET = 'secret-de-test-123';
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
  });

  // NB : un espace final serait retiré par `Headers` (normalisation HTTP),
  // il n'est donc pas testable ici et ne constitue pas un contournement.
  for (const entete of ['Bearer mauvais', 'Bearer undefined', `bearer ${SECRET}`, SECRET, `Bearer ${SECRET}x`, undefined]) {
    it(`refuse ${JSON.stringify(entete)} en 401, sans accès base`, async () => {
      const { GET } = await charger();
      const res = await GET(requete(nom, entete, '?force=true'));
      expect(res.status).toBe(401);
      aucunAcces();
    });
  }

  it('laisse passer exactement « Bearer <secret> »', async () => {
    const { GET } = await charger();
    const res = await GET(requete(nom, `Bearer ${SECRET}`));
    expect(res.status).not.toBe(401);
    // L'authentification franchie, la route travaille (base doublée).
    expect(acces.from.length + acces.storage).toBeGreaterThan(0);
  });
});

describe('isCronAuthorized — fonction pure', () => {
  it('refuse tout sans secret, n accepte que « Bearer <secret> » exact', async () => {
    const { isCronAuthorized } = await import('@/lib/cron/auth');
    for (const s of [undefined, '', ' ', '\t']) {
      for (const h of [null, undefined, '', 'Bearer undefined', 'Bearer ', `Bearer ${s}`]) {
        expect(isCronAuthorized(h, s), `secret=${JSON.stringify(s)} header=${JSON.stringify(h)}`).toBe(false);
      }
    }
    expect(isCronAuthorized('Bearer abc', 'abc')).toBe(true);
    expect(isCronAuthorized('Bearer abcd', 'abc')).toBe(false);
    expect(isCronAuthorized('bearer abc', 'abc')).toBe(false);
    expect(isCronAuthorized('abc', 'abc')).toBe(false);
  });
});
