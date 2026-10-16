// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * B2 (a) — une erreur PERMANENTE du suivi HeyGen n'est plus un « couac ».
 *
 * `GET /v3/videos/{id}` qui répond 404 (vidéo inconnue), 400 (demande
 * refusée) ou 401 (clé refusée) ne se résout pas en rappelant : la ligne
 * restait « en cours » à chaque poll, jamais en échec, jamais remboursée.
 * Désormais : `getVideoStatus` rend `failed` → le suivi existant clôt et
 * rembourse UNE fois (`failAndRefund`). 429, 5xx, timeout, réseau et refus
 * de SOLDE restent transitoires (exception, nouvel essai).
 *
 * Le VRAI client HeyGen s'exécute ; seul `fetch` est doublé — aucun appel réel.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const G = '77777777-7777-4777-8777-000000000001';
type Ligne = Record<string, unknown>;

const base = vi.hoisted(() => ({ generations: [] as Ligne[] }));
const credits = vi.hoisted(() => ({ journal: [] as string[] }));
const reponse = vi.hoisted(() => ({ courante: null as null | (() => Promise<Response>) }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'avatar_generations') {
      // Tables annexes (coûts, comptes) : rien à lire, rien d'écrit qui compte ici.
      const vide: Record<string, unknown> = {};
      const chaine = () => vide;
      Object.assign(vide, {
        select: chaine, eq: chaine, is: chaine, in: chaine, order: chaine, update: chaine, insert: chaine, upsert: chaine,
        limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
        then: (r: (v: unknown) => void) => r({ data: null, error: null }),
      });
      return vide;
    }
    const filtres: Array<(l: Ligne) => boolean> = [];
    let patch: Ligne | null = null;
    const exec = () => {
      const rows = base.generations.filter((l) => filtres.every((f) => f(l)));
      if (patch) for (const l of rows) Object.assign(l, patch);
      return { data: rows.map((l) => ({ ...l })), error: null };
    };
    const api = {
      select() { return api; },
      update(p: Ligne) { patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      in(k: string, vs: unknown[]) { filtres.push((l) => vs.includes(l[k])); return api; },
      async single() { const r = exec().data; return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'no rows' } }; },
      async maybeSingle() { return { data: exec().data[0] ?? null, error: null }; },
      then(res: (v: unknown) => void, rej: (e: unknown) => void) { return Promise.resolve().then(exec).then(res, rej); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 1000,
  deductCredits: async () => true,
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); },
}));
vi.mock('@/lib/avatar/couts', async (orig) => {
  const vrai = await orig<typeof import('@/lib/avatar/couts')>();
  return { ...vrai, compteAdmin: async () => false, enregistrerCoutGeneration: async () => undefined };
});
vi.mock('@/lib/fournisseurs/sante', async (orig) => {
  const vrai = await orig<typeof import('@/lib/fournisseurs/sante')>();
  return { ...vrai, signalerRefusDeSolde: async () => undefined };
});

globalThis.fetch = vi.fn(async (url: unknown) => {
  if (!String(url).startsWith('https://api.heygen.com/v3/videos/')) throw new Error(`fetch inattendu ${String(url)}`);
  if (!reponse.courante) throw new Error('aucune réponse prévue');
  return reponse.courante();
}) as unknown as typeof fetch;
process.env.HEYGEN_API_KEY = 'cle-heygen-test';

const { getVideoStatus, HeyGenError } = await import('@/lib/avatar/heygen');
const { avancerStatutGeneration } = await import('@/lib/avatar/statut');

const json = (status: number, corps: unknown) => async () => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
const ligne = (): Ligne => ({
  id: G, user_id: U, provider: 'heygen', provider_video_id: 'vid-1', provider_error: null, status: 'processing',
  video_url: null, error_message: null, credits_charged: 40, credits_refunded: false, script: 'Bonjour.',
  aspect_ratio: '9:16', created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
});

beforeEach(() => { base.generations = [ligne()]; credits.journal.length = 0; reponse.courante = null; });

describe('B2 — getVideoStatus : erreurs définitives du suivi', () => {
  it.each([
    [404, { error: { message: 'video not found' } }],
    [400, { error: { message: 'invalid video id' } }],
    [401, { error: { message: 'unauthorized' } }],
  ])('HTTP %i → `failed` (définitif), jamais une exception', async (code, corps) => {
    reponse.courante = json(code, corps);
    const r = await getVideoStatus('vid-1');
    expect(r.status).toBe('failed');
    expect(r.failureMessage).toContain(String(code));
  });

  it.each([
    ['429', json(429, { error: { message: 'rate limit' } })],
    ['500', json(500, { error: { message: 'boom' } })],
    ['503', json(503, { error: { message: 'maintenance' } })],
  ])('HTTP %s → transitoire (HeyGenError levée)', async (_c, rep) => {
    reponse.courante = rep;
    await expect(getVideoStatus('vid-1')).rejects.toBeInstanceOf(HeyGenError);
  });

  it('timeout / réseau → transitoire', async () => {
    reponse.courante = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    await expect(getVideoStatus('vid-1')).rejects.toMatchObject({ code: 'timeout' });
    reponse.courante = async () => { throw new TypeError('fetch failed'); };
    await expect(getVideoStatus('vid-1')).rejects.toMatchObject({ code: 'network_error' });
  });

  it('refus de SOLDE Studiio (même en 400) → reste transitoire (mise en attente gérée ailleurs)', async () => {
    reponse.courante = json(400, { error: { message: "Insufficient credit. This operation requires 'api' credits." } });
    await expect(getVideoStatus('vid-1')).rejects.toBeInstanceOf(HeyGenError);
  });
});

describe('B2 — le suivi clôt et rembourse UNE fois sur une erreur définitive', () => {
  it('⚠️ 404 au poll → failed + crédits rendus une seule fois, même rejoué', async () => {
    reponse.courante = json(404, { error: { message: 'video not found' } });
    const r = await avancerStatutGeneration(U, G);
    expect(r).toMatchObject({ status: 'failed', rembourse: true });
    expect(base.generations[0]).toMatchObject({ status: 'failed', credits_refunded: true });
    expect(await avancerStatutGeneration(U, G)).toMatchObject({ status: 'failed', rembourse: false });
    expect(credits.journal).toEqual(['refund:40']);
  });

  it('500 au poll → exception transitoire, ligne inchangée, rien remboursé', async () => {
    reponse.courante = json(500, { error: { message: 'boom' } });
    await expect(avancerStatutGeneration(U, G)).rejects.toBeInstanceOf(HeyGenError);
    expect(base.generations[0].status).toBe('processing');
    expect(credits.journal).toEqual([]);
  });
});
