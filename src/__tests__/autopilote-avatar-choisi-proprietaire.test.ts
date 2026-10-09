// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AUTOPILOTE — l'avatar choisi doit être une identité VIVANTE DU COMPTE.
 *
 * Un `avatar_id` d'un autre compte (ou archivé) est refusé (403) et RIEN
 * n'est écrit — même si la lecture, filtrée par compte, ne l'aurait de toute
 * façon jamais résolu. L'identifiant du compte vient de la session, jamais
 * du corps de la requête.
 */

const MOI = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const MON_AVATAR = '11111111-1111-4111-8111-000000000001';
const MON_ARCHIVE = '11111111-1111-4111-8111-000000000002';
const AVATAR_AUTRUI = '22222222-2222-4222-8222-000000000003';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

const etat = vi.hoisted(() => ({
  avatars: [] as Array<{ id: string; user_id: string; deleted_at: string | null }>,
  upserts: [] as Array<Record<string, unknown>>,
  panneLecture: false,
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const filtres: Array<(l: Record<string, unknown>) => boolean> = [];
    const chaine = {
      select() { return chaine; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return chaine; },
      is(k: string, v: unknown) { filtres.push((l) => (l[k] ?? null) === v); return chaine; },
      // Sondes de colonnes de `autopilot_config` : toutes présentes.
      async limit() { return { data: [], error: null }; },
      async maybeSingle() {
        if (table !== 'user_avatars') throw new Error(`table inattendue : ${table}`);
        if (etat.panneLecture) return { data: null, error: { message: 'panne' } };
        const l = etat.avatars.find((a) => filtres.every((f) => f(a as unknown as Record<string, unknown>)));
        return { data: l ? { id: l.id } : null, error: null };
      },
      async upsert(v: Record<string, unknown>) {
        if (table !== 'autopilot_config') throw new Error(`upsert inattendu : ${table}`);
        etat.upserts.push(v);
        return { error: null };
      },
    };
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

async function put(corps: Record<string, unknown>) {
  vi.resetModules();
  const { PUT } = await import('@/app/api/autopilot/config/route');
  return PUT(new Request('http://test/api/autopilot/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  }) as unknown as import('next/server').NextRequest);
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: MOI } });
  etat.upserts.length = 0;
  etat.panneLecture = false;
  etat.avatars = [
    { id: MON_AVATAR, user_id: MOI, deleted_at: null },
    { id: MON_ARCHIVE, user_id: MOI, deleted_at: '2026-10-01T00:00:00Z' },
    { id: AVATAR_AUTRUI, user_id: AUTRUI, deleted_at: null },
  ];
});

describe('Autopilote — avatar choisi', () => {
  it('⚠️ avatar d’un AUTRE compte : 403, rien n’est écrit', async () => {
    const r = await put({ jumeauAvatarId: AVATAR_AUTRUI });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('avatar_introuvable');
    expect(etat.upserts).toEqual([]);
  });

  it('⚠️ un `user_id` glissé dans le corps ne change pas le compte vérifié', async () => {
    const r = await put({ jumeauAvatarId: AVATAR_AUTRUI, user_id: AUTRUI, userId: AUTRUI });
    expect(r.status).toBe(403);
    expect(etat.upserts).toEqual([]);
  });

  it('avatar ARCHIVÉ du compte : 403, rien n’est écrit', async () => {
    const r = await put({ jumeauAvatarId: MON_ARCHIVE });
    expect(r.status).toBe(403);
    expect(etat.upserts).toEqual([]);
  });

  it('lecture impossible : 500, rien n’est écrit (jamais « accepté faute de savoir »)', async () => {
    etat.panneLecture = true;
    const r = await put({ jumeauAvatarId: MON_AVATAR });
    expect(r.status).toBe(500);
    expect(etat.upserts).toEqual([]);
  });

  it('avatar VIVANT du compte : enregistré, pour le compte de la session', async () => {
    const r = await put({ jumeauAvatarId: MON_AVATAR });
    expect(r.status).toBe(200);
    expect(etat.upserts).toHaveLength(1);
    expect(etat.upserts[0]).toMatchObject({ user_id: MOI, avatar_id: MON_AVATAR });
  });

  it('aucun avatar choisi (null = par défaut) : enregistré sans lecture', async () => {
    const r = await put({ jumeauAvatarId: null });
    expect(r.status).toBe(200);
    expect(etat.upserts[0]).toMatchObject({ user_id: MOI, avatar_id: null });
  });
});
