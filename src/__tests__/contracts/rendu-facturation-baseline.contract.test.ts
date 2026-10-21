/**
 * A2.1 — BASELINE DE FACTURATION DU RENDU (caractérisation, aucun changement de code).
 *
 * Fige ce qui est facturé AUJOURD'HUI (main 59478eb), avant le mapper partagé :
 *   1. Créer : format facturé = `formatRenduFacturation(format)` aux trois
 *      sites d'appel d'AssistantWizard (composerEtFacturer + deux `format:`).
 *   2. Créer : écart de prix du CARRÉ — DIFFÉRENCE EXISTANTE (décision produit
 *      en attente) : l'écran affiche `render.reel`, le serveur reçoit 'tv'.
 *   3. Calendrier : `formatRendu` local (non exporté) — 'reel'→'reel', tout le
 *      reste → 'tv' (asymétrique avec `formatDuPost`, défaut 9:16).
 *   4. Autopilote : débit après rendu = `coutMontage()` (= prixDe('render.reel')),
 *      type 'render', référence `referenceOperation('autopilote', jobId)` ;
 *      colonne `format` = 'reel', `metadata.videoFormat` = '9:16'.
 *
 * Les points 1 à 3 vivent dans des fichiers de page (14 000 lignes, ou une
 * fonction non exportée d'une page Next) : ils sont gardés par une lecture
 * du SOURCE, ciblée sur les lignes porteuses, combinée à l'appel réel de la
 * fonction pure qu'elles utilisent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Banc Autopilote (doublures, aucun réseau) ──────────────────────────────
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: async () => ({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 720 }),
}));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 15,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return { ...actual, analyserRushServeurCache: async () => null, analyserMusiqueServeur: async () => null };
});
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: async (url: string) => ({ url, proxy: false, cree: false }) };
});
const PRIX: Record<string, number> = { 'render.reel': 12, 'render.tv': 17 };
const prixDe = vi.fn(async (cle: string) => PRIX[cle] ?? 0);
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: (cle: string) => prixDe(cle) }));
const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: (...a: unknown[]) => deductCredits(...a) }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));
let insertions: Array<Record<string, unknown>> = [];
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { formatRenduFacturation, formatDuPost, PROJECT_VIDEO_FORMATS } from '@/lib/format/projet';
import { preparePosts } from '@/lib/autopilot/engine';
import { produireUnMontage, coutMontage } from '@/lib/autopilot/produire';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

const racine = resolve(__dirname, '../../..');
const wizard = readFileSync(resolve(racine, 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
const calendrier = readFileSync(resolve(racine, 'src/app/dashboard/calendar/page.tsx'), 'utf-8');

// ═════════════════════════════════════════════════════════════════════════
describe('1. Créer — format facturé = formatRenduFacturation(format)', () => {
  it('la fonction : 9:16 → reel, 1:1 → tv, 16:9 → tv', () => {
    expect(PROJECT_VIDEO_FORMATS.map((f) => [f, formatRenduFacturation(f)])).toEqual([
      ['9:16', 'reel'], ['1:1', 'tv'], ['16:9', 'tv'],
    ]);
  });

  it('AssistantWizard : `renderFormat` vient de formatRenduFacturation(format) et part aux 3 sites', () => {
    const decl = wizard.match(/const renderFormat: 'reel' \| 'tv' = ([^;]+);/g) ?? [];
    expect(decl).toEqual(["const renderFormat: 'reel' | 'tv' = formatRenduFacturation(format);"]);
    // Site 1 : la facturation du rendu.
    expect(wizard.match(/composerEtFacturer\('calendrier', renderFormat, optionsRendu, \{/g)?.length).toBe(1);
    // Sites 2 et 3 : `format: renderFormat` (fil de confirmation et colonne du post).
    expect(wizard.match(/\bformat: renderFormat,/g)?.length).toBe(2);
    // Aucun autre format ne part à composerEtFacturer.
    expect((wizard.match(/composerEtFacturer\(/g) ?? []).length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('2. Créer — prix affiché du carré (DIFFÉRENCE EXISTANTE, décision produit en attente)', () => {
  it('l’écran affiche render.tv pour 16:9 seulement ; le 1:1 affiche render.reel mais facture « tv »', () => {
    const ligne = wizard.match(/const cost = (.+);/g) ?? [];
    expect(ligne).toContain("const cost = format === '16:9' ? grilleTarifs['render.tv'] : grilleTarifs['render.reel'];");
    // Reproduction exacte de la règle d'affichage, pour les trois formats.
    const cleAffichee = (f: string) => (f === '16:9' ? 'render.tv' : 'render.reel');
    const cleFacturee = (f: '9:16' | '1:1' | '16:9') => `render.${formatRenduFacturation(f)}`;
    expect(PROJECT_VIDEO_FORMATS.map((f) => [f, cleAffichee(f), cleFacturee(f)])).toEqual([
      ['9:16', 'render.reel', 'render.reel'],
      // DIFFÉRENCE EXISTANTE : affiché reel, facturé tv.
      ['1:1', 'render.reel', 'render.tv'],
      ['16:9', 'render.tv', 'render.tv'],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('3. Calendrier — formatRendu local (non exporté)', () => {
  const src = calendrier.match(/function formatRendu\(p\?: \{ format\?: string \| null \} \| null\): 'reel' \| 'tv' \{\n\s*(return [^\n]+)\n\}/);
  it('le source est celui figé', () => {
    expect(src?.[1]).toBe("return p?.format === 'reel' ? 'reel' : 'tv';");
  });
  it('reel → reel ; tv, absent, hérité, inconnu → tv (asymétrique avec formatDuPost, défaut 9:16)', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const formatRendu = new Function('p', src![1]) as (p?: { format?: string | null } | null) => string;
    const cas = [{ format: 'reel' }, { format: 'tv' }, {}, { format: null }, null, undefined, { format: 'square' }, { format: '9:16' }];
    expect(cas.map((p) => formatRendu(p))).toEqual(['reel', 'tv', 'tv', 'tv', 'tv', 'tv', 'tv', 'tv']);
    // L'asymétrie : un post sans format se LIT 9:16 mais se FACTURE tv.
    expect(formatDuPost({}, '9:16')).toBe('9:16');
    expect(formatRendu({})).toBe('tv');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('4. Autopilote — débit après rendu', () => {
  const T0 = Date.parse('2026-10-10T09:00:00.000Z');
  const cfg: AutopilotConfig = {
    ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
    rushUrls: ['https://studiio.pro/storage/v1/object/public/media/u1/rush-a.mp4'], voiceEnabled: false,
  };
  beforeEach(() => {
    insertions = [];
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('coutMontage() = prixDe("render.reel")', async () => {
    expect(await coutMontage()).toBe(12);
    expect(prixDe).toHaveBeenCalledWith('render.reel');
    expect(prixDe).not.toHaveBeenCalledWith('render.tv');
  });

  it('deductCredits(userId, coutMontage(), "render", referenceOperation("autopilote", jobId)) ; post « reel » / 9:16', async () => {
    const post = preparePosts({ config: cfg, topic: 'routine du matin', count: 1, now: T0 })[0];
    await produireUnMontage({ userId: 'u1', config: cfg, post, rang: 0, now: T0, jobId: 'job-42', jumeauVideoUrl: null });
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledWith('u1', 12, 'render', 'autopilote:job-42');
    expect(insertions).toHaveLength(1);
    expect(insertions[0].format).toBe('reel');
    expect((insertions[0].metadata as Record<string, unknown>).videoFormat).toBe('9:16');
  });

  it('un prix annoncé (`coutRendu`) est le prix débité', async () => {
    const post = preparePosts({ config: cfg, topic: 'routine du matin', count: 1, now: T0 })[0];
    await produireUnMontage({ userId: 'u1', config: cfg, post, rang: 0, now: T0, jobId: 'job-43', jumeauVideoUrl: null, coutRendu: 30 } as never);
    expect(deductCredits).toHaveBeenCalledWith('u1', 30, 'render', 'autopilote:job-43');
  });
});
