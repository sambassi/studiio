/**
 * IDOR — `produireUnMontage` avec une banque de rushes (écrite par A) qui
 * contient l'adresse d'un objet PRIVÉ de B.
 *
 * Attendu : le rush (ou la musique) de B est LÂCHÉ avant toute sonde,
 * analyse, signature ou rendu ; le montage continue avec les rushes de A ;
 * rien de B n'apparaît dans l'entrée de rendu ni dans les métadonnées.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

const rushEncorePresent = vi.fn(async (_url: string) => true);
const probeRushSeconds = vi.fn(async (_url: string): Promise<number> => 15);
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (...a: unknown[]) => rushEncorePresent(...(a as [string])),
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});

// Analyse : espions (aucun ffmpeg) ; la garde `mediaLisiblePar` reste RÉELLE.
const analyserRushServeurCache = vi.fn(async (..._a: unknown[]) => null);
const analyserMusiqueServeur = vi.fn(async (..._a: unknown[]) => null);
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return {
    ...actual,
    analyserRushServeurCache: (...a: unknown[]) => analyserRushServeurCache(...a),
    analyserMusiqueServeur: (...a: unknown[]) => analyserMusiqueServeur(...a),
  };
});

const urlRenduPourRush = vi.fn(async (url: string, _u: string) => ({ url, proxy: false, cree: false }));
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: (u: string, id: string) => urlRenduPourRush(u, id) };
});

// Stockage : aucune signature ne doit viser B.
const presignedGetObject = vi.fn(async (b: string, c: string) => `http://studiio-minio:9000/${b}/${c}`);
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string) => presignedGetObject(b, c) }),
  clientMinio: () => ({ statObject: async () => ({ size: 1 }) }),
}));

vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 10 }));
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: async () => true }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));

let insertions: Array<Record<string, unknown>>;
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    select: () => { const q: Record<string, unknown> = { eq: () => q, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const PUB = 'https://studiio.pro/storage/v1/object/public';
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const A1 = `${PUB}/media/${A}/library/rush-a1.mp4`;
const A2 = `${PUB}/media/${A}/library/rush-a2.mp4`;
const B_RUSH = `${PUB}/media/${B}/library/rush-b.mp4`;
const B_SOURCE = `${PUB}/media/${B}/avatar/source-1700000000000-0123456789abcdef0123456789abcdef.jpg`;
const B_AUDIO = `${PUB}/audio/audio-complet/${B}/0123456789abcdef01234567.mp3`;

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], voiceEnabled: false, ...p,
});

async function produire(c: AutopilotConfig, rushDuPost?: string) {
  const post0 = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  const post = rushDuPost ? { ...post0, rushUrl: rushDuPost } : post0;
  const onRushMort = vi.fn();
  const rendu = await produireUnMontage({ userId: A, config: c, post, rang: 0, now: T0, jobId: 'job-1', onRushMort });
  return { rendu, onRushMort, design: lastDesign as Record<string, unknown>, meta: insertions[0]?.metadata as Record<string, unknown> };
}

/** Toutes les URL / arguments vus par une sonde, une analyse, un rendu ou une signature. */
function toutCeQuiAEteLu(): string {
  return JSON.stringify([
    rushEncorePresent.mock.calls, probeRushSeconds.mock.calls, analyserRushServeurCache.mock.calls,
    analyserMusiqueServeur.mock.calls, urlRenduPourRush.mock.calls, presignedGetObject.mock.calls,
  ]);
}

beforeEach(() => {
  insertions = [];
  lastDesign = null;
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('produireUnMontage — un objet de B dans la banque de A', () => {
  it('rush du créneau = rush de B : remplacé par un rush de A ; rien de B lu, rendu ni écrit', async () => {
    const { design, meta, onRushMort } = await produire(cfg({ rushUrls: [B_RUSH, A1, A2] }), B_RUSH);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(toutCeQuiAEteLu()).not.toContain(B);
    expect(JSON.stringify(design)).not.toContain(B);
    expect(JSON.stringify(meta)).not.toContain(B);
    // Le montage continue avec les rushes de A, analysés au nom de A.
    expect(JSON.stringify(design)).toMatch(/rush-a[12]\.mp4/);
    expect(analyserRushServeurCache).toHaveBeenCalled();
    for (const appel of analyserRushServeurCache.mock.calls) expect(appel[2]).toBe(A);
    // Lâché, pas « mort » : la banque n'est pas modifiée par ce refus.
    expect(onRushMort).not.toHaveBeenCalled();
    expect(meta.rushIgnore).toBeUndefined();
  });

  it('rush de B en COMPAGNON (banque) : écarté avant la sonde de présence', async () => {
    const { design } = await produire(cfg({ rushUrls: [A1, B_SOURCE, A2] }), A1);
    expect(toutCeQuiAEteLu()).not.toContain(B);
    expect(JSON.stringify(design)).not.toContain(B);
    // #547 : sondé AVEC le jeton du relais, au nom de A.
    expect(rushEncorePresent).toHaveBeenCalledWith(expect.stringContaining(`${A1}?sr=`), undefined, undefined, expect.any(Function));
  });

  it('seul rush = rush de B : montage sans rush (titre / cartes / CTA), sans échec', async () => {
    const { design, meta } = await produire(cfg({ rushUrls: [B_RUSH] }), B_RUSH);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(toutCeQuiAEteLu()).not.toContain(B);
    expect(JSON.stringify(design)).not.toContain(B);
    expect(JSON.stringify(meta)).not.toContain(B);
  });

  it('musique = audio payé de B : montage SANS musique, jamais sondée ni analysée', async () => {
    const { design, meta } = await produire(cfg({ rushUrls: [A1, A2], musicUrl: B_AUDIO }), A1);
    expect(toutCeQuiAEteLu()).not.toContain(B);
    expect(design.musicUrl ?? null).toBeNull();
    expect(meta.musiqueIgnoree).toBe(true);
    expect(JSON.stringify(meta)).not.toContain(B);
  });

  it('rushes de A uniquement : aucun refus, le chemin d’avant (analyses au nom de A)', async () => {
    const { design } = await produire(cfg({ rushUrls: [A1, A2] }), A1);
    // #547 : sondé AVEC le jeton du relais, au nom de A.
    expect(rushEncorePresent).toHaveBeenCalledWith(expect.stringContaining(`${A1}?sr=`), undefined, undefined, expect.any(Function));
    // #547 : sondé AVEC le jeton du relais, au nom de A.
    expect(rushEncorePresent).toHaveBeenCalledWith(expect.stringContaining(`${A2}?sr=`), undefined, undefined, expect.any(Function));
    expect(analyserRushServeurCache).toHaveBeenCalledWith(A1, 15, A);
    expect(JSON.stringify(design)).toContain('rush-a1.mp4');
    for (const appel of urlRenduPourRush.mock.calls) expect(appel[1]).toBe(A);
  });
});
