/**
 * M1 — Autopilote : le diagnostic QUALITÉ DES RUSHES est ÉCRIT dans le post
 * (`metadata.decisionMontage.qualiteRushs`, v1) et n'a AUCUN effet sur la
 * sélection ni sur le rendu. Harnais repris de
 * `autopilote-rush-validite-source.test.ts` (moteur réel, rendu doublé).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { RushSegment } from '@/lib/creer/multi-rush';

// ── Rendu doublé : on CAPTURE l'entrée de rendu ─────────────────────────────
let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

// ── La SEULE sonde doublée : le HEAD sûr, par statut ─────────────────────────
const STATUTS = new Map<string, number>();
// #547 : la sonde reçoit l'URL munie du jeton du relais (`?sr=`) ; le statut
// est indexé sur l'URL nue de l'objet.
const sonderSur = vi.fn(async (url: string) => ({ status: STATUTS.get(url.split('?')[0]) ?? 200, url, sauts: 0, entetes: {} }));
vi.mock('@/lib/securite/fetch-sur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/fetch-sur')>();
  return { ...actual, sonderSur: (u: string) => sonderSur(u) };
});

// `rushEncorePresent` RÉEL ; durée et affiche doublées (aucun parseMedia, aucun Pexels).
const probeRushSeconds = vi.fn(async (url: string): Promise<number> => (url.includes('/avatar/') ? 20 : url.includes('stock-') ? 8 : 15));
vi.mock('@/lib/autopilot/poster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/poster')>();
  return {
    ...actual,
    probeRushSeconds: (u: string) => probeRushSeconds(u),
    pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
    pickCustomPoster: () => null,
  };
});

vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});

// Analyse : espions (aucun ffmpeg). La garde `mediaLisiblePar` reste RÉELLE.
const analyserRushServeurCache = vi.fn(async (..._a: unknown[]): Promise<AnalyseRush | null> => null);
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return {
    ...actual,
    analyserRushServeurCache: (...a: unknown[]) => analyserRushServeurCache(...a),
    analyserMusiqueServeur: async () => null,
  };
});

const urlRenduPourRush = vi.fn(async (url: string, _u: string) => ({ url, proxy: false, cree: false }));
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: (u: string, id: string) => urlRenduPourRush(u, id) };
});

// Stockage : AUCUNE signature (MinIO ni Supabase) ne doit viser un rush refusé.
const presignedGetObject = vi.fn(async (b: string, c: string) => `http://studiio-minio:9000/${b}/${c}`);
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string) => presignedGetObject(b, c) }),
  clientMinio: () => ({ statObject: async () => ({ size: 1 }) }),
}));
const createSignedUrl = vi.fn(async (..._a: unknown[]) => ({ data: { signedUrl: 'https://signe.test/x' }, error: null }));

vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 10 }));
const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: (...a: unknown[]) => deductCredits(...a) }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));

let insertions: Array<Record<string, unknown>>;
/** Toute écriture hors insertion de post (banque, suppression…) serait une modification interdite. */
const ecrituresInterdites = vi.fn();
vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => ({
    select: () => { const q: Record<string, unknown> = { eq: () => q, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
    update: (...a: unknown[]) => { ecrituresInterdites(table, 'update', ...a); return { eq: async () => ({ error: null }) }; },
    delete: (...a: unknown[]) => { ecrituresInterdites(table, 'delete', ...a); return { eq: async () => ({ error: null }) }; },
  });
  const storage = { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a), remove: (...a: unknown[]) => ecrituresInterdites('storage', 'remove', ...a) }) };
  return { supabaseAdmin: { from, storage }, supabase: { from, storage } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const PUB = 'https://studiio.pro/storage/v1/object/public';
const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const R1 = `${PUB}/media/${U}/library/rush-a.mp4`;
const R2 = `${PUB}/media/${U}/library/rush-b.mp4`;
const R3 = `${PUB}/media/${U}/library/rush-c.mp4`;

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], voiceEnabled: false, ...p,
});

let journaux: string[];
async function produire(c: AutopilotConfig, opts: { rushDuPost?: string; jumeau?: string | null } = {}) {
  const post0 = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  const post = opts.rushDuPost !== undefined ? { ...post0, rushUrl: opts.rushDuPost } : post0;
  const onRushMort = vi.fn();
  const rendu = await produireUnMontage({ userId: U, config: c, post, rang: 0, now: T0, jobId: 'job-1', onRushMort, jumeauVideoUrl: opts.jumeau ?? null });
  return { rendu, post, onRushMort, design: lastDesign as Record<string, unknown>, meta: insertions[0]?.metadata as Record<string, unknown> };
}
const montage = (d: Record<string, unknown>) => (d.montage ?? []) as RushSegment[];
/** Tout ce que le RENDU reçoit (entrée de rendu complète). */
const entreeRendu = () => JSON.stringify(renderAndUpload.mock.calls);

beforeEach(() => {
  insertions = [];
  lastDesign = null;
  STATUTS.clear();
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
  journaux = [];
  for (const k of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { journaux.push(a.map(String).join(' ')); });
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });


function analyse(url: string, nettete: number, mouvement = 0.05): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < 15; t += 0.5) {
    echantillons.push({ t, mouvement: mouvement + 0.01 * Math.abs(Math.sin(t * 3)), luminosite: 0.45, nettete, audio: 0.3,
      empreinte: Array.from({ length: 64 }, (_, i) => ((Math.floor(t * 2) * 31 + i * 17 + url.length) % 97) / 97) });
  }
  return { url, duree: 15, echantillons };
}

describe('M1 — Autopilote : diagnostic écrit, sélection et rendu inchangés', () => {
  it('3 rushes dont 1 flou : verdicts + motifs + version dans le post, plan du moteur intact', async () => {
    const mesures: Record<string, AnalyseRush> = { [R1]: analyse(R1, 0.18), [R2]: analyse(R2, 0.25), [R3]: analyse(R3, 0.02, 0.0005) };
    analyserRushServeurCache.mockImplementation(async (u: unknown) => mesures[u as string] ?? null);
    const { meta, design } = await produire(cfg({ rushUrls: [R1, R2, R3] }));
    const d = (meta.decisionMontage as { version: number; qualiteRushs: { version: number; rushs: Array<{ cle: string; verdict: string; motifs: Array<{ code: string; texte: string }>; choisiParVous?: boolean }> } });
    expect(d.version).toBe(1);
    expect(d.qualiteRushs.version).toBe(1);
    const flou = d.qualiteRushs.rushs.find((r) => r.cle.endsWith('rush-c.mp4'))!;
    expect(flou).toMatchObject({ verdict: 'inutilisable', choisiParVous: true });
    expect(flou.motifs[0].texte).toMatch(/^flou : netteté 0,02 contre 0,21 pour vos autres rushes/);
    expect(d.qualiteRushs.rushs.filter((r) => r.verdict === 'ok')).toHaveLength(2);
    // Aucune URL dans le diagnostic ; rien du diagnostic dans l'entrée de rendu.
    expect(JSON.stringify(d)).not.toMatch(/https?:/);
    expect(entreeRendu()).not.toContain('qualiteRushs');
    // Le plan ne l'écarte PAS : M1 n'est qu'un diagnostic.
    expect(montage(design).length).toBeGreaterThan(0);
    expect(meta.rushSegments).toEqual(montage(design));
  });

  it('analyses impossibles (mesures neutres) : aucun diagnostic inventé', async () => {
    analyserRushServeurCache.mockImplementation(async () => null);
    const { meta } = await produire(cfg({ rushUrls: [R1, R2] }));
    expect(meta.decisionMontage).toBeUndefined();
  });

  it('diagnostic calculé APRÈS le rendu (le rendu ne peut pas le lire)', async () => {
    const { readFileSync } = await import('fs');
    const p = readFileSync('src/lib/autopilot/produire.ts', 'utf8');
    expect(p.indexOf('evaluerQualiteRushs(mesurees')).toBeGreaterThan(p.indexOf('await renderAndUpload({'));
  });
});
