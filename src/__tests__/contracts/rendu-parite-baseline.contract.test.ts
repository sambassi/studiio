/**
 * A2.1 — BASELINE DE PARITÉ DE RENDU (caractérisation, aucun changement de code).
 *
 * Verrouille, AVANT l'introduction d'un mapper partagé « design du projet →
 * entrée de rendu », ce que chaque chemin produit AUJOURD'HUI (main 59478eb) :
 *
 *   1. AUTOPILOTE : l'entrée de rendu réellement confiée au moteur
 *      (`produireUnMontage` → `renderAndUpload({ design })`, doublé), puis ce
 *      que `renderCreerSimple` en tire (inputProps + durée en images, worker
 *      doublé) et la ligne de temps Remotion (`planFromProps`).
 *   2. CRÉER / CALENDRIER : les options que le compositeur navigateur reçoit
 *      (`preparerOptionsRendu`, chargements doublés) pour un post de la forme
 *      écrite par `AssistantWizard`, et la ligne de temps que le compositeur
 *      en tire (`buildSequences` avec les MÊMES arguments que
 *      `composeVideo`, médias réputés chargés) + `horlogeMontage`.
 *   3. INVARIANTS ENTRE CHEMINS, et les DIFFÉRENCES EXISTANTES, documentées
 *      et figées telles quelles (« DIFFÉRENCE EXISTANTE : … ») — ce fichier
 *      ne corrige rien.
 *
 * Fixtures : A 9:16 simple · B 1:1 · C 16:9 · D plusieurs rushes · E avatar ·
 * F images (photos, Ken Burns) · G CTA sans sous-texte · H CTA avec
 * sous-texte · I logo + texte du site · J musique + voix.
 *
 * Aucun réseau, aucun fournisseur, aucune base : tout ce qui sort du
 * processus est doublé. Le temps est figé, les identifiants sont fixes.
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
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: async () => true }));
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
import { buildAutopilotDesign, AUTOPILOT_WATERMARK } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import { renderCreerSimple } from '@/lib/render/creerSimple';
import { planFromProps } from '../../../remotion/CreerSimpleMontage';
import {
  buildSequences, totalDurationFrames, totalDurationSeconds, VIDEO_SIZE, TRANSITION_SECONDS,
  type PlannedSequence,
} from '@/lib/creer/designSpec';
import { horlogeMontage, DEFAULT_TRANSITION, type ComposerOptions } from '@/lib/video-composer';
import { preparerOptionsRendu, montageSize, type DepsPreparation } from '@/lib/rendus/options-depuis-metadata';
import { metadataFormat } from '@/lib/format/projet';
import type { RushSegment } from '@/lib/creer/multi-rush';

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
  return { post, design: lastDesign as unknown as Record<string, unknown>, meta: (row.metadata ?? {}) as unknown as Record<string, unknown>, row };
}

/** Ce que le serveur (`renderCreerSimple`) tire de l'entrée : props + images. */
async function renduServeur(design: Record<string, unknown>) {
  lastInputProps = null;
  const r = await renderCreerSimple({ jobId: 'job-1', userId: 'u1', design: design as never });
  return { inputProps: lastInputProps as unknown as Record<string, unknown>, durationFrames: r.durationFrames };
}

/**
 * Ligne de temps du COMPOSITEUR navigateur pour ces options — mêmes arguments
 * que `composeVideo` (video-composer.ts ~l. 4099), médias réputés chargés.
 */
function timelineCompositeur(o: ComposerOptions): PlannedSequence[] {
  const videoRequested = !!o.videoUrl;
  return buildSequences({
    introDuration: o.introDuration ?? 0,
    cardsDuration: o.cardsDuration ?? 0,
    videoDuration: o.videoDuration ?? 0,
    ctaDuration: o.ctaDuration ?? 0,
    cardCount: (o.cards ?? []).length,
    hasVideoBackground: videoRequested,
    videoRequested,
    sequenceOrder: o.sequenceOrder ?? null,
  });
}

const deps: DepsPreparation = {
  preRenderCardIcons: async (c) => c,
  chargerLutPourRendu: async () => null,
  rasteriserElements: async () => undefined,
  chargerImage: async () => null,
};

/** Résumé fonctionnel d'une entrée de rendu Autopilote (aucune date, aucun id). */
function resumeAuto(design: Record<string, unknown>) {
  const d = design as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const plan = (d.montage ?? null) as RushSegment[] | null;
  return {
    format: d.format,
    taille: VIDEO_SIZE[d.format as keyof typeof VIDEO_SIZE],
    titre: d.title,
    sousTitre: d.subtitle,
    cartes: d.cards,
    cta: { principal: d.ctaText, sous: d.ctaSubText ?? null, copies: d.ctaCopies ?? null },
    durees: { intro: d.introDuration, cards: d.cardsDuration, video: d.videoDuration, cta: d.ctaDuration },
    ordre: d.sequenceOrder ?? null,
    transition: d.transition,
    animation: d.textAnimation,
    medias: {
      videoUrl: d.videoUrl ?? null,
      posterUrl: d.posterUrl ?? null,
      posterOnAllSequences: d.posterOnAllSequences,
      rushs: d.rushs ?? null,
      plan: plan ? plan.map((s) => ({ kind: s.kind ?? 'video', source: (s as { source?: string }).source ?? null, url: s.url, debut: s.debut, fin: s.fin, depuis: s.depuis ?? null, mouvement: (s as { mouvement?: string }).mouvement ?? null })) : null,
      surimpressions: d.surimpressions ? Object.keys(d.surimpressions).sort() : null,
    },
    audio: {
      musicUrl: d.musicUrl ?? null,
      musicVolume: d.musicVolume, voiceVolume: d.voiceVolume, rushVolume: d.rushVolume, rushMuted: d.rushMuted,
      sequenceVoiceUrls: d.sequenceVoiceUrls ?? null,
      voiceUrl: d.voiceUrl ?? null,
    },
    marque: {
      watermark: d.watermark, logo: d.logoUrl ?? null,
      gradientStart: d.gradientStart, gradientEnd: d.gradientEnd, gradientOpacity: d.gradientOpacity ?? null,
      titleColor: d.titleColor,
    },
    typo: Object.fromEntries(Object.entries(d).filter(([k]) => /^(title|subtitle|cta)(Font|Scale|Bold|Italic|LetterSpacing|LineHeight|Case|Align|Underline|Strike|Pos|Width)$/.test(k) || k === 'cardStyle' || k === 'cardsTypography').sort()),
    clesEntree: Object.keys(d).sort(),
  };
}

/** Résumé fonctionnel des options du compositeur navigateur. */
function resumeOptions(o: ComposerOptions) {
  const d = (o.design ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const oo = o as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    taille: { w: o.width, h: o.height },
    titre: o.title,
    sousTitre: o.subtitle ?? null,
    cartes: o.cards,
    cta: {
      // drawCTA lit `design.ctaMainText || watermarkText` (gros), `ctaSubTextDesign` (petit).
      principalEffectif: d.ctaMainText || o.watermarkText || null,
      sousEffectif: typeof d.ctaSubTextDesign === 'string' ? d.ctaSubTextDesign : (o.ctaSubText ?? null),
      ctaText: o.ctaText, ctaSubText: o.ctaSubText, watermarkText: o.watermarkText ?? null,
      copies: d.ctaCopies ?? null,
    },
    durees: { intro: o.introDuration, cards: o.cardsDuration, video: o.videoDuration, cta: o.ctaDuration },
    ordre: o.sequenceOrder ?? null,
    transition: oo.transition ?? null,
    animation: d.textAnimation ?? null,
    medias: { videoUrl: o.videoUrl ?? null, posterUrl: o.posterUrl ?? null, rushs: oo.rushs ?? null, montage: oo.montage ?? null },
    audio: {
      musicUrl: o.musicUrl ?? null, voiceUrl: o.voiceUrl ?? null, sequenceVoiceUrls: o.sequenceVoiceUrls ?? null,
      musicVolume: oo.musicVolume ?? null, voiceVolume: oo.voiceVolume ?? null, rushAudioRequis: oo.rushAudioRequis ?? null,
    },
    marque: { logoUrl: o.logoUrl ?? null, siteText: oo.siteText ?? null, accentColor: oo.accentColor, gradientColor1: d.gradientColor1 ?? null, gradientColor2: d.gradientColor2 ?? null, titleColor: d.titleColor ?? null, titleAlign: d.titleAlign ?? null },
  };
}

const sequencesResume = (s: PlannedSequence[]) => ({
  ordre: s.map((x) => x.type),
  durees: s.map((x) => x.duration),
  total: totalDurationSeconds(s),
  images30: totalDurationFrames(s, 30),
  transitions: Math.max(0, s.length - 1),
});

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

// ═════════════════════════════════════════════════════════════════════════
// 1. AUTOPILOTE — l'entrée de rendu d'aujourd'hui
// ═════════════════════════════════════════════════════════════════════════
describe('1. AUTOPILOTE — entrée de rendu figée (produireUnMontage → renderAndUpload)', () => {
  for (const [nom, fx] of Object.entries(AUTO)) {
    it(`${nom} : entrée de rendu, props serveur, ligne de temps`, async () => {
      const { design } = await produireAuto(fx);
      const serveur = await renduServeur(design);
      const timeline = planFromProps(serveur.inputProps as never);
      expect(resumeAuto(design)).toMatchSnapshot('entree');
      expect({
        timeline: sequencesResume(timeline),
        durationFrames: serveur.durationFrames,
        // Défauts posés par renderCreerSimple sur les durées absentes.
        durees: [serveur.inputProps.introDuration, serveur.inputProps.cardsDuration, serveur.inputProps.videoDuration, serveur.inputProps.ctaDuration],
      }).toMatchSnapshot('serveur');
      // Une seule règle de durée : `renderCreerSimple` == `planFromProps`.
      expect(serveur.durationFrames).toBe(totalDurationFrames(timeline, 30));
      // Constantes du chemin, explicites.
      expect(design.format).toBe('9:16');
      expect(design.transition).toBe(DEFAULT_TRANSITION);
      expect(design.watermark).toBe(AUTOPILOT_WATERMARK);
    });
  }

  it('A : l’entrée est EXACTEMENT buildAutopilotDesign (aucun plan, aucune surimpression)', async () => {
    const { design, post } = await produireAuto(AUTO['A-916-simple']);
    expect(design).toEqual(buildAutopilotDesign(post, {
      posterUrl: 'https://cdn.test/affiche.jpg', rushSeconds: 15, voices: {}, config: AUTO['A-916-simple'].cfg,
    }));
    expect(design.montage).toBeUndefined();
    expect(design.surimpressions).toBeUndefined();
    expect(planFromProps(design as never)).toEqual([
      { type: 'intro', duration: 4 }, { type: 'cards', duration: 6 }, { type: 'video', duration: 10 }, { type: 'cta', duration: 4 },
    ]);
  });

  it('G / H : CTA du brief → sous-texte ; sans brief, aucune clé ctaSubText', async () => {
    const g = (await produireAuto(AUTO['G-cta-sans-sous-texte'])).design;
    const h = (await produireAuto(AUTO['H-cta-avec-sous-texte'])).design;
    expect('ctaSubText' in g).toBe(false);
    expect(h.ctaSubText).toBe('Réserve ta séance');
    expect(h.ctaText).toBe(g.ctaText);
  });

  it('J : musique, voix par séquence et mixeur transmis ; durées calées sur la voix', async () => {
    const { design } = await produireAuto(AUTO['J-musique-voix']);
    expect(design.musicUrl).toBe(MUSIQUE);
    expect(design.sequenceVoiceUrls).toEqual({
      titre: VOIX.titre.url, cartes: VOIX.cartes.url, video: VOIX.video.url, cta: VOIX.cta.url,
    });
    expect([design.musicVolume, design.voiceVolume, design.rushVolume, design.rushMuted]).toEqual([0.35, 0.9, 0.6, true]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. CRÉER / CALENDRIER — ce que reçoit le compositeur navigateur
// ═════════════════════════════════════════════════════════════════════════

/**
 * Metadata dans la FORME écrite par `AssistantWizard` à la création
 * (AssistantWizard.tsx, bloc `const metadata = { … }`), réduite aux champs
 * que relit `optionsRenduDepuisMetadata`.
 */
interface FixtureCreer {
  format: '9:16' | '1:1' | '16:9';
  rushs?: string[];
  segments?: RushSegment[];
  durees?: { intro: number; cards: number; video: number; cta: number };
  ctaSub?: string;
  logoUrl?: string;
  siteText?: { enabled: boolean; text: string };
  musique?: boolean;
}
const CARTES_CREER = [
  { emoji: 'Sun', label: 'Lever tôt', value: '6h', description: 'Se lever à heure fixe', color: '#7C3AED' },
  { emoji: 'Droplet', label: 'Hydratation', value: '500 ml', description: 'Un grand verre d’eau', color: '#7C3AED' },
];
function metadataCreer(fx: FixtureCreer): Record<string, unknown> {
  const d = { intro: 4, cards: 6, video: fx.rushs?.length || fx.segments?.length ? 10 : 0, cta: 4, ...fx.durees };
  const ordre = ['intro', 'cards', ...(d.video > 0 ? ['video'] : []), 'cta'];
  return {
    type: 'infographic',
    source: 'assistant-simple',
    subtitle: 'Trois gestes simples',
    theme: 'sante',
    cards: CARTES_CREER,
    hasAudio: !!fx.musique || !!fx.rushs?.length,
    ...(fx.musique ? {
      musicUrl: MUSIQUE,
      sequenceVoiceUrls: { titre: VOIX.titre.url, cartes: VOIX.cartes.url, cta: VOIX.cta.url },
      musicVolume: 0.35,
      voiceVolume: 0.9,
    } : {}),
    posterUrl: 'https://cdn.test/affiche.jpg',
    ...(fx.rushs?.length ? { rushUrls: fx.rushs } : {}),
    ...(fx.segments ? { rushSegments: fx.segments } : {}),
    ...(fx.logoUrl ? { logoUrl: fx.logoUrl } : {}),
    renderedVideoUrl: 'https://cdn.test/montage.webm',
    thumbnailUrl: 'https://cdn.test/vignette.jpg',
    composerVersion: 'fixe',
    ...metadataFormat(fx.format),
    sequences: { ...d, total: ordre.reduce((t, k) => t + (d as Record<string, number>)[k], 0), order: ordre },
    branding: {
      accentColor: '#7C3AED', ctaText: 'Réserve ta séance', ctaSubText: fx.ctaSub ?? '',
      watermarkText: 'Réserve ta séance', borderEnabled: false, borderColor: null,
    },
    design: {
      textAnimation: 'none',
      cardStyle: 'compact',
      transition: 'crossfade',
      cardsTextStyle: {},
      font: 'Inter',
      titleAlign: 'left',
      ctaMainText: 'Réserve ta séance',
      ctaSubText: fx.ctaSub ?? '',
      gradientColor1: '#7C3AED',
      gradientColor2: '#EC4899',
      gradientOpacity: 0.3,
      noColorSequences: [],
      siteText: fx.siteText ?? { enabled: true, text: 'Studiio.pro' },
      positions: { title: { x: 8, y: 8 }, watermark: { x: 50, y: 92 }, elements: [] },
      sizes: { title: 84, watermark: 70 },
    },
  };
}
const SEG_RUSHES: RushSegment[] = [
  { url: R1, debut: 0, fin: 5 } as RushSegment,
  { url: R2, debut: 5, fin: 10 } as RushSegment,
];
const SEG_AVATAR: RushSegment[] = [
  { url: AV, debut: 0, fin: 6, depuis: 0, kind: 'avatar' } as RushSegment,
  { url: R1, debut: 6, fin: 9, depuis: 0, kind: 'video' } as RushSegment,
  { url: AV, debut: 9, fin: 12, depuis: 9, kind: 'avatar' } as RushSegment,
];
const SEG_PHOTOS: RushSegment[] = [
  { url: P1, debut: 0, fin: 2.5, kind: 'image', mouvement: 'zoomIn' } as unknown as RushSegment,
  { url: P2, debut: 2.5, fin: 5, kind: 'image', mouvement: 'panG' } as unknown as RushSegment,
];
const CREER: Record<string, FixtureCreer> = {
  'A-916-simple': { format: '9:16', rushs: [R1] },
  'B-carre-1-1': { format: '1:1', rushs: [R1] },
  'C-paysage-16-9': { format: '16:9', rushs: [R1] },
  'D-rushes-multiples': { format: '9:16', rushs: [R1, R2], segments: SEG_RUSHES },
  'E-avatar': { format: '9:16', rushs: [AV, R1], segments: SEG_AVATAR, durees: { intro: 4, cards: 6, video: 12, cta: 4 } },
  'F-images-ken-burns': { format: '9:16', segments: SEG_PHOTOS, durees: { intro: 4, cards: 6, video: 5, cta: 4 } },
  'G-cta-sans-sous-texte': { format: '9:16', ctaSub: '' },
  'H-cta-avec-sous-texte': { format: '9:16', ctaSub: 'Lien en bio' },
  'I-logo-texte-site': { format: '9:16', logoUrl: 'https://cdn.test/logo.png', siteText: { enabled: true, text: 'monsite.fr' } },
  'J-musique-voix': { format: '9:16', rushs: [R1], musique: true },
};
const postCreer = (fx: FixtureCreer) => ({
  title: 'ROUTINE DU MATIN',
  format: fx.format === '16:9' ? 'tv' : fx.format === '1:1' ? 'tv' : 'reel',
  metadata: metadataCreer(fx),
});

describe('2. CRÉER / CALENDRIER — options du compositeur figées (preparerOptionsRendu)', () => {
  for (const [nom, fx] of Object.entries(CREER)) {
    it(`${nom} : options « regenerer » et « planifier », ligne de temps du compositeur`, async () => {
      const post = postCreer(fx);
      const regen = await preparerOptionsRendu(post, 'regenerer', undefined, deps);
      const planif = await preparerOptionsRendu(post, 'planifier', undefined, deps);
      const tl = timelineCompositeur(regen);
      expect(resumeOptions(regen)).toMatchSnapshot('regenerer');
      expect(resumeOptions(planif)).toMatchSnapshot('planifier');
      expect(sequencesResume(tl)).toMatchSnapshot('timeline');
      expect(sequencesResume(timelineCompositeur(planif))).toEqual(sequencesResume(tl));
      // Dimensions = format du projet (C-FORMAT).
      const attendu = VIDEO_SIZE[fx.format];
      expect({ w: regen.width, h: regen.height }).toEqual({ w: attendu.w, h: attendu.h });
      expect(montageSize(post.metadata.videoSize as never, post.format, post.metadata.videoFormat)).toEqual({ width: attendu.w, height: attendu.h });
      // Horloge de fin : la dernière image reste DANS la dernière séquence.
      const total = totalDurationSeconds(tl);
      expect(horlogeMontage(total + 1, total)).toEqual({ t: total - 0.001, fini: true });
    });
  }

  it('D / E / F : le plan multi-rush / multi-sources part tel quel au compositeur', async () => {
    const d = await preparerOptionsRendu(postCreer(CREER['D-rushes-multiples']), 'regenerer', undefined, deps);
    const e = await preparerOptionsRendu(postCreer(CREER['E-avatar']), 'regenerer', undefined, deps);
    const f = await preparerOptionsRendu(postCreer(CREER['F-images-ken-burns']), 'regenerer', undefined, deps);
    expect((d as unknown as Record<string, unknown>).rushs).toEqual([{ url: R1, secondes: null }, { url: R2, secondes: null }].map((r) => expect.objectContaining({ url: r.url })));
    expect((e as unknown as Record<string, unknown>).rushAudioRequis).toBe(true);
    expect(f.videoUrl).toBe(P1);
    expect(f.videoDuration).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. INVARIANTS ENTRE CHEMINS — et différences existantes, figées
// ═════════════════════════════════════════════════════════════════════════
/**
 * Pour UN projet Autopilote, deux moteurs le rendent : le serveur (entrée
 * `design`) et — sur « Régénérer » / « Planifier » / « Publier » — le
 * compositeur navigateur, à partir de la metadata écrite par l'Autopilote.
 */
async function deuxChemins(nom: string) {
  const r = await produireAuto(AUTO[nom]);
  const serveur = await renduServeur(r.design);
  const tlServeur = planFromProps(serveur.inputProps as never);
  const post = { title: r.row.title as string, format: r.row.format as string, metadata: r.meta };
  const regen = await preparerOptionsRendu(post, 'regenerer', undefined, deps);
  const planif = await preparerOptionsRendu(post, 'planifier', undefined, deps);
  return { ...r, serveur, tlServeur, regen, planif, tlRegen: timelineCompositeur(regen), tlPlanif: timelineCompositeur(planif) };
}

describe('3. Invariants Autopilote ↔ Calendrier (même projet)', () => {
  for (const nom of ['A-916-simple', 'G-cta-sans-sous-texte', 'H-cta-avec-sous-texte', 'J-musique-voix']) {
    it(`${nom} : même ordre / nombre / durées / total / transition / textes / format`, async () => {
      const c = await deuxChemins(nom);
      // Séquences, durées, total, nombre de transitions.
      expect(sequencesResume(c.tlPlanif)).toEqual(sequencesResume(c.tlServeur));
      // Format : 9:16 des deux côtés.
      expect({ w: c.regen.width, h: c.regen.height }).toEqual({ w: VIDEO_SIZE['9:16'].w, h: VIDEO_SIZE['9:16'].h });
      // Transition et animation.
      expect((c.regen as unknown as Record<string, unknown>).transition).toBe(c.design.transition);
      expect((c.regen.design as unknown as Record<string, unknown>).textAnimation).toBe(c.design.textAnimation);
      // Textes.
      expect(c.regen.title).toBe(c.design.title);
      expect(c.regen.subtitle).toBe(c.design.subtitle);
      expect((c.regen.cards ?? []).length).toBe(((c.design.cards as unknown[]) ?? []).length);
      // CTA principal effectif et sous-texte effectif.
      const d = c.regen.design as unknown as Record<string, unknown>;
      expect(d.ctaMainText).toBe(c.design.ctaText);
      expect(d.ctaSubTextDesign).toBe((c.design.ctaSubText as string | undefined) ?? '');
      // Médias.
      expect(c.regen.videoUrl).toBe(c.design.videoUrl);
      expect(c.regen.posterUrl).toBe(c.design.posterUrl);
      expect(c.regen.musicUrl ?? null).toBe((c.design.musicUrl as string | null | undefined) ?? null);
      // Transition : durée de fondu unique.
      expect(TRANSITION_SECONDS).toBe(0.8);
    });
  }

  it('INVARIANT (A) : « Régénérer » (durées bornées) donne la même ligne de temps que le serveur', async () => {
    const c = await deuxChemins('A-916-simple');
    expect(sequencesResume(c.tlRegen)).toEqual(sequencesResume(c.tlServeur));
  });

  it('DIFFÉRENCE EXISTANTE (J) : volumes du mixeur — le serveur les lit à plat, le Calendrier ne les retrouve PAS', async () => {
    const c = await deuxChemins('J-musique-voix');
    // L'Autopilote écrit les niveaux sous `design.audio*Volume` ; le Calendrier
    // ne relit que `meta.musicVolume` / `meta.voiceVolume` (à plat) → défauts.
    expect([c.design.musicVolume, c.design.voiceVolume]).toEqual([0.35, 0.9]);
    expect([(c.regen as unknown as Record<string, unknown>).musicVolume, (c.regen as unknown as Record<string, unknown>).voiceVolume]).toMatchSnapshot('volumes-calendrier');
    // Son du rush coupé côté serveur (`rushMuted`) : aucune option équivalente côté compositeur.
    expect(c.design.rushMuted).toBe(true);
    expect('rushMuted' in (c.regen as unknown as Record<string, unknown>)).toBe(false);
    // Voix par séquence : relues ?
    expect(c.regen.sequenceVoiceUrls ?? null).toMatchSnapshot('voix-calendrier');
  });

  it('DIFFÉRENCES EXISTANTES (D / E / F) : plans multi-rush / avatar / photos', async () => {
    const out: Record<string, unknown> = {};
    for (const nom of ['D-rushes-multiples', 'E-avatar', 'F-images-ken-burns']) {
      const c = await deuxChemins(nom);
      out[nom] = {
        serveur: sequencesResume(c.tlServeur),
        regenerer: sequencesResume(c.tlRegen),
        planifier: sequencesResume(c.tlPlanif),
        planServeur: !!c.design.montage,
        planCalendrier: !!(c.regen as unknown as Record<string, unknown>).montage,
        surimpressionsServeur: !!c.design.surimpressions,
        videoServeur: c.design.videoUrl ?? null,
        videoCalendrier: c.regen.videoUrl ?? null,
        rushMutedServeur: c.design.rushMuted,
        rushAudioRequisCalendrier: (c.regen as unknown as Record<string, unknown>).rushAudioRequis ?? null,
      };
    }
    expect(out).toMatchSnapshot('multi-sources');
  });

  it('DIFFÉRENCE EXISTANTE (E) : avatar seul — le Calendrier perd la séquence Vidéo (34,8 s → 14 s)', async () => {
    const c = await deuxChemins('E-avatar');
    expect(c.design.videoUrl).toBe(AV);
    // A3 : 34 → 34,8 — la séquence du jumeau porte le fondu de sortie (sans durée cible).
    expect(sequencesResume(c.tlServeur).total).toBe(34.8);
    // `rushUrls: []` pour le jumeau : aucune source relue → pas de séquence Vidéo.
    expect(c.meta.rushUrls).toEqual([]);
    expect(c.regen.videoUrl ?? null).toBeNull();
    expect(sequencesResume(c.tlRegen)).toEqual({ ordre: ['intro', 'cards', 'cta'], durees: [4, 6, 4], total: 14, images30: 420, transitions: 2 });
  });

  it('DIFFÉRENCE EXISTANTE (D / F) : surimpressions (titre/cartes/CTA sur la vidéo) non relues par le Calendrier', async () => {
    for (const nom of ['D-rushes-multiples', 'F-images-ken-burns']) {
      const c = await deuxChemins(nom);
      expect(c.design.surimpressions, nom).toBeTruthy();
      expect([c.design.introDuration, c.design.cardsDuration, c.design.ctaDuration], nom).toEqual([0, 0, 0]);
      // Même ligne de temps (vidéo seule), mais AUCUN texte peint côté Calendrier.
      expect(sequencesResume(c.tlRegen), nom).toEqual(sequencesResume(c.tlServeur));
      expect('surimpressions' in (c.regen as unknown as Record<string, unknown>), nom).toBe(false);
      // Son du rush : coupé côté serveur, aucune coupure transmise côté Calendrier.
      expect(c.design.rushMuted, nom).toBe(true);
    }
  });

  it('DIFFÉRENCE EXISTANTE (B / C) : l’Autopilote ne rend QUE du 9:16 ; Créer rend 1:1 et 16:9', async () => {
    const a = await produireAuto(AUTO['A-916-simple']);
    expect(a.design.format).toBe('9:16');
    expect(a.meta.videoFormat).toBe('9:16');
    const b = await preparerOptionsRendu(postCreer(CREER['B-carre-1-1']), 'regenerer', undefined, deps);
    const cc = await preparerOptionsRendu(postCreer(CREER['C-paysage-16-9']), 'regenerer', undefined, deps);
    expect([b.width, b.height, cc.width, cc.height]).toEqual([1080, 1080, 1920, 1080]);
  });

  it('DIFFÉRENCE EXISTANTE (I) : l’Autopilote n’a ni logo ni texte de site réglable ; Créer/Calendrier les relit', async () => {
    const a = await produireAuto(AUTO['A-916-simple']);
    expect('logoUrl' in a.design).toBe(false);
    expect(a.design.watermark).toBe('Studiio.pro');
    expect((a.meta.design as unknown as Record<string, unknown>).siteText).toEqual({ enabled: true, text: 'Studiio.pro' });
    const i = await preparerOptionsRendu(postCreer(CREER['I-logo-texte-site']), 'regenerer', undefined, deps);
    expect(i.logoUrl).toBe('https://cdn.test/logo.png');
    expect((i as unknown as Record<string, unknown>).siteText).toEqual({ enabled: true, text: 'monsite.fr' });
  });

  it('DIFFÉRENCE EXISTANTE (titre/CTA) : position et alignement — serveur sans clé, Calendrier ancré à gauche', async () => {
    const c = await deuxChemins('A-916-simple');
    const d = c.regen.design as unknown as Record<string, unknown>;
    expect({
      serveur: { titlePos: c.design.titlePos ?? null, titleAlign: c.design.titleAlign ?? null, ctaPos: c.design.ctaPos ?? null },
      calendrier: { titlePosition: d.titlePosition ?? null, titleAlign: d.titleAlign ?? null, watermarkPosition: d.watermarkPosition ?? null },
      accent: { serveur: c.design.gradientStart, calendrier: (c.regen as unknown as Record<string, unknown>).accentColor },
      ctaText: { calendrierCtaText: c.regen.ctaText, calendrierCtaSubText: c.regen.ctaSubText, watermarkText: c.regen.watermarkText ?? null },
    }).toMatchSnapshot('textes-positions');
  });
});
