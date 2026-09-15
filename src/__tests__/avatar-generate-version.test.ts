// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * AVATAR-2A — `POST /api/avatar/generate` parle avec l'avatar VIVANT, et
 * chaque génération porte la VERSION du clone qui l'a produite.
 *
 * - un avatar supprimé (`deleted_at`) n'est plus « l'avatar du compte » ;
 * - sans `provider_avatar_id`, aucun appel HeyGen (ni statut, ni vidéo),
 *   aucun débit : 409 ;
 * - la génération insérée porte `avatar_version = version` de la ligne.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';

const base = vi.hoisted(() => ({
  avatars: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
}));
const heygen = vi.hoisted(() => ({ appels: [] as string[] }));
const credits = vi.hoisted(() => ({ journal: [] as string[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const filtres: Array<(l: Record<string, unknown>) => boolean> = [];
    let insertion: Record<string, unknown> | null = null;
    let patch: Record<string, unknown> | null = null;
    const source = () => (table === 'user_avatars' ? base.avatars : base.generations);
    const api = {
      select() { return api; },
      insert(v: Record<string, unknown>) { insertion = v; return api; },
      update(p: Record<string, unknown>) { patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { return api; },
      async limit() { return { data: source().filter((l) => filtres.every((f) => f(l))), error: null }; },
      async single() {
        if (insertion) { const l = { id: `gen-${base.generations.length + 1}`, ...insertion }; base.generations.push(l); return { data: l, error: null }; }
        const rows = source().filter((l) => filtres.every((f) => f(l)));
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } };
      },
      then(resolve: (v: unknown) => void) {
        const rows = source().filter((l) => filtres.every((f) => f(l)));
        if (patch) for (const l of rows) Object.assign(l, patch);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

vi.mock('@/lib/avatar/heygen', () => ({
  HeyGenError: class extends Error { httpStatus = 502; code = 'x'; },
  generateAvatarVideo: async (args: { avatarId: string }) => { heygen.appels.push(`videos:${args.avatarId}`); return { videoId: 'vid-1', status: 'processing' }; },
  getAvatarTrainingStatus: async (id: string) => { heygen.appels.push(`looks:${id}`); return { status: 'completed' }; },
  resolveVoiceId: async () => 'voice-1',
}));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 1000,
  deductCredits: async (_u: string, n: number) => { credits.journal.push(`debit:${n}`); },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); },
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));

const { POST } = await import('@/app/api/avatar/generate/route');

const requete = (body: Record<string, unknown> = {}) =>
  POST(new NextRequest('https://studiio.pro/api/avatar/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: 'Bonjour à tous.', ...body }),
  }));

const avatar = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-000000000001', user_id: U, status: 'completed', provider_avatar_id: 'hg-1',
  avatar_type: 'video', consent_at: '2026-09-01T00:00:00Z', version: 4, deleted_at: null, created_at: '2026-09-01T00:00:00Z', ...over,
});

beforeEach(() => { base.avatars = []; base.generations = []; heygen.appels.length = 0; credits.journal.length = 0; });

describe('POST /api/avatar/generate — version et avatar vivant', () => {
  it('⚠️ la génération porte avatar_version = version de la ligne (4) et user_avatar_id = id', async () => {
    base.avatars = [avatar()];
    const res = await requete();
    expect(res.status).toBe(200);
    expect(base.generations).toHaveLength(1);
    expect(base.generations[0].avatar_version).toBe(4);
    expect(base.generations[0].user_avatar_id).toBe('11111111-1111-4111-8111-000000000001');
    expect(heygen.appels).toEqual(['videos:hg-1']);
  });

  it('⚠️ un avatar supprimé n’existe plus pour la génération → 404, aucun appel, aucun débit', async () => {
    base.avatars = [avatar({ deleted_at: '2026-09-15T00:00:00Z' })];
    const res = await requete();
    expect(res.status).toBe(404);
    expect(heygen.appels).toEqual([]);
    expect(credits.journal).toEqual([]);
    expect(base.generations).toEqual([]);
  });

  it('⚠️ sans provider_avatar_id → 409 avatar_no_provider, aucun appel HeyGen (même pas le statut), aucun débit', async () => {
    base.avatars = [avatar({ provider_avatar_id: null, status: 'source_ready' })];
    const res = await requete();
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('avatar_no_provider');
    expect(heygen.appels).toEqual([]);
    expect(credits.journal).toEqual([]);
  });

  it('un avatar vivant supplanté par un supprimé plus récent : c’est le vivant qui parle', async () => {
    base.avatars = [
      avatar({ id: '11111111-1111-4111-8111-000000000002', deleted_at: '2026-09-15T00:00:00Z', created_at: '2026-09-14T00:00:00Z', version: 9 }),
      avatar(),
    ];
    const res = await requete();
    expect(res.status).toBe(200);
    expect(base.generations[0].user_avatar_id).toBe('11111111-1111-4111-8111-000000000001');
    expect(base.generations[0].avatar_version).toBe(4);
  });
});
