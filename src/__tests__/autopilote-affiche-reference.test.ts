import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * AUTOPILOTE — « MES PHOTOS COMME RÉFÉRENCE IA ».
 *
 * Chaque montage génère une affiche À PARTIR d'une de mes photos, avec le
 * modèle qui préserve mon sujet. Ce que ces tests VERROUILLENT, sans navigateur
 * et sans vraie génération (le fournisseur est doublé) :
 *  - la photo choisie sert de RÉFÉRENCE à `genererAfficheReference` ;
 *  - succès → l'affiche du montage est l'image GÉNÉRÉE, et les crédits de
 *    l'affiche IA sont débités ;
 *  - échec → PAS de Pexels en silence : ma photo est gardée telle quelle en
 *    affiche, et l'échec est ÉCRIT dans les métadonnées ;
 *  - dans les deux cas, la recherche Pexels n'est jamais appelée.
 */

let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

const pickPosterUrl = vi.fn(async (..._a: unknown[]) => 'https://pexels.test/stock.jpg');
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: (...a: unknown[]) => pickPosterUrl(...a),
  // Pioche déterministe : la première photo de la banque.
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));

const genererAfficheReference = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/ai/affiche-reference', () => ({
  genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a),
}));

const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  getVideoRenderCost: () => 10,
  deductCredits: (...a: unknown[]) => deductCredits(...a),
}));
vi.mock('@/lib/credits/atomique', () => ({
  referenceOperation: (prefixe: string, id: string) => `${prefixe}:${id}`,
}));

let insertions: Array<Record<string, unknown>>;
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const MA_PHOTO = 'https://projet.supabase.co/storage/v1/object/public/media/u/mine.jpg';

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: [], voiceEnabled: false, posterMode: 'reference', posterUrls: [MA_PHOTO], ...p,
});

async function produire(c: AutopilotConfig) {
  const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  const rendu = await produireUnMontage({
    userId: 'u1', config: c, post, rang: 0, now: T0, jobId: 'job-1',
  });
  return { rendu, meta: insertions[0]?.metadata as Record<string, unknown> };
}

describe('Autopilote — affiche IA à partir d’une photo de référence', () => {
  beforeEach(() => { insertions = []; lastDesign = null; vi.clearAllMocks(); });

  it('succès : ma photo sert de référence, l’affiche est l’image générée, les crédits IA sont débités, Pexels jamais appelé', async () => {
    genererAfficheReference.mockResolvedValue({ ok: true, url: 'https://minio.test/u1/autopilote-affiche/job-1.webp' });
    const { meta } = await produire(cfg());

    // La photo a servi de référence.
    const arg = genererAfficheReference.mock.calls[0][0] as { referenceUrl: string; aspectRatio: string };
    expect(arg.referenceUrl).toBe(MA_PHOTO);
    expect(arg.aspectRatio).toBe('9:16');
    // L'affiche du montage est l'image GÉNÉRÉE.
    expect(lastDesign?.posterUrl).toBe('https://minio.test/u1/autopilote-affiche/job-1.webp');
    // Crédits de l'affiche IA débités.
    const aiDebit = deductCredits.mock.calls.find((c) => c[2] === 'ai');
    expect(aiDebit).toBeTruthy();
    // Ni repli Pexels, ni marqueur d'échec.
    expect(pickPosterUrl).not.toHaveBeenCalled();
    expect(meta.posterReferenceEchec).toBeUndefined();
  });

  it('échec : ma photo est gardée en affiche (PAS Pexels), l’échec est écrit', async () => {
    genererAfficheReference.mockResolvedValue({ ok: false, motif: 'service IA non configuré' });
    const { meta } = await produire(cfg());

    // Ma photo reste l'affiche — jamais Pexels.
    expect(lastDesign?.posterUrl).toBe(MA_PHOTO);
    expect(pickPosterUrl).not.toHaveBeenCalled();
    // L'échec est explicite dans les métadonnées.
    expect(meta.posterReferenceEchec).toBe(true);
    expect(meta.posterReferenceMotif).toBe('service IA non configuré');
    // Aucun crédit d'affiche IA débité sur un échec.
    expect(deductCredits.mock.calls.some((c) => c[2] === 'ai')).toBe(false);
  });

  it('mode « auto » : Pexels comme avant, aucune génération de référence', async () => {
    const { meta } = await produire(cfg({ posterMode: 'auto', posterUrls: [] }));
    expect(genererAfficheReference).not.toHaveBeenCalled();
    expect(pickPosterUrl).toHaveBeenCalled();
    expect(lastDesign?.posterUrl).toBe('https://pexels.test/stock.jpg');
    expect(meta.posterReferenceEchec).toBeUndefined();
  });
});
