/**
 * CONTRAT — MON JUMEAU (EN_VALIDATION, pas encore LOCKED).
 * Une vidéo terminée chez le fournisseur n'est « réussie » que si elle est
 * enregistrée chez nous ; sinon nouvel essai, puis échec franc ET remboursé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Doublures : base, crédits, fournisseurs ───────────────────────────────
const ligne = {
  id: 'gen-1', user_id: 'u1', status: 'processing', provider: 'heygen', provider_video_id: 'vid-1',
  video_url: null as string | null, error_message: null, credits_charged: 40, credits_refunded: false,
  created_at: new Date().toISOString(),
};
let uploadErreur: { message: string } | null = null;
const misesAJour: Array<Record<string, unknown>> = [];
const credits: Array<[string, number, string]> = [];

vi.mock('@/lib/db/supabase', () => {
  const requete = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: table === 'avatar_generations' ? { ...ligne } : null }),
      update: (p: Record<string, unknown>) => { patch = p; misesAJour.push(p); return q; },
      then: (r: (v: unknown) => void) => r({ data: patch && patch.credits_refunded ? [{ id: ligne.id }] : [], error: null }),
    };
    return q;
  };
  return {
    supabaseAdmin: {
      from: requete,
      storage: {
        from: () => ({
          upload: async () => ({ error: uploadErreur }),
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${p}` } }),
        }),
      },
    },
  };
});
vi.mock('@/lib/credits/system', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  addCredits: async (u: string, n: number, t: string) => { credits.push([u, n, t]); },
}));
vi.mock('@/lib/avatar/heygen', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getVideoStatus: async () => ({ status: 'completed', videoUrl: 'https://heygen.example/expire.mp4' }),
  downloadVideo: async () => Buffer.from('mp4'),
}));
vi.mock('@/lib/providers/did/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lireScene: async () => ({}), telechargerResultat: async () => Buffer.from(''),
}));
vi.mock('@/lib/avatar/source', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  cleAudioAvatar: () => 'k', retirerObjetPriveAvatar: async () => {},
}));

import { avancerStatutGeneration, STALE_AFTER_MS } from '@/lib/avatar/statut';

beforeEach(() => {
  uploadErreur = null;
  misesAJour.length = 0;
  credits.length = 0;
  ligne.created_at = new Date().toISOString();
});

describe('JUMEAU — résultat persistant, jamais une URL fournisseur qui expire', () => {
  it('copie réussie → terminé avec NOTRE adresse, jamais celle du fournisseur', async () => {
    const r = await avancerStatutGeneration('u1', 'gen-1');
    expect(r.status).toBe('completed');
    expect((r as { videoUrl: string }).videoUrl).toContain('/media/u1/avatar/gen-1.mp4');
    expect((r as { videoUrl: string }).videoUrl).not.toContain('heygen.example');
  });

  it('copie en échec → toujours « en cours » (nouvel essai), jamais un succès sur une adresse qui expire', async () => {
    uploadErreur = { message: 'stockage indisponible' };
    const r = await avancerStatutGeneration('u1', 'gen-1');
    expect(r).toEqual({ status: 'processing', videoUrl: null });
    expect(misesAJour.some((p) => p.status === 'completed')).toBe(false);
    expect(credits).toEqual([]);
  });

  it('copie toujours impossible au-delà du délai → échec franc ET remboursé', async () => {
    uploadErreur = { message: 'stockage indisponible' };
    ligne.created_at = new Date(Date.now() - STALE_AFTER_MS - 60_000).toISOString();
    const r = await avancerStatutGeneration('u1', 'gen-1');
    expect(r.status).toBe('failed');
    expect((r as { error: string }).error).toMatch(/n’a pas pu être enregistrée.*Credits rembourses/);
    expect(credits).toEqual([['u1', 40, 'refund']]);
  });
});
