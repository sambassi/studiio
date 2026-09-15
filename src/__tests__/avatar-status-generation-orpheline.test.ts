// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AVATAR-1A — une génération dont l'avatar a disparu reste PRÉSENTABLE.
 *
 * La migration `2026-09-15-avatar-schema-foundation.sql` rend
 * `avatar_generations.user_avatar_id` nullable (FK `on delete set null`) :
 * supprimer ou recréer un avatar ne supprime plus les vidéos payées. Ce test
 * vérifie l'autre moitié du contrat — la route ACTUELLE de `main`,
 * `GET /api/avatar/status`, appelée pour de vrai, sert encore une telle
 * génération, avec et sans `generationId`, sans lever ni la masquer.
 *
 * La base est doublée en mémoire : elle rend les lignes telles qu'elles
 * seraient en base après la migration (`user_avatar_id: null`). Aucun
 * fournisseur n'est appelé : la génération est terminale (`completed`), la
 * route ne doit pas interroger HeyGen.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const G_ORPHELINE = '11111111-1111-4111-8111-000000000001';
const G_AUTRUI = '11111111-1111-4111-8111-000000000002';

interface Ligne {
  id: string; user_id: string; user_avatar_id: string | null; provider_video_id: string | null;
  script: string; voice_id: string | null; aspect_ratio: string; status: string;
  video_url: string | null; duration_seconds: number | null; credits_charged: number;
  credits_refunded: boolean; error_message: string | null; created_at: string; updated_at: string;
  intention: string; avatar_version: number | null;
}

const etat = vi.hoisted(() => ({
  lignes: [] as Ligne[],
  journal: [] as string[],
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'avatar_generations') throw new Error(`table inattendue ${table}`);
    const f: Record<string, unknown> = {};
    let colonnes: string[] | null = null;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes
      ? Object.fromEntries(colonnes.map((c) => [c, (l as never)[c]]))
      : { ...l });
    const lignes = () => etat.lignes
      .filter((l) => Object.entries(f).every(([k, v]) => (l as never)[k] === v))
      .slice(0, limite ?? undefined)
      .map(projeter);
    const api = {
      select(c?: string) { colonnes = c && c !== '*' ? c.split(',').map((s) => s.trim()) : null; return api; },
      eq(k: string, v: unknown) { f[k] = v; return api; },
      order() { return api; },
      limit(n: number) { limite = n; etat.journal.push(`select:${JSON.stringify(f)}`); return Promise.resolve({ data: lignes(), error: null }); },
      single() {
        etat.journal.push(`single:${JSON.stringify(f)}`);
        const r = lignes();
        return Promise.resolve(r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
      },
      update() { etat.journal.push('update'); return api; },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante, DEV_AUTH_BYPASS: false }));

// Aucun fournisseur ne doit être touché pour une génération terminale.
vi.mock('@/lib/avatar/heygen', () => ({
  getVideoStatus: vi.fn(async () => { throw new Error('HeyGen ne doit pas être appelé'); }),
  downloadVideo: vi.fn(async () => { throw new Error('HeyGen ne doit pas être appelé'); }),
  HeyGenError: class extends Error {},
}));
vi.mock('@/lib/credits/system', () => ({
  addCredits: vi.fn(async () => { throw new Error('aucun crédit ne doit bouger'); }),
}));

const { GET } = await import('@/app/api/avatar/status/route');
import { NextRequest } from 'next/server';
import { getVideoStatus } from '@/lib/avatar/heygen';

// La route lit `req.nextUrl.searchParams` : c'est un NextRequest qu'elle reçoit.
const requete = (query = '') =>
  GET(new NextRequest(`https://studiio.pro/api/avatar/status${query}`));

const generation = (id: string, user_id: string): Ligne => ({
  id, user_id,
  // ⚠️ L'avatar a été supprimé : le lien est NULL, la vidéo est là.
  user_avatar_id: null,
  provider_video_id: 'hg-video-1', script: 'Bonjour, je suis Bassi.', voice_id: 'v1',
  aspect_ratio: '9:16', status: 'completed', video_url: `/storage/v1/object/public/media/${user_id}/avatar/g.mp4`,
  duration_seconds: 12.4, credits_charged: 25, credits_refunded: false, error_message: null,
  created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-01T10:05:00.000Z',
  intention: 'normale', avatar_version: null,
});

beforeEach(() => {
  etat.lignes = [generation(G_ORPHELINE, U), generation(G_AUTRUI, AUTRUI)];
  etat.journal.length = 0;
  session.courante = { user: { id: U } };
});

describe('GET /api/avatar/status — génération dont l’avatar a disparu (user_avatar_id NULL)', () => {
  it('⚠️ HISTORIQUE : 200, la génération orpheline est listée, celle d’autrui non', async () => {
    const res = await requete();
    expect(res.status).toBe(200);
    const corps = await res.json() as { success: boolean; data: { generations: Array<{ id: string; status: string; video_url: string | null }> } };
    expect(corps.success).toBe(true);
    expect(corps.data.generations.map((g) => g.id)).toEqual([G_ORPHELINE]);
    expect(corps.data.generations[0].status).toBe('completed');
    expect(corps.data.generations[0].video_url).toContain('/avatar/g.mp4');
    // La requête est filtrée par le compte, jamais par l'avatar.
    expect(etat.journal[0]).toContain(`"user_id":"${U}"`);
    expect(etat.journal[0]).not.toContain('user_avatar_id');
  });

  it('⚠️ PAR IDENTIFIANT : 200, la génération est rendue telle quelle, sans appel fournisseur', async () => {
    const res = await requete(`?generationId=${G_ORPHELINE}`);
    expect(res.status).toBe(200);
    const corps = await res.json() as { success: boolean; data: { generationId: string; status: string; videoUrl: string | null; error: string | null } };
    expect(corps.success).toBe(true);
    expect(corps.data).toEqual({
      generationId: G_ORPHELINE, status: 'completed',
      videoUrl: `/storage/v1/object/public/media/${U}/avatar/g.mp4`, error: null,
    });
    expect(getVideoStatus).not.toHaveBeenCalled();
    expect(etat.journal.some((j) => j === 'update')).toBe(false);
  });

  it('la propriété tient toujours : la génération orpheline d’un autre compte → 404', async () => {
    const res = await requete(`?generationId=${G_AUTRUI}`);
    expect(res.status).toBe(404);
  });

  it('sans session → 401, avant toute lecture', async () => {
    session.courante = null;
    expect((await requete()).status).toBe(401);
    expect((await requete(`?generationId=${G_ORPHELINE}`)).status).toBe(401);
    expect(etat.journal).toEqual([]);
  });
});
