import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * MON JUMEAU, RÉELLEMENT MONTÉ DANS LE MONTAGE AUTOPILOTE — chemin immédiat.
 *
 * Le navigateur (seul à pouvoir attendre les minutes d'une génération D-ID,
 * comme dans Créer) produit la vidéo du jumeau, puis « Produire un brouillon
 * maintenant » la passe à `produireUnMontage` comme séquence « Vidéo ».
 *
 * Ce que ces tests VERROUILLENT — au niveau du montage, sans navigateur :
 *  - la vidéo du jumeau REMPLACE le rush pour la séquence « Vidéo »
 *    (`design.videoUrl`), et sa durée cale la séquence (parole entière) ;
 *  - son audio est CONSERVÉ (`rushMuted === false`) : l'avatar porte la voix
 *    clonée, on doit l'entendre ;
 *  - AUCUNE voix off par séquence n'est synthétisée quand le jumeau est monté
 *    (`sequenceVoiceUrls` absent, `buildAutopilotVoices` jamais appelé) : le
 *    jumeau est la seule voix — ni répétition, ni superposition ;
 *  - le rush n'est ni sondé ni monté, et les métadonnées portent `jumeau: true`.
 */

// ── Rendu doublé : on CAPTURE le design réellement rendu ────────────────────
let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

// ── Sondes réseau doublées ──────────────────────────────────────────────────
const rushEncorePresent = vi.fn(async (..._a: unknown[]) => true);
const probeRushSeconds = vi.fn(async (url: string) => (url.includes('/avatar/') ? 12 : 6));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (...a: unknown[]) => rushEncorePresent(...(a as [string])),
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

// ── Voix : le vrai module pur, mais la synthèse (réseau) est doublée ─────────
const buildAutopilotVoices = vi.fn(async (..._a: unknown[]) => ({ titre: { url: 'https://cdn.test/voix.mp3', seconds: 3 } }));
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: (...a: unknown[]) => buildAutopilotVoices(...(a as [])) };
});

// ── Crédits doublés ─────────────────────────────────────────────────────────
const deductCredits = vi.fn(async () => true);
vi.mock('@/lib/credits/system', () => ({
  getVideoRenderCost: () => 10,
  deductCredits: (...a: unknown[]) => deductCredits(...(a as [])),
}));
vi.mock('@/lib/credits/atomique', () => ({
  referenceOperation: (prefixe: string, id: string) => `${prefixe}:${id}`,
}));

// ── Base en mémoire : on capture ce qui est inséré ──────────────────────────
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
const RUSH_PUBLIC = 'https://projet.supabase.co/storage/v1/object/public/media/u/rush.mp4';
/** URL d'une génération d'avatar re-hébergée, telle que /api/avatar/status la pose. */
const JUMEAU_URL = 'https://minio.test/videos/u1/avatar/gen-123.mp4';

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: [RUSH_PUBLIC], voiceEnabled: false, ...p,
});
const unPost = (c: AutopilotConfig) =>
  preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];

async function produire(c: AutopilotConfig, jumeauVideoUrl: string | null) {
  const post = unPost(c);
  const rendu = await produireUnMontage({
    userId: 'u1', config: c, post, rang: 0, now: T0,
    jobId: 'autopilote-u1-2026-08-05-1', jumeauVideoUrl,
  });
  return { rendu, meta: insertions[0]?.metadata as Record<string, unknown> };
}

describe('buildAutopilotDesign — la vidéo du jumeau tient la séquence « Vidéo »', () => {
  const post = { title: 'Sujet', content: { subtitle: 's', cards: [], tagLine: 'cta' }, rushUrl: RUSH_PUBLIC } as unknown as Parameters<typeof buildAutopilotDesign>[0];

  it('sans jumeau : le rush reste la vidéo, comme avant', () => {
    const d = buildAutopilotDesign(post, { config: DEFAULT_CONFIG });
    expect(d.videoUrl).toBe(RUSH_PUBLIC);
  });

  it('avec jumeau : SA vidéo remplace le rush, son audio est gardé, aucune voix off', () => {
    const voices = { titre: { url: 'https://cdn.test/voix.mp3', seconds: 3 } };
    const d = buildAutopilotDesign(post, {
      config: DEFAULT_CONFIG, voices, jumeau: { videoUrl: JUMEAU_URL, seconds: 12 },
    });
    expect(d.videoUrl).toBe(JUMEAU_URL);
    // L'avatar porte la voix clonée : on l'entend (pas de coupure du son).
    expect(d.rushMuted).toBe(false);
    // Le jumeau est la seule voix : aucune voix off par séquence.
    expect(d.sequenceVoiceUrls).toBeUndefined();
    // La séquence dure au moins la durée de la parole de l'avatar.
    expect(d.videoDuration).toBeGreaterThanOrEqual(12);
  });
});

describe('produireUnMontage — le jumeau réellement dans le montage', () => {
  beforeEach(() => {
    insertions = [];
    lastDesign = null;
    vi.clearAllMocks();
    rushEncorePresent.mockImplementation(async () => true);
    probeRushSeconds.mockImplementation(async (url: string) => (url.includes('/avatar/') ? 12 : 6));
  });

  it('monte la vidéo du jumeau, garde son son, n’ajoute aucune voix off, et le dit dans les métadonnées', async () => {
    // voiceEnabled: true — et pourtant AUCUNE voix off, car le jumeau la porte.
    const { meta } = await produire(cfg({ voiceEnabled: true, voiceId: 'elevenlabs-abc' }), JUMEAU_URL);
    expect(lastDesign?.videoUrl).toBe(JUMEAU_URL);
    expect(lastDesign?.rushMuted).toBe(false);
    expect(lastDesign?.sequenceVoiceUrls).toBeUndefined();
    // La synthèse par séquence n'est jamais lancée : pas de seconde voix, pas de coût.
    expect(buildAutopilotVoices).not.toHaveBeenCalled();
    // Le rush n'est ni sondé ni utilisé.
    expect(rushEncorePresent).not.toHaveBeenCalled();
    expect(meta.jumeau).toBe(true);
  });

  it('sans jumeau : montage ordinaire — le rush est sondé, pas de marqueur jumeau', async () => {
    const { meta } = await produire(cfg({ voiceEnabled: false }), null);
    expect(lastDesign?.videoUrl).toBe(RUSH_PUBLIC);
    expect(rushEncorePresent).toHaveBeenCalled();
    expect(meta.jumeau).toBeUndefined();
  });
});
