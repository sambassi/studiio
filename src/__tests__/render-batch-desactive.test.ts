/**
 * `/api/render/batch` est desactivee : zero debit, zero ecriture, zero rendu.
 *
 * Ce test APPELLE la route. Grepper le source ne suffirait pas : le garde
 * pourrait etre present, importe, et place APRES le premier `update` sur
 * `users.credits` — le source contiendrait alors tout ce qu'on cherche
 * pendant que les credits partiraient quand meme.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BATCH_RENDER_DESACTIVE, BATCH_RENDER_MESSAGE } from '@/lib/render/batch-disabled';

const authMock = vi.fn();
/** Toute table touchee, quelle que soit l'operation. */
const tablesTouchees: string[] = [];

function makeQuery(table: string) {
  tablesTouchees.push(table);
  const api: Record<string, unknown> = {
    select: () => api,
    insert: () => api,
    update: () => api,
    delete: () => api,
    eq: () => api,
    single: async () => ({ data: { credits: 10_000 }, error: null }),
    maybeSingle: async () => ({ data: { credits: 10_000 }, error: null }),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeQuery(t) },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST } = await import('@/app/api/render/batch/route');

const appeler = async (body: unknown = { count: 5, format: 'reel' }) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  tablesTouchees.length = 0;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('La route repond une indisponibilite explicite', () => {
  it('rend 503', async () => {
    expect((await appeler()).status).toBe(503);
  });

  it('porte un drapeau lisible par un client', async () => {
    const res = await appeler();
    expect(res.body.success).toBe(false);
    expect(res.body.disabled).toBe(true);
  });

  it('dit la vraie raison, et que rien n a ete debite', async () => {
    const res = await appeler();
    expect(res.body.error).toBe(BATCH_RENDER_MESSAGE);
    expect(res.body.error).toContain('idempotent');
    expect(res.body.error).toContain('Aucun crédit');
  });

  it('le drapeau de desactivation est bien leve', () => {
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });
});

describe('ZERO effet de bord — la garantie qui compte', () => {
  it('ne touche AUCUNE table', async () => {
    await appeler();
    expect(tablesTouchees).toEqual([]);
  });

  it('ne debite aucun credit, meme avec un count enorme', async () => {
    await appeler({ count: 10, format: 'tv', compositionId: 'InfographicX' });
    expect(tablesTouchees).not.toContain('users');
    expect(tablesTouchees).not.toContain('credit_transactions');
  });

  it('ne cree ni video ni job de rendu', async () => {
    await appeler();
    expect(tablesTouchees).not.toContain('videos');
    expect(tablesTouchees).not.toContain('render_jobs');
  });

  it('ne lit meme pas la session — rien ne precede le garde', async () => {
    await appeler();
    expect(authMock).not.toHaveBeenCalled();
  });

  it('ne lit meme pas le corps de la requete', async () => {
    const json = vi.fn(async () => ({ count: 3 }));
    await POST({ json } as never);
    expect(json).not.toHaveBeenCalled();
  });

  it('reste inerte sur un corps hostile', async () => {
    const res = await appeler({ count: 999, baseProps: { __proto__: { a: 1 } } });
    expect(res.status).toBe(503);
    expect(tablesTouchees).toEqual([]);
  });

  it('reste inerte quand on la rejoue — pas de double debit possible', async () => {
    await appeler();
    await appeler();
    await appeler();
    expect(tablesTouchees).toEqual([]);
  });
});
