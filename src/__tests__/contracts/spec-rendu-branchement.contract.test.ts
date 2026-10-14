/**
 * A2.2 — BRANCHEMENT de la spec canonique dans `renderCreerSimple`.
 *
 * Oracle GELÉ : `inputPropsHistoriques(d)` est la copie LITTÉRALE du calcul
 * que `renderCreerSimple` faisait avant A2.2 (lignes 170-177 de
 * `src/lib/render/creerSimple.ts` au commit 735b27c), et
 * `planHistorique(d)` celle de son appel à `buildSequences`.
 * Ces tests ont été écrits et passés VERTS sur le code non modifié, puis
 * `renderCreerSimple` a été branché sur `versEntreeRemotion` : la sortie
 * confiée au worker Remotion (doublé, aucun réseau) doit rester identique.
 *
 * Banc copié de `spec-rendu-parite.contract.test.ts` (un `vi.mock` est
 * propre à chaque fichier de test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Doublures (même banc que `autopilote-multi-sources-produire.test.ts`) ──
let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

const probeRushSeconds = vi.fn(async (url: string): Promise<number> => (url.includes('/avatar/') ? 20 : url.includes('stock-') ? 8 : 15));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

type Voix = Record<string, { url: string; seconds: number }>;
let voixDoublees: Voix = {};
vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: async () => voixDoublees };
});
vi.mock('@/lib/creer/analyse-rush-serveur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creer/analyse-rush-serveur')>();
  return { ...actual, analyserRushServeurCache: async () => null, analyserMusiqueServeur: async () => null };
});
vi.mock('@/lib/render/proxy-rendu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/proxy-rendu')>();
  return { ...actual, urlRenduPourRush: async (url: string) => ({ url, proxy: false, cree: false }) };
});
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 10 }));
// Crédits : modules AUTO-doublés (aucun débit réel). Le rendu est confié AVANT
// tout débit, donc l'entrée capturée ne dépend pas de ces doublures.
vi.mock('@/lib/credits/system');
vi.mock('@/lib/credits/atomique');
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
vi.mock('@/lib/autopilot/sonde-stock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/sonde-stock')>();
  return {
    ...actual,
    sonderMediaStock: (u: string, t: 'video' | 'photo', o: Parameters<typeof actual.sonderMediaStock>[2] = {}) =>
      actual.sonderMediaStock(u, t, { ...o, fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch }),
  };
});
// Worker Remotion doublé : on capture ce que `renderCreerSimple` lui confie.
let lastInputProps: Record<string, unknown> | null = null;
vi.mock('@/lib/render/worker', () => ({
  renderVideo: async (a: { inputProps: Record<string, unknown> }) => {
    lastInputProps = a.inputProps;
    return { outputPath: '/tmp/baseline.mp4' };
  },
}));

import { preparePosts, type PreparedPost } from '@/lib/autopilot/engine';
import { produireUnMontage } from '@/lib/autopilot/produire';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import { renderCreerSimple } from '@/lib/render/creerSimple';
import { planFromProps } from '../../../remotion/CreerSimpleMontage';
import {
  totalDurationFrames, totalDurationSeconds, VIDEO_SIZE, type PlannedSequence,
} from '@/lib/creer/designSpec';
import { buildSequences } from '@/lib/creer/designSpec';
// ── Constantes des fixtures ────────────────────────────────────────────────
const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const S = 'https://studiio.pro/storage/v1/object/public/media/u1/';
const R1 = `${S}rush-a.mp4`;
const R2 = `${S}rush-b.mp4`;
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const P2 = 'https://images.unsplash.com/photo-2?w=1080';
const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';
const MUSIQUE = 'https://cdn.test/musique.mp3';
const VOIX: Voix = {
  titre: { url: 'https://cdn.test/v-titre.mp3', seconds: 3.4 },
  cartes: { url: 'https://cdn.test/v-cartes.mp3', seconds: 7.2 },
  video: { url: 'https://cdn.test/v-video.mp3', seconds: 5 },
  cta: { url: 'https://cdn.test/v-cta.mp3', seconds: 2.5 },
};

const photo = (url: string): MediaStockRetenu => ({
  url, type: 'photo', provider: 'pexels', providerAssetId: url.slice(-3), auteur: 'Auteur',
  sourceUrl: 'https://www.pexels.com/x', licence: 'Pexels', vignetteUrl: '',
});
const sources = (p: Partial<ConfigSources['actives']>, stock: MediaStockRetenu[] = []): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...p }, stock, gabarit: [],
});
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [R1], voiceEnabled: false, ...p,
});

// ── Fixtures AUTOPILOTE (le format est FIXE : 9:16, cf. B/C) ───────────────
interface FixtureAuto { cfg: AutopilotConfig; jumeau?: string | null; voix?: Voix }
const AUTO: Record<string, FixtureAuto> = {
  'A-916-simple': { cfg: cfg() },
  'D-rushes-multiples': { cfg: cfg({ rushUrls: [R1, R2] }) },
  'E-avatar': { cfg: cfg({ jumeauAvatar: true, rushUrls: [] }), jumeau: AV },
  'F-images-ken-burns': {
    cfg: cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [photo(P1), photo(P2)]) } }),
  },
  'G-cta-sans-sous-texte': { cfg: cfg({ brief: {} }) },
  'H-cta-avec-sous-texte': { cfg: cfg({ brief: { cta: 'Réserve ta séance' } }) },
  'avatar-plus-rush': { cfg: cfg({ jumeauAvatar: true, rushUrls: [R1] }), jumeau: AV },
  'J-musique-voix': {
    cfg: cfg({ musicUrl: MUSIQUE, voiceEnabled: true, musicVolume: 0.35, voiceVolume: 0.9, rushVolume: 0.6, keepRushAudio: false }),
    voix: VOIX,
  },
};

interface ResultatAuto {
  post: PreparedPost;
  design: Record<string, unknown>;
  meta: Record<string, unknown>;
  row: Record<string, unknown>;
}
async function produireAuto(fx: FixtureAuto): Promise<ResultatAuto> {
  insertions = [];
  lastDesign = null;
  voixDoublees = fx.voix ?? {};
  const post = preparePosts({ config: fx.cfg, topic: 'routine du matin', count: 1, now: T0 })[0];
  await produireUnMontage({ userId: 'u1', config: fx.cfg, post, rang: 0, now: T0, jobId: 'job-1', jumeauVideoUrl: fx.jumeau ?? null });
  expect(lastDesign, 'le moteur doit avoir confié une entrée de rendu').not.toBeNull();
  const row = insertions[0] ?? {};
  return { post, design: lastDesign as unknown as Record<string, unknown>, meta: (row.metadata ?? {}) as Record<string, unknown>, row };
}

/** Ce que `renderCreerSimple` confie AUJOURD'HUI au worker (doublé) + images. */
async function renduServeur(design: object) {
  lastInputProps = null;
  const r = await renderCreerSimple({ jobId: 'job-1', userId: 'u1', design: design as never });
  return { inputProps: lastInputProps as unknown as Record<string, unknown>, durationFrames: r.durationFrames };
}

const sequencesResume = (s: PlannedSequence[]) => ({
  ordre: s.map((x) => x.type),
  durees: s.map((x) => x.duration),
  total: totalDurationSeconds(s),
  images30: totalDurationFrames(s, 30),
  transitions: Math.max(0, s.length - 1),
});


// ── ORACLE GELÉ — NE PAS MODIFIER (copie de creerSimple.ts l.170-177 @735b27c) ──
function inputPropsHistoriques(d: any) {
  const inputProps = {
    ...d,
    introDuration: d.introDuration ?? 4,
    cardsDuration: d.cardsDuration ?? 6,
    videoDuration: d.videoDuration ?? 0,
    ctaDuration: d.ctaDuration ?? 4,
    cards: d.cards ?? [],
  };
  return inputProps;
}
// Copie de l'appel historique à buildSequences (creerSimple.ts l.182-192 @735b27c).
function planHistorique(d: any) {
  const inputProps = inputPropsHistoriques(d);
  const sequences = buildSequences({
    introDuration: inputProps.introDuration,
    cardsDuration: inputProps.cardsDuration,
    videoDuration: inputProps.videoDuration,
    ctaDuration: inputProps.ctaDuration,
    cardCount: inputProps.cards.length,
    hasVideoBackground: !!d.videoUrl,
    videoRequested: !!d.videoUrl,
    sequenceOrder: d.sequenceOrder ?? null,
  });
  return { sequences, durationFrames: totalDurationFrames(sequences, 30) };
}
/** Dimensions : la règle de calculateMetadata (remotion/index.tsx). */
function dimensionsHistoriques(props: Record<string, unknown>) {
  const format = props.format === '16:9' ? '16:9' : props.format === '1:1' ? '1:1' : '9:16';
  return { w: VIDEO_SIZE[format].w, h: VIDEO_SIZE[format].h };
}

/** Assertion commune : le worker reçoit EXACTEMENT ce que l'ancien chemin produisait. */
async function verifierIdentique(design: Record<string, unknown>) {
  const copie = structuredClone(design);
  const attendu = inputPropsHistoriques(copie);
  const planAttendu = planHistorique(copie);
  const serveur = await renduServeur(design);
  expect(serveur.inputProps).toStrictEqual(attendu);
  expect(Object.keys(serveur.inputProps)).toEqual(Object.keys(attendu));
  expect(serveur.durationFrames).toBe(planAttendu.durationFrames);
  const tl = planFromProps(serveur.inputProps as never);
  expect(tl).toEqual(planAttendu.sequences);
  expect(sequencesResume(tl)).toEqual(sequencesResume(planAttendu.sequences));
  expect(totalDurationFrames(tl, 30)).toBe(planAttendu.durationFrames);
  expect(dimensionsHistoriques(serveur.inputProps)).toEqual(dimensionsHistoriques(attendu));
  // L'entrée n'est pas mutée.
  expect(design).toStrictEqual(copie);
  return { serveur, planAttendu };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  insertions = [];
  lastDesign = null;
  lastInputProps = null;
  voixDoublees = {};
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('A2.2 — renderCreerSimple ≡ oracle gelé, par fixture Autopilote', () => {
  for (const [nom, fx] of Object.entries(AUTO)) {
    it(`${nom} : props worker, durée, séquences et dimensions identiques`, async () => {
      const { design } = await produireAuto(fx);
      const { serveur } = await verifierIdentique(design);
      expect(dimensionsHistoriques(serveur.inputProps)).toEqual({ w: VIDEO_SIZE['9:16'].w, h: VIDEO_SIZE['9:16'].h });
      if (nom.startsWith('G-')) expect('ctaSubText' in serveur.inputProps).toBe(false);
      if (nom.startsWith('H-')) {
        expect('ctaSubText' in serveur.inputProps).toBe(true);
        expect(serveur.inputProps.ctaSubText).toBe(design.ctaSubText);
      }
    });
  }
});

describe('A2.2 — renderCreerSimple ≡ oracle gelé, designs directs', () => {
  const base = {
    title: 'ROUTINE', subtitle: 'Trois gestes', cards: [{ title: 'A' }, { title: 'B' }],
    ctaText: 'JE ME LANCE', videoUrl: R1, videoDuration: 10,
  };

  for (const format of ['9:16', '1:1', '16:9'] as const) {
    it(`format ${format} → dimensions = VIDEO_SIZE`, async () => {
      const { serveur } = await verifierIdentique({ ...base, format });
      expect(dimensionsHistoriques(serveur.inputProps)).toEqual({ w: VIDEO_SIZE[format].w, h: VIDEO_SIZE[format].h });
    });
  }

  it("ctaSubText '' conservé tel quel", async () => {
    const { serveur } = await verifierIdentique({ ...base, ctaSubText: '' });
    expect(serveur.inputProps.ctaSubText).toBe('');
  });

  it('média absent : pas de séquence Vidéo', async () => {
    const { serveur } = await verifierIdentique({ ...base, videoUrl: null });
    expect(planFromProps(serveur.inputProps as never).map((s) => s.type)).not.toContain('video');
    const { serveur: s2 } = await verifierIdentique({ title: 'X', cards: [{ title: 'A' }] });
    expect(planFromProps(s2.inputProps as never).map((s) => s.type)).not.toContain('video');
  });

  it('média invalide : URL transmise inchangée', async () => {
    const invalide = 'pas-une-url://???';
    const { serveur } = await verifierIdentique({ ...base, videoUrl: invalide });
    expect(serveur.inputProps.videoUrl).toBe(invalide);
  });

  for (const transition of ['crossfade', 'slide', 'whip-pan', 'fade-to-black'] as const) {
    it(`transition ${transition} transmise telle quelle, raccords = séquences − 1`, async () => {
      const { serveur, planAttendu } = await verifierIdentique({ ...base, transition });
      expect(serveur.inputProps.transition).toBe(transition);
      expect(sequencesResume(planFromProps(serveur.inputProps as never)).transitions).toBe(planAttendu.sequences.length - 1);
    });
  }

  it('ancienne metadata : durées null/absentes, ni sequenceOrder ni cards, clés inconnues', async () => {
    const ancien = {
      title: 'ANCIEN', introDuration: null, cardsDuration: undefined, ctaDuration: null,
      videoUrl: R1, cleInconnue: 'garde-moi', autreVieuxChamp: { a: 1 },
    } as Record<string, unknown>;
    const { serveur } = await verifierIdentique(ancien);
    expect(serveur.inputProps).toMatchObject({
      introDuration: 4, cardsDuration: 6, videoDuration: 0, ctaDuration: 4, cards: [],
      cleInconnue: 'garde-moi', autreVieuxChamp: { a: 1 },
    });
  });
});

describe('A2.2 — source : renderCreerSimple passe par la spec canonique', () => {
  it('creerSimple.ts importe versEntreeRemotion et ne recalcule plus les défauts', () => {
    const source = readFileSync(join(__dirname, '../../lib/render/creerSimple.ts'), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*\bversEntreeRemotion\b[^}]*\}\s*from\s*'@\/lib\/render\/spec-rendu'/);
    expect(source).toContain('versEntreeRemotion(d)');
    expect(source).not.toContain('introDuration: d.introDuration ?? 4');
    // Le calcul de la ligne de temps reste en place (lu par rendu-serveur-designspec).
    expect(source).toContain('buildSequences({');
    expect(source).toContain('totalDurationFrames(sequences, 30)');
  });
});
