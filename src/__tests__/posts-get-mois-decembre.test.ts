import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/posts?month=YYYY-MM — bornes du mois.
 *
 * Ce que ces tests protegent : la borne haute ne passait pas a l'annee
 * suivante. `month=2026-12` produisait `>= 2026-12-01 AND < 2026-01-01`,
 * un intervalle vide : le Calendrier etait vide chaque mois de decembre.
 *
 * La preuve recherchee est le filtre effectivement transmis a PostgREST.
 */

const authMock = vi.fn();

interface Call {
  table: string;
  filters: Array<[string, string, unknown]>;
}
const calls: Call[] = [];

function makeQuery(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const api: Record<string, unknown> = {
    select: () => api,
    order: () => api,
    eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return api; },
    gte: (k: string, v: unknown) => { call.filters.push(['gte', k, v]); return api; },
    lt: (k: string, v: unknown) => { call.filters.push(['lt', k, v]); return api; },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onOk, onErr),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { GET } = await import('@/app/api/posts/route');

async function bornes(month: string) {
  const res = await GET({ url: `https://studiio.pro/api/posts?month=${month}` } as never);
  expect(res.status).toBe(200);
  const f = calls.at(-1)!.filters;
  return {
    gte: f.find(([op, k]) => op === 'gte' && k === 'scheduled_date')?.[2],
    lt: f.find(([op, k]) => op === 'lt' && k === 'scheduled_date')?.[2],
    user: f.find(([op, k]) => op === 'eq' && k === 'user_id')?.[2],
  };
}

beforeEach(() => {
  calls.length = 0;
  authMock.mockResolvedValue({ user: { id: 'user-A' } });
});

describe('GET /api/posts — bornes du mois', () => {
  it('decembre : la borne haute passe au 1er janvier de l annee suivante', async () => {
    expect(await bornes('2026-12')).toEqual({
      gte: '2026-12-01', lt: '2027-01-01', user: 'user-A',
    });
  });

  it('mois ordinaire : borne haute au 1er du mois suivant, meme annee, zero de tete', async () => {
    expect(await bornes('2026-03')).toEqual({
      gte: '2026-03-01', lt: '2026-04-01', user: 'user-A',
    });
    expect(await bornes('2026-09')).toEqual({
      gte: '2026-09-01', lt: '2026-10-01', user: 'user-A',
    });
  });

  it('janvier : borne haute au 1er fevrier de la meme annee', async () => {
    expect(await bornes('2027-01')).toEqual({
      gte: '2027-01-01', lt: '2027-02-01', user: 'user-A',
    });
  });

  it('novembre : pas de passage d annee premature', async () => {
    expect(await bornes('2026-11')).toEqual({
      gte: '2026-11-01', lt: '2026-12-01', user: 'user-A',
    });
  });

  it('sans mois : aucune borne de date, toujours filtre par proprietaire', async () => {
    expect(await bornes('')).toEqual({ gte: undefined, lt: undefined, user: 'user-A' });
  });
});
