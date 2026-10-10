// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * ADMIN = 0 CRÉDIT STUDIIO (#541) — et jamais de « remboursement » fantôme.
 * Base : AVATAR-2A — `POST /api/avatar/generate` parle avec l'avatar VIVANT, et
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
const heygen = vi.hoisted(() => ({ appels: [] as string[], args: [] as Array<Record<string, unknown>>, moteursLook: null as string[] | null }));
const credits = vi.hoisted(() => ({ journal: [] as string[] }));
const exemption = vi.hoisted(() => ({ admin: false, echecHeygen: false }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => exemption.admin, exempteDeCredits: () => exemption.admin }));

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
  generateAvatarVideo: async (args: { avatarId: string }) => { heygen.appels.push(`videos:${args.avatarId}`); heygen.args.push(args); if (exemption.echecHeygen) throw new Error('heygen down'); return { videoId: 'vid-1', status: 'processing' }; },
  getAvatarTrainingStatus: async (id: string) => { heygen.appels.push(`looks:${id}`); return { status: 'completed' }; },
  resolveVoiceId: async () => 'voice-1',
  moteursSupportesDuLook: async (id: string) => { heygen.appels.push(`moteurs:${id}`); return heygen.moteursLook; },
}));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 1000,
  deductCredits: async (_u: string, n: number) => { credits.journal.push(`debit:${n}`); },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); },
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));

const { POST } = await import('@/app/api/avatar/generate/route');

const requete = () =>
  POST(new NextRequest('https://studiio.pro/api/avatar/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: 'Bonjour à tous.' }),
  }));

const avatar = () => ({
  id: '11111111-1111-4111-8111-000000000001', user_id: U, status: 'completed', provider_avatar_id: 'hg-1',
  avatar_type: 'video', consent_at: '2026-09-01T00:00:00Z', version: 4, deleted_at: null, created_at: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  base.avatars = [avatar()]; base.generations = []; heygen.appels.length = 0; heygen.args.length = 0; heygen.moteursLook = null;
  credits.journal.length = 0; exemption.admin = false; exemption.echecHeygen = false;
  delete process.env.AVATAR_MOTEURS_AUTORISES; delete process.env.HEYGEN_AVATAR_ENGINE;
});

describe('POST /api/avatar/generate — administrateur', () => {
  it('⚠️ admin : HeyGen appelé (coût fournisseur réel), AUCUN débit Studiio, credits_charged = 0', async () => {
    exemption.admin = true;
    const res = await requete();
    expect(res.status).toBe(200);
    expect(heygen.appels.some((a) => a.startsWith('videos:'))).toBe(true);
    expect(credits.journal).toEqual([]);
    expect(base.generations[0].credits_charged).toBe(0);
    expect((await res.json()).data.creditsCharged).toBe(0);
  });

  it('⚠️ admin + échec HeyGen : aucun « remboursement » de crédits jamais pris', async () => {
    exemption.admin = true; exemption.echecHeygen = true;
    const res = await requete();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(credits.journal).toEqual([]);
  });

  it('utilisateur : débit 40 puis remboursement 40 si HeyGen échoue (inchangé)', async () => {
    const ok = await requete();
    expect(ok.status).toBe(200);
    expect(credits.journal).toEqual(['debit:40']);
    expect(base.generations[0].credits_charged).toBe(40);
    credits.journal.length = 0; exemption.echecHeygen = true;
    await requete();
    expect(credits.journal).toEqual(['debit:40', 'refund:40']);
  });
});
