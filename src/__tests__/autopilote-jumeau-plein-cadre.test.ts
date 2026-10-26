import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * AUTOPILOTE — un jumeau DÉJÀ stocké avec bandes est monté PLEIN CADRE.
 *
 * `produireUnMontage` passe la vidéo du jumeau par `jumeauPleinCadre` (9:16)
 * et monte l'URL rendue PARTOUT où elle sert (durée, séquence Vidéo, plan
 * multi-sources, piste de voix). Propre / refus / échec : l'URL d'origine.
 * Aucun fournisseur, aucun crédit supplémentaire.
 */
let lastDesign: Record<string, unknown> | null = null;
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: vi.fn(async (arg: { design: Record<string, unknown> }) => {
    lastDesign = arg.design;
    return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
  }),
}));
const probeRushSeconds = vi.fn(async (url: string) => (url.includes('/avatar/') ? 12 : 6));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: vi.fn(async () => ({})) };
});
const deductCredits = vi.fn(async () => true);
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: (...a: unknown[]) => deductCredits(...(a as [])) }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({ select: () => { const q: Record<string, unknown> = { eq: () => q, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; }, insert: () => ({ select: async () => ({ data: [{ id: 'p1' }], error: null }) }) });
  return { supabaseAdmin: { from }, supabase: { from } };
});
const jumeauPleinCadre = vi.fn();
vi.mock('@/lib/avatar/jumeau-plein-cadre', () => ({ jumeauPleinCadre: (...a: unknown[]) => jumeauPleinCadre(...a) }));
const fournisseur = vi.fn();
vi.mock('@/lib/avatar/heygen', () => ({ getVideoStatus: fournisseur, downloadVideo: fournisseur, generateVideo: fournisseur }));

import { produireUnMontage } from '@/lib/autopilot/produire';

const ORIGINAL = 'https://studiio.pro/storage/v1/object/public/media/u1/avatar/c0ffee00-3333-4333-8333-333333333333.mp4';
const DERIVEE = 'https://studiio.pro/storage/v1/object/public/media/u1/jumeaux-recadres/9x16/avatar/c0ffee00-3333-4333-8333-333333333333.mp4';
const cfg = (): AutopilotConfig => ({ ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], voiceEnabled: false });

async function produire(jumeauVideoUrl: string | null) {
  const c = cfg();
  const post = preparePosts({ config: c, topic: 'routine', count: 1, now: Date.parse('2026-08-05T09:00:00Z') })[0];
  return produireUnMontage({ userId: 'u1', config: c, post, rang: 0, now: Date.parse('2026-08-05T09:00:00Z'), jobId: 'j1', jumeauVideoUrl });
}

describe('produireUnMontage — jumeau existant à bandes', () => {
  beforeEach(() => { lastDesign = null; vi.clearAllMocks(); });

  it('monte la version PLEIN CADRE rendue (9:16, au nom du compte) ; aucun fournisseur', async () => {
    jumeauPleinCadre.mockResolvedValue({ url: DERIVEE, statut: 'derive' });
    await produire(ORIGINAL);
    expect(jumeauPleinCadre).toHaveBeenCalledWith({ url: ORIGINAL, userId: 'u1', format: '9:16' });
    expect(lastDesign?.videoUrl).toBe(DERIVEE);
    expect(probeRushSeconds).toHaveBeenCalledWith(DERIVEE, {}, 'u1');
    expect(fournisseur).not.toHaveBeenCalled();
  });

  it('refus / échec : l’URL d’origine (comportement d’avant)', async () => {
    jumeauPleinCadre.mockResolvedValue({ url: null, statut: 'refus' });
    await produire(ORIGINAL);
    expect(lastDesign?.videoUrl).toBe(ORIGINAL);
  });

  it('sans jumeau : jamais appelé', async () => {
    await produire(null);
    expect(jumeauPleinCadre).not.toHaveBeenCalled();
  });
});
