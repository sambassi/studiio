import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * /api/admin/subscriptions — controle d'acces administrateur.
 *
 * Ce que ces tests protegent : sous le prefixe `/api/admin`, un `auth()` seul
 * ressemble a une protection. Ce n'en est pas une — il exige une session, pas
 * un administrateur. La route livrait ainsi a tout compte connecte la liste
 * des abonnements de TOUS les comptes (dont les identifiants clients Stripe)
 * et la modification de n'importe lequel d'entre eux.
 *
 * `requireAdmin` n'est PAS remplace par un double : les tests ne simulent que
 * la session NextAuth, et laissent le vrai helper decider. C'est le seul
 * moyen de prouver que la route est reellement branchee sur le mecanisme
 * canonique, et pas sur une copie qui divergerait.
 */

const authMock = vi.fn();

// ── Faux client Postgrest — sert surtout de temoin ───────────────────
// Toute requete enregistree avant un refus serait une fuite : la preuve
// recherchee est que ce tableau reste VIDE sur 401 et sur 403.
interface Call { table: string; op: 'read' | 'write' }
const calls: Call[] = [];
let rows: unknown[] = [];
let count = 0;
let dbError: unknown = null;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read' };
  const api: Record<string, unknown> = {
    select: () => api,
    update: () => { call.op = 'write'; return api; },
    insert: () => { call.op = 'write'; return api; },
    eq: () => api,
    order: () => api,
    range: () => api,
    single: async () => { calls.push(call); return { data: rows[0] ?? null, error: dbError }; },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: rows, count, error: dbError }).then(onOk, onErr);
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { GET, PATCH } = await import('@/app/api/admin/subscriptions/route');

/** Adresse reellement listee par `lib/admin.ts`. */
const ADMIN_EMAIL = 'contact.artboost@gmail.com';

const asAdmin = () => authMock.mockResolvedValue({ user: { id: 'admin-1', email: ADMIN_EMAIL } });
const asUser = () => authMock.mockResolvedValue({ user: { id: 'user-1', email: 'quelquun@exemple.test' } });
const asAnonymous = () => authMock.mockResolvedValue(null);

const get = async (url = 'https://studiio.test/api/admin/subscriptions?limit=50') => {
  const res = await GET({ url } as never);
  return { status: res.status, body: await res.json() };
};

const patch = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await PATCH({
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as never);
  return { status: res.status, body: await res.json() };
};

/** Une ligne d'abonnement, valeurs anonymes. */
const SUB = {
  id: 'sub-1',
  user_id: 'user-9',
  plan: 'pro',
  status: 'active',
  stripe_customer_id: 'cus_exemple',
  stripe_subscription_id: 'sub_exemple',
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  dbError = null;
  rows = [SUB];
  count = 1;
});

// ═══════════════════════════════════════════════════════════════════
describe('GET — liste des abonnements', () => {
  it('1. sans session : 401', async () => {
    asAnonymous();
    expect((await get()).status).toBe(401);
  });

  it('2. session utilisateur normale : 403', async () => {
    asUser();
    expect((await get()).status).toBe(403);
  });

  it('3. session administrateur : 200 et comportement metier intact', async () => {
    asAdmin();
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([SUB]);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('4. aucune requete en base avant le controle d acces', async () => {
    asAnonymous();
    await get();
    expect(calls).toHaveLength(0);

    calls.length = 0;
    asUser();
    await get();
    expect(calls).toHaveLength(0);

    // …et l administrateur, lui, atteint bien la base.
    calls.length = 0;
    asAdmin();
    await get();
    expect(calls).toEqual([{ table: 'subscriptions', op: 'read' }]);
  });

  it('5. le refus ne laisse fuir aucune donnee d abonnement', async () => {
    for (const scenario of [asAnonymous, asUser]) {
      scenario();
      const { body } = await get();
      const texte = JSON.stringify(body);
      expect(texte).not.toContain('cus_');
      expect(texte).not.toContain('sub_exemple');
      expect(texte).not.toContain('user-9');
      expect(body.data).toBeUndefined();
    }
  });

  it('6bis. la reponse de refus ne varie pas selon le contenu de la base', async () => {
    // Sinon un non-administrateur deduirait de la forme de l erreur qu il
    // existe — ou non — des abonnements.
    asUser();
    rows = [SUB]; count = 1;
    const avec = await get();
    rows = []; count = 0;
    const sans = await get();
    expect(avec.status).toBe(sans.status);
    expect(avec.body).toStrictEqual(sans.body);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('PATCH — modification d un abonnement', () => {
  it('1. sans session : 401', async () => {
    asAnonymous();
    expect((await patch({ id: 'sub-1', plan: 'enterprise' })).status).toBe(401);
  });

  it('2. session utilisateur normale : 403', async () => {
    asUser();
    expect((await patch({ id: 'sub-1', plan: 'enterprise' })).status).toBe(403);
  });

  it('3. session administrateur : 200, et les deux gestes reels de l interface passent', async () => {
    asAdmin();
    // SubscriptionTable.handleEdit
    const edition = await patch({ id: 'sub-1', plan: 'enterprise', status: 'active' });
    expect(edition.status).toBe(200);
    expect(edition.body.success).toBe(true);
    expect(edition.body.data).toEqual(SUB);

    // SubscriptionTable.handleCancel
    const annulation = await patch({ id: 'sub-1', status: 'canceled', cancel_at_period_end: true });
    expect(annulation.status).toBe(200);
    expect(annulation.body.success).toBe(true);
  });

  it('4. aucune requete en base avant le controle d acces', async () => {
    asAnonymous();
    await patch({ id: 'sub-1', plan: 'enterprise' });
    expect(calls).toHaveLength(0);

    calls.length = 0;
    asUser();
    await patch({ id: 'sub-1', plan: 'enterprise' });
    expect(calls).toHaveLength(0);

    calls.length = 0;
    asAdmin();
    await patch({ id: 'sub-1', plan: 'enterprise' });
    expect(calls).toEqual([{ table: 'subscriptions', op: 'write' }]);
  });

  it('4bis. le corps de la requete n est meme pas lu avant le refus', async () => {
    asUser();
    const jsonSpy = vi.fn();
    const res = await PATCH({ json: jsonSpy } as never);
    expect(res.status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('5. le refus ne laisse fuir aucune donnee d abonnement', async () => {
    for (const scenario of [asAnonymous, asUser]) {
      scenario();
      const { body } = await patch({ id: 'sub-1', plan: 'enterprise' });
      const texte = JSON.stringify(body);
      expect(texte).not.toContain('cus_');
      expect(texte).not.toContain('user-9');
      expect(body.data).toBeUndefined();
    }
  });

  it('7. aucun role, e-mail ou drapeau fourni par le client ne fait autorite', async () => {
    asUser();
    const tentatives: Array<[unknown, Record<string, string>]> = [
      [{ id: 'sub-1', role: 'admin' }, {}],
      [{ id: 'sub-1', is_admin: true }, {}],
      [{ id: 'sub-1', isAdmin: true }, {}],
      [{ id: 'sub-1', email: ADMIN_EMAIL }, {}],
      [{ id: 'sub-1', user: { email: ADMIN_EMAIL } }, {}],
      [{ id: 'sub-1' }, { 'x-admin': 'true' }],
      [{ id: 'sub-1' }, { 'x-user-email': ADMIN_EMAIL }],
      [{ id: 'sub-1' }, { authorization: 'Bearer admin' }],
    ];
    for (const [corps, entetes] of tentatives) {
      const { status } = await patch(corps, entetes);
      expect(status, JSON.stringify(corps)).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it('7bis. une session sans e-mail ne devient pas administrateur', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await patch({ id: 'sub-1', plan: 'enterprise' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('coherence avec le reste du code', () => {
  const routeSource = readFileSync(
    resolve(__dirname, '../app/api/admin/subscriptions/route.ts'),
    'utf-8',
  );

  it('reutilise le helper canonique, sans second mecanisme d autorisation', () => {
    expect(routeSource).toContain("import { requireAdmin } from '@/lib/admin'");
    // Plus aucun `auth()` direct : le controle passe entierement par le helper.
    expect(routeSource).not.toMatch(/from '@\/lib\/auth\/config'/);
    // Aucune liste d administrateurs recopiee sur place.
    expect(routeSource).not.toMatch(/ADMIN_EMAILS|@gmail\.com|isAdmin\(/);
    // Une garde par gestionnaire exporte, ni plus ni moins.
    expect(routeSource.match(/await requireAdmin\(\)/g)).toHaveLength(2);
    expect(routeSource.match(/^export async function/gm)).toHaveLength(2);
  });

  it('la definition des administrateurs n a pas ete touchee', () => {
    const admin = readFileSync(resolve(__dirname, '../lib/admin.ts'), 'utf-8');
    expect(admin).toContain("const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com']");
    expect(admin).toMatch(/status: 401/);
    expect(admin).toMatch(/status: 403/);
  });

  it("la page d'administration continue d'appeler cette route, inchangee", () => {
    const table = readFileSync(
      resolve(__dirname, '../components/admin/SubscriptionTable.tsx'),
      'utf-8',
    );
    expect(table).toContain("fetch('/api/admin/subscriptions?limit=50')");
    expect(table).toContain("fetch('/api/admin/subscriptions', {");
    expect(table).toContain("method: 'PATCH'");
    // Les deux formes de reponse dont l'interface depend restent produites.
    expect(table).toContain('setSubscriptions(data.data || [])');
  });
});
