import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';

/**
 * Musique configurée mais disparue du stockage.
 *
 * En production, Remotion échouait en 404 au téléchargement de la musique
 * (`audio/<uid>/music/…mp3`), avant toute image : aucun montage, et le
 * finaliseur du jumeau relançait le même rendu à chaque passe. Le montage
 * doit sortir SANS la musique, et le dire dans ses métadonnées.
 *
 * ⚠️ AUCUN APPEL RÉEL : base, crédits, rendu, sondes et fournisseurs sont
 * doublés.
 */

const MUSIQUE = 'https://studiio.pro/storage/v1/object/public/audio/u1/music/1785349032107-black_attacka.mp3';
const JUMEAU = 'https://studiio.pro/storage/v1/object/public/media/u1/avatar/gen-1.mp4';

let insertions: Array<Record<string, unknown>>;
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert(row: Record<string, unknown>) {
        insertions.push(row);
        return { async select() { return { data: [{ id: `post-${insertions.length}` }], error: null }; } };
      },
    }),
  },
}));

const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  deductCredits: (...a: unknown[]) => deductCredits(...a),
  getVideoRenderCost: () => 10,
}));

const renderAndUpload = vi.fn(async (_i: { design: Record<string, unknown> }) => ({
  videoUrl: 'https://minio.test/videos/u1/rendu.mp4', thumbnailUrl: 'https://minio.test/images/v.jpg', durationFrames: 900,
}));
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (i: { design: Record<string, unknown> }) => renderAndUpload(i),
}));

/** Adresses que la sonde déclare absentes (404/410). */
let absentes: Set<string>;
const sonde = vi.fn(async (url: string) => !absentes.has(url));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (u: string) => sonde(u),
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
vi.mock('@/lib/autopilot/voice', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autopilot/voice')>('@/lib/autopilot/voice');
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
const genererAfficheReference = vi.fn();
vi.mock('@/lib/ai/affiche-reference', () => ({ genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a) }));

import { produireUnMontage } from '@/lib/autopilot/produire';

const config: AutopilotConfig = {
  ...DEFAULT_CONFIG, enabled: true, rushUrls: [], musicUrl: MUSIQUE, musicVolume: 0.4,
};
const [post] = preparePosts({ config, topic: 'yoga', count: 1, now: Date.parse('2026-09-23T06:00:00Z') });

const produire = (jumeauVideoUrl?: string) => produireUnMontage({
  userId: 'u1', config, post, rang: 0, now: Date.parse('2026-09-23T06:00:00Z'),
  jobId: 'autopilote-u1-job', slotKey: 'manuel:u1|2026-09-23|08:10', jumeauVideoUrl,
});

beforeEach(() => {
  insertions = [];
  absentes = new Set();
  vi.clearAllMocks();
});

describe('Musique introuvable au stockage', () => {
  it('le montage sort SANS musique, et le dit', async () => {
    absentes.add(MUSIQUE);
    const r = await produire(JUMEAU);

    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    const design = renderAndUpload.mock.calls[0][0].design;
    expect(design.musicUrl ?? null).toBeNull();
    // La vidéo du jumeau, elle, est conservée.
    expect(design.videoUrl).toBe(JUMEAU);

    expect(insertions).toHaveLength(1);
    const meta = insertions[0].metadata as Record<string, unknown>;
    expect(meta.musiqueIgnoree).toBe(true);
    expect(meta.musiqueIgnoreeMotif).toBe('musique introuvable');
    expect(meta.musicUrl ?? null).toBeNull();
    expect(r.postId).toBe('post-1');
  });

  it('un seul débit, celui du rendu ; aucun fournisseur appelé', async () => {
    absentes.add(MUSIQUE);
    await produire(JUMEAU);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits.mock.calls[0][3]).toBe('autopilote:autopilote-u1-job');
    expect(genererAfficheReference).not.toHaveBeenCalled();
  });

  it('musique présente : inchangé, elle est montée et rien n est signalé', async () => {
    await produire(JUMEAU);
    const design = renderAndUpload.mock.calls[0][0].design;
    expect(design.musicUrl).toBe(MUSIQUE);
    const meta = insertions[0].metadata as Record<string, unknown>;
    expect(meta.musiqueIgnoree).toBeUndefined();
  });

  it('sans musique configurée : aucune sonde de musique', async () => {
    await produireUnMontage({
      userId: 'u1', config: { ...config, musicUrl: null }, post, rang: 0, now: 0, jobId: 'j',
    });
    expect(sonde).not.toHaveBeenCalledWith(MUSIQUE);
  });
});
