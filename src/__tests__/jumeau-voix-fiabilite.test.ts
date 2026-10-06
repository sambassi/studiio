/**
 * Mon jumeau + clonage de voix — correctifs de fiabilité (diagnostic 2026-10-05).
 *
 *  1. Jumeau : une vidéo terminée chez le fournisseur mais NON rapatriée sur
 *     notre stockage n'est plus déclarée « réussie » avec l'adresse du
 *     fournisseur (qui expire) : le job reste en cours et réessaie ; au-delà
 *     du délai, échec franc et remboursé.
 *  2. Autopilote : le repli sur la voix standard est dit avec le BON libellé
 *     (« voix clonée » seulement si une voix personnelle était configurée),
 *     et écrit en métadonnées pour le Calendrier — le cron n'a pas d'écran.
 *  3. Créer : une narration non enregistrée n'est plus gardée en `blob:` ;
 *     une voix clonée courte n'est plus refusée par le seuil des voix Edge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
import { avertissementsMontage } from '@/lib/autopilot/produire';

beforeEach(() => {
  uploadErreur = null;
  misesAJour.length = 0;
  credits.length = 0;
  ligne.created_at = new Date().toISOString();
});

describe('Jumeau : rapatriement de la vidéo terminée', () => {
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

describe('Autopilote : repli de voix dit avec le bon libellé', () => {
  const base = { musiqueIntrouvable: false, audioSilencieux: false, montageSimple: false };
  it('voix clonée configurée → « Voix clonée indisponible »', () => {
    expect(avertissementsMontage({ ...base, voixRepliEdge: true, voixPersonnelle: true })).toEqual([
      'Voix clonée indisponible : la voix off standard (gratuite) a été utilisée.',
    ]);
  });
  it('aucune voix personnelle → jamais « voix clonée »', () => {
    const a = avertissementsMontage({ ...base, voixRepliEdge: true, voixPersonnelle: false });
    expect(a).toEqual(['Voix premium indisponible : la voix off standard (gratuite) a été utilisée.']);
    expect(a.join(' ')).not.toMatch(/clonée/);
  });
  it('les avertissements partent en métadonnées et le Calendrier les affiche (cron compris)', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain('return a.length ? { avertissements: a } : null;');
    expect(p).toContain("voixPersonnelle: !!(config.voiceId ?? '').trim(),");
    const c = readFileSync(resolve(process.cwd(), 'src/app/dashboard/calendar/page.tsx'), 'utf-8');
    expect(c).toContain('data-calendrier-avertissements');
  });
});

describe('Créer : narration', () => {
  const studio = readFileSync(resolve(process.cwd(), 'src/components/creer/AudioStudioPanel.tsx'), 'utf-8');
  const sequences = readFileSync(resolve(process.cwd(), 'src/components/creer/SequenceVoicesPanel.tsx'), 'utf-8');
  it('plus de repli silencieux sur une adresse locale `blob:` : l’échec d’enregistrement est dit', () => {
    expect(studio).not.toContain('fall through to local URL');
    expect(studio).not.toContain('onVoiceChange(localUrl');
    expect(studio).toContain('La narration a été générée mais n’a pas pu être enregistrée. Réessayez.');
    expect(studio).toContain('if (!putRes.ok) {');
  });
  it('une voix clonée courte n’est plus refusée par le seuil des voix Edge (8 Ko)', () => {
    expect(sequences).toContain('const minimum = voixFournisseur ? 512 : 8000;');
    expect(sequences).toContain('if (audioBlob.size < minimum) {');
  });
});
