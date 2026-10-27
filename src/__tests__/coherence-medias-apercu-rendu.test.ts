/**
 * COHÉRENCE MÉDIAS — aperçu ↔ rendu, et médias choisis jamais écartés en silence.
 *
 * (e) Sans avatar, « Plan avant génération » calculait la séquence « Vidéo »
 *     sur la durée cible BRUTE, quand le moteur en déduit titre, cartes et CTA
 *     (hors surimpression) et la plafonne à la matière : plans 2× trop longs.
 * (f) Un rush expiré ou un média stock retenu introuvable n'était écrit que
 *     dans `rushIgnore` / `stockIgnores`, qu'aucun écran ne lit.
 *
 * Harnais (rendu doublé, sondes doublées) repris de
 * `autopilote-multi-sources-produire.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
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

const MORTS = new Set<string>();
const rushEncorePresent = vi.fn(async (url: string) => !MORTS.has(url));
const probeRushSeconds = vi.fn(async (url: string): Promise<number> => (url.includes('/avatar/') ? 20 : url.includes('stock-') ? 8 : 15));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (...a: unknown[]) => rushEncorePresent(...(a as [string])),
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

const buildAutopilotVoices = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: (...a: unknown[]) => buildAutopilotVoices(...(a as [])) };
});

// Analyse serveur : aucune lecture ffmpeg — mesures impossibles → neutres (réel).
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return { ...actual, analyserRushServeurCache: async () => null, analyserMusiqueServeur: async () => null };
});

const urlRenduPourRush = vi.fn(async (url: string) => ({ url, proxy: false, cree: false }));
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: (u: string) => urlRenduPourRush(u) };
});

const PRIX: Record<string, number> = { 'render.reel': 10, 'avatar.jumeau': 25, 'autopilot.poster_reference': 5 };
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async (cle: string) => PRIX[cle] ?? 0 }));

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
    select: () => { const q: Record<string, unknown> = { eq: () => q, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';
import { planCompletAutopilote } from '@/lib/autopilot/plan-complet';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { sujetsCourants } from '@/lib/autopilot/sources';

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const S = 'https://studiio.pro/storage/v1/object/public/media/u1/';
const R1 = `${S}rush-a.mp4`;
const R2 = `${S}rush-b.mp4`;
const SV1 = `${S}stock-pexels-video-111.mp4`;
const SV2 = `${S}stock-pexels-video-222.mp4`;
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const P2 = 'https://images.unsplash.com/photo-2?w=1080';

const media = (url: string, type: 'video' | 'photo', provider: 'pexels' | 'unsplash' = 'pexels'): MediaStockRetenu => ({
  url, type, provider, providerAssetId: url.slice(-3), auteur: 'Auteur', sourceUrl: 'https://www.pexels.com/x', licence: 'Pexels', vignetteUrl: '',
});
const sources = (p: Partial<ConfigSources['actives']>, stock: MediaStockRetenu[] = [], gabarit: ConfigSources['gabarit'] = []): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...p }, stock, gabarit,
});
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [R1], voiceEnabled: false, ...p,
});

let TOPIC = 'routine du matin';
async function produire(c: AutopilotConfig, jumeauVideoUrl: string | null = null) {
  const post = preparePosts({ config: c, topic: TOPIC, count: 1, now: T0 })[0];
  const rendu = await produireUnMontage({ userId: 'u1', config: c, post, rang: 0, now: T0, jobId: 'job-1', jumeauVideoUrl });
  return { rendu, post, design: lastDesign as Record<string, unknown>, meta: insertions[0]?.metadata as Record<string, unknown> };
}
const montageDe = (d: Record<string, unknown>) => (d.montage ?? []) as RushSegment[];

// La sonde SÛRE des médias stock (`sonde-stock.ts`) passe par `fetch` : un média « mort » répond 404.
// Une URL de REDIRECTIONS répond 302 vers sa cible (jamais suivie par `fetch` ici : `redirect: manual`).
// En production la sonde passe par le fetch SÛR (DNS + adresses, prouvé par
// `securite-fetch-sur-ssrf.test.ts`) ; ici on lui injecte ce `fetch` espion
// (son transport de test) pour juger le CÂBLAGE du moteur.
vi.mock('@/lib/autopilot/sonde-stock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/sonde-stock')>();
  return {
    ...actual,
    sonderMediaStock: (u: string, t: 'video' | 'photo', o: Parameters<typeof actual.sonderMediaStock>[2] = {}) =>
      actual.sonderMediaStock(u, t, { ...o, fetchImpl: ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)) as typeof fetch }),
  };
});
const REDIRECTIONS = new Map<string, string>();
const fetchEspion = vi.fn(async (url: string | URL | Request) => {
  const cible = REDIRECTIONS.get(String(url));
  if (cible) return new Response(null, { status: 302, headers: { Location: cible } });
  return new Response(null, { status: MORTS.has(String(url)) ? 404 : 200 });
});

beforeEach(() => {
  insertions = [];
  lastDesign = null;
  MORTS.clear();
  REDIRECTIONS.clear();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchEspion);
});


const STOCK = [media(SV1, 'video'), media(SV2, 'video'), media(P1, 'photo'), media(P2, 'photo', 'unsplash')];

/** Le plan de l'aperçu, avec les options EXACTES de l'écran (`AutopilotPanel` → `PlanAvantGeneration`). */
function planApercu(c: AutopilotConfig, post: { title: string; content?: { subtitle?: string | null; cards?: Array<{ title?: string; description?: string }> } }) {
  const contexte = { sujets: sujetsCourants(c), titre: post.title, sousTitre: post.content?.subtitle ?? null, objectif: null, message: null, cta: null, cartes: post.content?.cards ?? [] };
  const duree = c.brief?.duree ?? null;
  const gabarit = gabaritSuggere({ avatar: false, rushes: 0, stock: STOCK.length }, { dureeSecondes: duree, rythme: null });
  return planCompletAutopilote(
    { gabarit, actives: { rushes: true, stock: true, avatar: false }, rushesPerso: [], stock: STOCK, avatar: { disponible: false, vignette: null } },
    { cible: duree ?? 30, dureeVisee: duree, contexte, durees: { [SV1]: 8, [SV2]: 8 } },
  ).segments.map((s) => [s.url, s.debut, s.fin]);
}

describe('(e) sans avatar : le plan montré = le plan rendu', () => {
  it('profil STANDARD, brief 30 s : titre/cartes/CTA déduits comme au rendu', async () => {
    TOPIC = 'gestion de budget pour entrepreneurs';
    const c = cfg({ rushUrls: [], topics: ['finance'], brief: { duree: 30 }, designStyle: { sources: sources({ stock: true, rushes: false }, STOCK) } });
    const { design, post } = await produire(c);
    expect(design.surimpressions).toBeUndefined();
    expect(planApercu(c, post)).toEqual(montageDe(design).map((s) => [s.url, s.debut, s.fin]));
  });

  it('profil en surimpression, brief 30 s : la matière plafonne l’aperçu comme le rendu', async () => {
    TOPIC = 'routine du matin';
    const c = cfg({ rushUrls: [], brief: { duree: 30 }, designStyle: { sources: sources({ stock: true, rushes: false }, STOCK) } });
    const { design, post } = await produire(c);
    expect(design.surimpressions).toBeTruthy();
    expect(planApercu(c, post)).toEqual(montageDe(design).map((s) => [s.url, s.debut, s.fin]));
  });

  it('sans brief : la référence d’avant (≈ 30 s, matière en plafond), identique au rendu', async () => {
    TOPIC = 'routine du matin';
    const c = cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, STOCK) } });
    const { design, post } = await produire(c);
    expect(planApercu(c, post)).toEqual(montageDe(design).map((s) => [s.url, s.debut, s.fin]));
  });
});

describe('(f) un média choisi écarté est DIT dans `avertissements` (lu par le Calendrier)', () => {
  it('média stock retenu introuvable', async () => {
    MORTS.add(P2);
    const c = cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { meta, rendu } = await produire(c);
    expect(meta.stockIgnores).toEqual([P2]);
    expect((meta.avertissements as string[]).join(' ')).toMatch(/média stock retenu était introuvable/);
    expect(rendu.avertissements).toEqual(meta.avertissements);
  });

  it('rush expiré, remplacé par un autre rush de la banque', async () => {
    MORTS.add(R1);
    const { meta, rendu } = await produire(cfg({ rushUrls: [R1, R2] }));
    expect(rendu.rushUrl).toBe(R2);
    expect((meta.avertissements as string[]).join(' ')).toMatch(/un autre de vos rushes l’a remplacé/);
  });

  it('rush expiré, aucun autre : la vidéo sort sans lui, et c’est dit', async () => {
    MORTS.add(R1);
    const { meta, rendu } = await produire(cfg({ rushUrls: [R1] }));
    expect(rendu.rushUrl).toBeNull();
    expect((meta.avertissements as string[]).join(' ')).toMatch(/sortie sans lui/);
  });

  it('rien d’écarté : aucun avertissement (posts existants inchangés)', async () => {
    const { meta, rendu } = await produire(cfg({ rushUrls: [R1], designStyle: { sources: sources({ stock: true }, [media(P1, 'photo')]) } }));
    expect(meta.avertissements).toBeUndefined();
    expect(rendu.avertissements).toEqual([]);
  });
});
