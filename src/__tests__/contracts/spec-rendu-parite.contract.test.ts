/**
 * A2.1 — SPEC DE RENDU CANONIQUE : parité stricte avec le chemin d'aujourd'hui.
 *
 * `src/lib/render/spec-rendu.ts` extrait, en fonctions PURES, ce que
 * `renderCreerSimple` calcule aujourd'hui (props Remotion + ligne de temps).
 * Rien n'est encore branché : ce fichier prouve que, pour chaque fixture
 * Autopilote de la baseline (`rendu-parite-baseline.contract.test.ts`), la
 * spec produit EXACTEMENT (toStrictEqual) les inputProps confiés au worker
 * Remotion doublé, et la MÊME ligne de temps.
 *
 * Banc : les doublures et fixtures ci-dessous sont COPIÉES de la baseline
 * (un `vi.mock` est propre à chaque fichier de test) — la baseline elle-même
 * n'est pas modifiée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import {
  versEntreeRemotion, planDeRendu, dimensionsDeRendu, CHAMPS_HORS_SPEC, CORRESPONDANCE_COMPOSITEUR,
  type SpecRendu,
} from '@/lib/render/spec-rendu';
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

/** Clés de facturation qui ne doivent JAMAIS entrer dans la spec. */
// Toute clé qui parle de crédit, coût, prix, tarif, opération, facturation ou de
// format facturé (reel/tv) est interdite dans la spec.
const CLES_FACTURATION = /(credit|cost|cout|prix|tarif|operation|factur|^plan$|^render.?format$)/i;

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

describe('SPEC DE RENDU — parité avec renderCreerSimple, par fixture Autopilote', () => {
  for (const [nom, fx] of Object.entries(AUTO)) {
    it(`${nom} : versEntreeRemotion ≡ inputProps d'aujourd'hui ; planDeRendu ≡ ligne de temps d'aujourd'hui`, async () => {
      const { design } = await produireAuto(fx);
      const spec = design as unknown as SpecRendu;
      const serveur = await renduServeur(design);

      // 1. Props Remotion : strictement identiques (aucune clé undefined en plus).
      const props = versEntreeRemotion(spec);
      expect(props).toStrictEqual(serveur.inputProps);
      // Même ordre de clés (l'étalement puis les défauts, comme aujourd'hui).
      expect(Object.keys(props)).toEqual(Object.keys(serveur.inputProps));
      // Pure : l'entrée n'est pas modifiée, la sortie est un nouvel objet.
      expect(props).not.toBe(spec);

      // 2. Ligne de temps : même règle que renderCreerSimple ET planFromProps.
      const plan = planDeRendu(spec);
      const tlRemotion = planFromProps(serveur.inputProps as never);
      expect(plan.sequences).toEqual(tlRemotion);
      expect(sequencesResume(plan.sequences)).toEqual(sequencesResume(tlRemotion));
      expect(plan.durationFrames).toBe(serveur.durationFrames);
      expect(plan.fps).toBe(30);
      expect(plan.transitions).toBe(Math.max(0, tlRemotion.length - 1));
      // Autopilote : 9:16 fixe.
      expect({ w: plan.width, h: plan.height }).toEqual({ w: VIDEO_SIZE['9:16'].w, h: VIDEO_SIZE['9:16'].h });

      // 3. Textes / CTA / médias inchangés (ni renommés, ni réordonnés).
      expect(props.title).toBe(design.title);
      expect(props.subtitle).toBe(design.subtitle);
      expect(props.cards).toStrictEqual(design.cards ?? []);
      expect(props.ctaText).toBe(design.ctaText);
      expect('ctaSubText' in props).toBe('ctaSubText' in design);
      expect(props.ctaSubText).toBe(design.ctaSubText);
      expect(props.watermark).toBe(design.watermark);
      expect(props.videoUrl).toBe(design.videoUrl);
      expect(props.posterUrl).toBe(design.posterUrl);
      expect(props.montage).toStrictEqual(design.montage);
      expect(props.rushs).toStrictEqual(design.rushs);
      expect(props.sequenceVoiceUrls).toStrictEqual(design.sequenceVoiceUrls);

      // 4. Aucune clé de facturation dans la spec ni dans les props.
      for (const k of [...Object.keys(spec), ...Object.keys(props)]) {
        expect(CLES_FACTURATION.test(k), `clé de facturation « ${k} »`).toBe(false);
      }
      // `format` de la spec = format VISUEL ('9:16'…), jamais 'reel' / 'tv'.
      expect(['9:16', '1:1', '16:9', undefined]).toContain(spec.format);
    });
  }
});

describe('SPEC DE RENDU — formats et cas limites (specs directes)', () => {
  const base: SpecRendu = {
    title: 'ROUTINE', subtitle: 'Trois gestes', cards: [{ title: 'A' }, { title: 'B' }],
    ctaText: 'JE ME LANCE', videoUrl: R1, videoDuration: 10,
  };

  for (const format of ['9:16', '1:1', '16:9'] as const) {
    it(`format ${format} → dimensions = VIDEO_SIZE, même règle que calculateMetadata`, async () => {
      const spec: SpecRendu = { ...base, format };
      const plan = planDeRendu(spec);
      expect({ w: plan.width, h: plan.height }).toEqual({ w: VIDEO_SIZE[format].w, h: VIDEO_SIZE[format].h });
      expect(dimensionsDeRendu(spec)).toEqual({ format, width: VIDEO_SIZE[format].w, height: VIDEO_SIZE[format].h });
      const serveur = await renduServeur(spec);
      expect(versEntreeRemotion(spec)).toStrictEqual(serveur.inputProps);
      expect(plan.durationFrames).toBe(serveur.durationFrames);
      expect(plan.sequences).toEqual(planFromProps(serveur.inputProps as never));
      expect(sequencesResume(plan.sequences)).toEqual({
        ordre: ['intro', 'cards', 'video', 'cta'], durees: [4, 6, 10, 4], total: 24, images30: totalDurationFrames(plan.sequences, 30), transitions: 3,
      });
    });
  }

  it('format absent ou inconnu → 9:16 (repli de calculateMetadata)', () => {
    expect(dimensionsDeRendu({})).toEqual({ format: '9:16', width: 1080, height: 1920 });
    expect(dimensionsDeRendu({ format: 'carré' as never })).toEqual({ format: '9:16', width: 1080, height: 1920 });
  });

  it('spec minimale : défauts 4/6/0/4 et cards [] posés comme aujourd’hui, rien d’autre', async () => {
    const spec: SpecRendu = { title: 'SEUL' };
    const serveur = await renduServeur(spec);
    expect(versEntreeRemotion(spec)).toStrictEqual(serveur.inputProps);
    expect(versEntreeRemotion(spec)).toStrictEqual({
      title: 'SEUL', introDuration: 4, cardsDuration: 6, videoDuration: 0, ctaDuration: 4, cards: [],
    });
    // ctaSubText ABSENT reste absent (Remotion retombe sur « LIEN EN BIO ») ; '' reste ''.
    expect('ctaSubText' in versEntreeRemotion(spec)).toBe(false);
    expect(versEntreeRemotion({ title: 'x', ctaSubText: '' }).ctaSubText).toBe('');
  });

  it('durées explicites à 0 et ordre personnalisé : conservés, comme aujourd’hui', async () => {
    const spec: SpecRendu = { ...base, introDuration: 0, ctaDuration: 0, sequenceOrder: ['video', 'cards'] };
    const serveur = await renduServeur(spec);
    expect(versEntreeRemotion(spec)).toStrictEqual(serveur.inputProps);
    expect(planDeRendu(spec).sequences).toEqual(planFromProps(serveur.inputProps as never));
    expect(planDeRendu(spec).durationFrames).toBe(serveur.durationFrames);
  });

  it('durée vidéo sans rush : aucune séquence Vidéo, comme aujourd’hui', async () => {
    const spec: SpecRendu = { ...base, videoUrl: null, videoDuration: 10 };
    const serveur = await renduServeur(spec);
    expect(planDeRendu(spec).sequences).toEqual(planFromProps(serveur.inputProps as never));
    expect(planDeRendu(spec).sequences.map((s) => s.type)).toEqual(['intro', 'cards', 'cta']);
    expect(planDeRendu(spec).durationFrames).toBe(serveur.durationFrames);
  });

  it('champs Remotion jusque-là non déclarés (couleurs, panneau CTA) passent tels quels', async () => {
    const spec: SpecRendu = { ...base, subtitleColor: '#111111', ctaColor: '#222222', ctaSubColor: '#333333', ctaBackground: 'rgba(0,0,0,0.5)' };
    const serveur = await renduServeur(spec);
    expect(versEntreeRemotion(spec)).toStrictEqual(serveur.inputProps);
  });

  it('pure : l’entrée n’est jamais mutée', () => {
    const spec: SpecRendu = { ...base, cards: undefined };
    const copie = structuredClone(spec);
    versEntreeRemotion(spec);
    planDeRendu(spec);
    expect(spec).toStrictEqual(copie);
  });

  it('documentation : les champs hors spec (facturation / plan) et la correspondance compositeur', () => {
    // Le booléen de filigrane du plan gratuit et le format de facturation ne sont PAS dans la spec.
    expect(CHAMPS_HORS_SPEC).toEqual(expect.arrayContaining(['watermark (booléen compositeur, plan gratuit)', 'format reel/tv (facturation)']));
    const cta = CORRESPONDANCE_COMPOSITEUR.find((c) => c.spec === 'ctaText');
    expect(cta?.compositeur).toContain('watermarkText');
    const nonSupportes = CORRESPONDANCE_COMPOSITEUR.filter((c) => c.spec === null).map((c) => c.compositeur);
    for (const ecart of ['logoUrl', 'siteText', 'rushLut', 'rushAudioRequis', 'sequenceTransitions']) {
      expect(nonSupportes.some((n) => n.includes(ecart)), ecart).toBe(true);
    }
  });
});
