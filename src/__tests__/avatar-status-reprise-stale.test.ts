// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BUG A — le garde « stale » ne doit JAMAIS jeter une vidéo réellement prête.
 *
 * Avant : `GET /api/avatar/status` remboursait toute génération sondée plus de
 * 30 min après son lancement, AVANT même d'interroger le fournisseur. Une scène
 * D-ID `done` (result_url présent) mais dont le navigateur avait quitté puis
 * était revenu > 30 min plus tard était donc marquée `failed` + remboursée,
 * sans jamais lire le résultat réel.
 *
 * Après : on interroge le fournisseur EN PREMIER.
 *   - fournisseur `done`/`completed` avec URL → FINALISER (re-héberger +
 *     `completed`) quel que soit l'âge ;
 *   - fournisseur encore en cours ET âge > 30 min → `failed` + remboursement ;
 *   - fournisseur `failed` → `failed` + remboursement ;
 *   - jamais de double remboursement (drapeau `credits_refunded`).
 *
 * Base doublée en mémoire ; aucun réseau réel ; fournisseurs mockés.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const G_DID = '22222222-2222-4222-8222-000000000001';
const G_HG = '22222222-2222-4222-8222-000000000002';

interface Ligne {
  id: string; user_id: string; provider: string; provider_video_id: string | null;
  status: string; video_url: string | null; duration_seconds: number | null;
  credits_charged: number; credits_refunded: boolean; error_message: string | null;
  created_at: string; updated_at: string;
}

const etat = vi.hoisted(() => ({
  lignes: [] as Ligne[],
  journal: [] as string[],
  uploads: [] as Array<{ path: string; opts: unknown }>,
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'avatar_generations') throw new Error(`table inattendue ${table}`);
    const filtres: Record<string, unknown> = {};
    let mode: 'select' | 'update' = 'select';
    let patch: Record<string, unknown> | null = null;
    let colonnes: string[] | null = null;
    const matches = (l: Ligne) => Object.entries(filtres).every(([k, v]) => (l as never)[k] === v);
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, (l as never)[c]])) : { ...l });
    const appliquerUpdate = () => {
      const touchees = etat.lignes.filter(matches);
      for (const l of touchees) Object.assign(l, patch);
      etat.journal.push(`update:${JSON.stringify({ ...filtres, ...patch })}`);
      return { data: touchees.map((l) => ({ ...l })), error: null };
    };
    const api: Record<string, unknown> = {
      select(c?: string) {
        if (mode === 'update') return Promise.resolve(appliquerUpdate());
        colonnes = c && c !== '*' ? c.split(',').map((s) => s.trim()) : null;
        return api;
      },
      eq(k: string, v: unknown) { filtres[k] = v; return api; },
      order() { return api; },
      limit(n: number) { return Promise.resolve({ data: etat.lignes.filter(matches).slice(0, n).map(projeter), error: null }); },
      single() {
        etat.journal.push(`single:${JSON.stringify(filtres)}`);
        const r = etat.lignes.filter(matches);
        return Promise.resolve(r.length === 1 ? { data: projeter(r[0]), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
      },
      update(p: Record<string, unknown>) { mode = 'update'; patch = p; return api; },
      // Awaitable en fin de chaîne d'update sans .select() : `update().eq()`.
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        const r = mode === 'update' ? appliquerUpdate() : { data: etat.lignes.filter(matches).map(projeter), error: null };
        return Promise.resolve(r).then(onF, onR);
      },
    };
    return api;
  };
  const storage = {
    from: () => ({
      upload: (path: string, _buf: unknown, opts: unknown) => { etat.uploads.push({ path, opts }); return Promise.resolve({ error: null }); },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://minio.studiio.pro/media/${path}` } }),
    }),
  };
  return { supabase: {}, supabaseAdmin: { from, storage } };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante, DEV_AUTH_BYPASS: false }));

const providers = vi.hoisted(() => ({
  did: { status: 'processing', videoUrl: null as string | null, failureMessage: null as string | null },
  heygen: { status: 'processing', videoUrl: null as string | null, failureMessage: null as string | null, durationSeconds: undefined as number | undefined },
}));

vi.mock('@/lib/providers/did/client', () => ({
  lireScene: vi.fn(async () => ({ ...providers.did })),
  telechargerResultat: vi.fn(async () => Buffer.from('video-did')),
  DidError: class extends Error {},
}));
vi.mock('@/lib/avatar/heygen', () => ({
  getVideoStatus: vi.fn(async () => ({ ...providers.heygen })),
  downloadVideo: vi.fn(async () => Buffer.from('video-hg')),
  HeyGenError: class extends Error {},
}));
vi.mock('@/lib/avatar/did', () => ({ FOURNISSEUR_DID: 'did' }));

const retirer = vi.hoisted(() => ({ appels: 0 }));
vi.mock('@/lib/avatar/source', () => ({
  cleAudioAvatar: (u: string, g: string) => `${u}/avatar/${g}.audio`,
  retirerObjetPriveAvatar: vi.fn(async () => { retirer.appels += 1; return true; }),
}));

const credits = vi.hoisted(() => ({ appels: [] as Array<{ userId: string; montant: number; type: string }> }));
vi.mock('@/lib/credits/system', () => ({
  addCredits: vi.fn(async (userId: string, montant: number, type: string) => { credits.appels.push({ userId, montant, type }); }),
}));

const { GET } = await import('@/app/api/avatar/status/route');
import { NextRequest } from 'next/server';

const requete = (generationId: string) =>
  GET(new NextRequest(`https://studiio.pro/api/avatar/status?generationId=${generationId}`));

const ilYA = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

const gen = (over: Partial<Ligne> = {}): Ligne => ({
  id: G_DID, user_id: U, provider: 'did', provider_video_id: 'scn-1',
  status: 'processing', video_url: null, duration_seconds: null,
  credits_charged: 40, credits_refunded: false, error_message: null,
  created_at: ilYA(40), updated_at: ilYA(40), ...over,
});

beforeEach(() => {
  etat.lignes = [];
  etat.journal.length = 0;
  etat.uploads.length = 0;
  retirer.appels = 0;
  credits.appels.length = 0;
  providers.did = { status: 'processing', videoUrl: null, failureMessage: null };
  providers.heygen = { status: 'processing', videoUrl: null, failureMessage: null, durationSeconds: undefined };
  session.courante = { user: { id: U } };
});

describe('GET /api/avatar/status — le garde stale interroge le fournisseur AVANT', () => {
  it('⚠️ D-ID `done` vieux de plus de 30 min → completed + videoUrl re-hébergée, PAS failed, aucun remboursement', async () => {
    etat.lignes = [gen({ created_at: ilYA(40) })];
    providers.did = { status: 'completed', videoUrl: 'https://d-id.tmp/scn-1.mp4', failureMessage: null };

    const res = await requete(G_DID);
    const corps = await res.json() as { data: { status: string; videoUrl: string | null } };
    expect(corps.data.status).toBe('completed');
    expect(corps.data.videoUrl).toBe(`https://minio.studiio.pro/media/${U}/avatar/${G_DID}.mp4`);
    // La vidéo a bien été re-hébergée, et aucun crédit n'a bougé.
    expect(etat.uploads).toHaveLength(1);
    expect(credits.appels).toHaveLength(0);
    // L'audio privé D-ID est retiré après finalisation.
    expect(retirer.appels).toBe(1);
    // La ligne est passée à `completed`, jamais `failed`.
    expect(etat.lignes[0].status).toBe('completed');
    expect(etat.lignes[0].credits_refunded).toBe(false);
  });

  it('HeyGen `completed` vieux de plus de 30 min → completed, re-hébergée, aucun remboursement', async () => {
    etat.lignes = [gen({ id: G_HG, provider: 'heygen', provider_video_id: 'hg-1', created_at: ilYA(90) })];
    providers.heygen = { status: 'completed', videoUrl: 'https://heygen.tmp/hg-1.mp4', failureMessage: null, durationSeconds: 11 };

    const res = await requete(G_HG);
    const corps = await res.json() as { data: { status: string; videoUrl: string | null } };
    expect(corps.data.status).toBe('completed');
    expect(corps.data.videoUrl).toBe(`https://minio.studiio.pro/media/${U}/avatar/${G_HG}.mp4`);
    expect(credits.appels).toHaveLength(0);
  });

  it('⚠️ encore `processing` et vieux de plus de 30 min → failed + remboursement UNE fois', async () => {
    etat.lignes = [gen({ created_at: ilYA(45) })];
    providers.did = { status: 'processing', videoUrl: null, failureMessage: null };

    const res = await requete(G_DID);
    const corps = await res.json() as { data: { status: string; error: string | null } };
    expect(corps.data.status).toBe('failed');
    expect(corps.data.error).toContain('delai maximum');
    expect(corps.data.error).toContain('rembours');
    expect(credits.appels).toEqual([{ userId: U, montant: 40, type: 'refund' }]);
    expect(etat.lignes[0].status).toBe('failed');
    expect(etat.lignes[0].credits_refunded).toBe(true);
  });

  it('encore `processing` mais RÉCENT (< 30 min) → processing, aucun remboursement', async () => {
    etat.lignes = [gen({ created_at: ilYA(10) })];
    providers.did = { status: 'processing', videoUrl: null, failureMessage: null };

    const res = await requete(G_DID);
    const corps = await res.json() as { data: { status: string } };
    expect(corps.data.status).toBe('processing');
    expect(credits.appels).toHaveLength(0);
    expect(etat.lignes[0].status).toBe('processing');
  });

  it('fournisseur `failed` → failed + remboursement UNE fois, audio retiré', async () => {
    etat.lignes = [gen({ created_at: ilYA(5) })];
    providers.did = { status: 'failed', videoUrl: null, failureMessage: "D-ID n'a pas pu animer l'avatar." };

    const res = await requete(G_DID);
    const corps = await res.json() as { data: { status: string } };
    expect(corps.data.status).toBe('failed');
    expect(credits.appels).toEqual([{ userId: U, montant: 40, type: 'refund' }]);
    expect(retirer.appels).toBe(1);
  });

  it('⚠️ jamais de double remboursement : deux polls stale successifs → un seul crédit', async () => {
    etat.lignes = [gen({ created_at: ilYA(45) })];
    providers.did = { status: 'processing', videoUrl: null, failureMessage: null };

    await requete(G_DID);
    await requete(G_DID);
    expect(credits.appels).toHaveLength(1);
  });
});
