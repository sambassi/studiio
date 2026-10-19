// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le fournisseur annonce `completed` mais la vidéo dure 0 s (fichier vide de
 * toute image, constaté sur la pile locale de preuve « Créer avec avatar ») :
 * le suivi la marquait `completed`, gardait le débit du jumeau, la posait
 * dans la séquence « Vidéo » — puis le montage refusait de la charger
 * (« Réessayez dans un instant ») à chaque essai. L'utilisateur avait payé et
 * ne pouvait plus finir sa vidéo.
 *
 * Désormais : une durée ANNONCÉE nulle est un échec définitif — clôture et
 * remboursement UNE fois, rien n'est téléversé. Une durée positive, ou absente
 * (D-ID), garde le comportement d'avant.
 *
 * Le VRAI client HeyGen s'exécute ; seul `fetch` est doublé — aucun appel réel.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const G = '77777777-7777-4777-8777-000000000002';
type Ligne = Record<string, unknown>;

const base = vi.hoisted(() => ({ generations: [] as Ligne[] }));
const credits = vi.hoisted(() => ({ journal: [] as string[] }));
const stockage = vi.hoisted(() => ({ televerses: [] as string[] }));
const suivi = vi.hoisted(() => ({ corps: null as null | Record<string, unknown> }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'avatar_generations') {
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
  const storage = {
    from: () => ({
      upload: async (chemin: string) => { stockage.televerses.push(chemin); return { error: null }; },
      getPublicUrl: (chemin: string) => ({ data: { publicUrl: `https://studiio.test/storage/v1/object/public/media/${chemin}` } }),
    }),
  };
  return { supabase: {}, supabaseAdmin: { from, storage } };
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
// Le recadrage des bandes (ffmpeg) n'est pas le sujet : fichier rendu tel quel.
vi.mock('@/lib/avatar/cadrage-jumeau', () => ({ retirerBandesIncrustees: async (buffer: Buffer) => ({ buffer }) }));

globalThis.fetch = vi.fn(async (url: unknown) => {
  const u = String(url);
  if (u.startsWith('https://api.heygen.com/v3/videos/')) {
    return new Response(JSON.stringify({ data: suivi.corps }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u === 'https://files.heygen.test/v.mp4') return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200 });
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;
process.env.HEYGEN_API_KEY = 'cle-heygen-test';

const { avancerStatutGeneration } = await import('@/lib/avatar/statut');

const ligne = (): Ligne => ({
  id: G, user_id: U, provider: 'heygen', provider_video_id: 'vid-1', provider_error: null, status: 'processing',
  video_url: null, error_message: null, credits_charged: 40, credits_refunded: false, script: 'Bonjour.',
  aspect_ratio: '9:16', created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
});

beforeEach(() => { base.generations = [ligne()]; credits.journal.length = 0; stockage.televerses.length = 0; suivi.corps = null; });

describe('Suivi HeyGen — vidéo « terminée » de durée nulle', () => {
  it('⚠️ durée annoncée 0 → échec définitif, remboursé UNE fois, rien téléversé ni posé', async () => {
    suivi.corps = { status: 'completed', video_url: 'https://files.heygen.test/v.mp4', duration: 0 };
    const r = await avancerStatutGeneration(U, G);
    expect(r).toMatchObject({ status: 'failed', rembourse: true });
    expect((r as { error?: string }).error).toMatch(/recrédités/);
    expect(base.generations[0]).toMatchObject({ status: 'failed', credits_refunded: true, video_url: null });
    expect(stockage.televerses).toEqual([]);
    // Rejoué (polls suivants) : terminal, jamais un second remboursement.
    expect(await avancerStatutGeneration(U, G)).toMatchObject({ status: 'failed', rembourse: false });
    expect(credits.journal).toEqual(['refund:40']);
  });

  it('durée annoncée positive → terminé comme avant (non-régression)', async () => {
    suivi.corps = { status: 'completed', video_url: 'https://files.heygen.test/v.mp4', duration: 9.97 };
    const r = await avancerStatutGeneration(U, G);
    expect(r).toMatchObject({ status: 'completed' });
    expect(base.generations[0]).toMatchObject({ status: 'completed', duration_seconds: 9.97 });
    expect(stockage.televerses).toEqual([`${U}/avatar/${G}.mp4`]);
    expect(credits.journal).toEqual([]);
  });

  it('durée absente → comportement d’avant (terminé), aucune sonde inventée', async () => {
    suivi.corps = { status: 'completed', video_url: 'https://files.heygen.test/v.mp4' };
    expect(await avancerStatutGeneration(U, G)).toMatchObject({ status: 'completed' });
    expect(credits.journal).toEqual([]);
  });
});
