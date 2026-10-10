import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Raccord Afroboost → Studiio : `POST /api/posts` avec un jeton de service.
 *
 * Ce que ces tests protegent :
 *  - sans variables d'env, le raccord est INACTIF (401), aucune valeur par defaut ;
 *  - un mauvais jeton = anonyme (401) ;
 *  - le bon jeton IMPOSE l'identite Afroboost et le statut `draft`, quoi que
 *    dise le corps (`user_id` ou `status: 'scheduled'` sont ignores) ;
 *  - la session NextAuth continue de fonctionner comme avant ;
 *  - idempotence : une `afroboost_key` deja presente ne cree pas de doublon ;
 *  - ISOLATION SPORDATEUR : les chemins de publication choisissent les comptes
 *    PAR `post.user_id` — un post Afroboost ne peut pas emprunter un compte
 *    d'un autre utilisateur (test structurel sur le code du cron et de
 *    `social/publish`).
 */

const authMock = vi.fn();
const JETON = 'jeton-de-test-uniquement-' + 'x'.repeat(16);
const USER_AFROBOOST = 'user-afroboost-test';

interface Call { table: string; op: string; filters: Record<string, unknown>; row?: Record<string, unknown> }
const calls: Call[] = [];
let existing: Record<string, unknown> | null = null;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read', filters: {} };
  const api: Record<string, unknown> = {
    select: () => api,
    insert: (row: Record<string, unknown>) => { call.op = 'insert'; call.row = row; return api; },
    update: () => { throw new Error('update interdit'); },
    delete: () => { throw new Error('delete interdit'); },
    eq: (k: string, v: unknown) => { call.filters[k] = v; return api; },
    limit: () => api,
    order: () => api,
    maybeSingle: async () => { calls.push(call); return { data: existing, error: null }; },
    single: async () => { calls.push(call); return { data: { id: 'post-new', ...(call.row || {}) }, error: null }; },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeQuery(t) },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST } = await import('@/app/api/posts/route');

const post = async (body: unknown, authorization?: string) => {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  const res = await POST({ headers, json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};
const lastInsert = () => calls.filter((c) => c.op === 'insert').at(-1);

const CORPS = {
  title: 'Fondateurs J1', caption: 'legende https://afroboost.com/?offre=x&utm_source=instagram',
  media_url: 'https://res.cloudinary.com/dtm0r7hwq/video/upload/MASTER_CLEAN.mp4',
  platforms: ['instagram'], scheduled_date: '2026-09-17', scheduled_time: '18:00',
  status: 'scheduled', user_id: 'user-spordateur', metadata: { afroboost_key: 'fondateurs2026|J1|instagram' },
};

beforeEach(() => { calls.length = 0; existing = null; authMock.mockReset(); authMock.mockResolvedValue(null); });
afterEach(() => { delete process.env.AFROBOOST_SERVICE_TOKEN; delete process.env.AFROBOOST_STUDIIO_USER_ID; });

describe('raccord Afroboost — jeton de service', () => {
  it('variables absentes → raccord inactif : 401 meme avec un Bearer', async () => {
    const r = await post(CORPS, 'Bearer nimporte');
    expect(r.status).toBe(401);
    expect(lastInsert()).toBeUndefined();
  });

  it('mauvais jeton → 401, rien ecrit', async () => {
    process.env.AFROBOOST_SERVICE_TOKEN = JETON; process.env.AFROBOOST_STUDIIO_USER_ID = USER_AFROBOOST;
    const r = await post(CORPS, 'Bearer ' + JETON.slice(0, -1) + 'y');
    expect(r.status).toBe(401);
    expect(lastInsert()).toBeUndefined();
  });

  it('bon jeton → brouillon sous l\'identite Afroboost, statut draft impose, user_id du corps ignore', async () => {
    process.env.AFROBOOST_SERVICE_TOKEN = JETON; process.env.AFROBOOST_STUDIIO_USER_ID = USER_AFROBOOST;
    const r = await post(CORPS, 'Bearer ' + JETON);
    expect(r.status).toBe(200);
    const ins = lastInsert();
    expect(ins?.row?.user_id).toBe(USER_AFROBOOST);
    expect(ins?.row?.status).toBe('draft');
    expect((ins?.row?.metadata as Record<string, unknown>).source).toBe('afroboost');
    expect((ins?.row?.metadata as Record<string, unknown>).afroboost_key).toBe('fondateurs2026|J1|instagram');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('idempotence : afroboost_key deja presente → aucun second brouillon', async () => {
    process.env.AFROBOOST_SERVICE_TOKEN = JETON; process.env.AFROBOOST_STUDIIO_USER_ID = USER_AFROBOOST;
    existing = { id: 'post-existant', user_id: USER_AFROBOOST, status: 'draft' };
    const r = await post(CORPS, 'Bearer ' + JETON);
    expect(r.status).toBe(200);
    expect(r.body.deja_present).toBe(true);
    expect(lastInsert()).toBeUndefined();
    const lecture = calls.find((c) => c.op === 'read');
    expect(lecture?.filters.user_id).toBe(USER_AFROBOOST);
  });

  it('session NextAuth : comportement inchange (statut du corps respecte)', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-session' } });
    const r = await post({ ...CORPS, status: 'draft' });
    expect(r.status).toBe(200);
    expect(lastInsert()?.row?.user_id).toBe('user-session');
  });

  it('le jeton n\'apparait dans aucune sortie', async () => {
    process.env.AFROBOOST_SERVICE_TOKEN = JETON; process.env.AFROBOOST_STUDIIO_USER_ID = USER_AFROBOOST;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(CORPS, 'Bearer ' + JETON);
    const sorties = [...spy.mock.calls, ...err.mock.calls].flat().map(String).join(' ') + JSON.stringify(r.body);
    expect(sorties).not.toContain(JETON);
    spy.mockRestore(); err.mockRestore();
  });
});

describe('isolation Spordateur — les comptes sociaux se choisissent PAR post.user_id', () => {
  const cron = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf8');
  const publish = readFileSync(resolve(__dirname, '../app/api/social/publish/route.ts'), 'utf8');

  it('cron : social_accounts filtres sur post.user_id, Zernio nourri par post.user_id', () => {
    expect(cron).toMatch(/from\('social_accounts'\)[\s\S]{0,200}\.eq\('user_id',\s*post\.user_id\)/);
    expect(cron).toMatch(/comptesConnectes\(post\.user_id\)/);
    expect(cron).toMatch(/userId:\s*post\.user_id/);
  });

  it('social/publish : comptes lus sur session.user.id uniquement', () => {
    expect(publish).toMatch(/from\('social_accounts'\)[\s\S]{0,200}\.eq\('user_id',\s*session\.user\.id\)/);
    expect(publish).not.toMatch(/social_accounts[\s\S]{0,200}\.eq\('user_id',\s*(body|req|params)\./);
  });

  it('un post Afroboost ne peut pas designer un autre user_id (le corps est ignore)', async () => {
    process.env.AFROBOOST_SERVICE_TOKEN = JETON; process.env.AFROBOOST_STUDIIO_USER_ID = USER_AFROBOOST;
    await post({ ...CORPS, user_id: 'user-spordateur' }, 'Bearer ' + JETON);
    expect(lastInsert()?.row?.user_id).toBe(USER_AFROBOOST);
    expect(lastInsert()?.row?.user_id).not.toBe('user-spordateur');
  });
});
