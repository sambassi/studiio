/**
 * AUTOPILOTE MULTI-SOURCES — le moteur (`produireUnMontage`) et le rendu.
 *
 * Verrouille, au niveau de l'ENTRÉE DE RENDU (le design confié à Remotion) :
 *  - configuration SANS clé `sources` : exactement l'entrée d'avant ;
 *  - les combinaisons avatar / rushes / stock rendent un plan multi-sources ;
 *  - l'avatar reste synchronisé (voix continue, `depuis === debut`, aucun raccord) ;
 *  - le stock seul (photos et/ou vidéos) rend ; un média stock mort est lâché ;
 *  - `actives` respectés ; aucun fournisseur stock interrogé ;
 *  - hybride inéligible (photo / avatar), Ken Burns, devis, décision du cron.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, decideRun, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import { etatSourcesServeur, aUneSourceVisuelle, avatarActifConfig, mediasDesSources } from '@/lib/autopilot/sources';
import { raisonNonEligibleHybride } from '@/lib/render/hybride/rendu';
import { transformeKenBurns } from '@/lib/creer/ken-burns';
import { rushSegmentsDepuisMetadata, estUrlImage, type RushSegment } from '@/lib/creer/multi-rush';
import { avatarSynchronise } from '@/lib/autopilot/plan-multi-sources';
import { planFromProps } from '../../remotion/CreerSimpleMontage';

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
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { produireUnMontage, devisMontage } from '@/lib/autopilot/produire';
import { avatarAvecAutresSources } from '@/lib/autopilot/jumeau-async';

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const S = 'https://studiio.pro/storage/v1/object/public/media/u1/';
const R1 = `${S}rush-a.mp4`;
const R2 = `${S}rush-b.mp4`;
const SV1 = `${S}stock-pexels-video-111.mp4`;
const SV2 = `${S}stock-pexels-video-222.mp4`;
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const P2 = 'https://images.unsplash.com/photo-2?w=1080';
const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';

const media = (url: string, type: 'video' | 'photo', provider: 'pexels' | 'unsplash' = 'pexels'): MediaStockRetenu => ({
  url, type, provider, providerAssetId: url.slice(-3), auteur: 'Auteur', sourceUrl: 'https://www.pexels.com/x', licence: 'Pexels', vignetteUrl: '',
});
const sources = (p: Partial<ConfigSources['actives']>, stock: MediaStockRetenu[] = [], gabarit: ConfigSources['gabarit'] = []): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...p }, stock, gabarit,
});
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [R1], voiceEnabled: false, ...p,
});

async function produire(c: AutopilotConfig, jumeauVideoUrl: string | null = null) {
  const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  const rendu = await produireUnMontage({ userId: 'u1', config: c, post, rang: 0, now: T0, jobId: 'job-1', jumeauVideoUrl });
  return { rendu, post, design: lastDesign as Record<string, unknown>, meta: insertions[0]?.metadata as Record<string, unknown> };
}
const montageDe = (d: Record<string, unknown>) => (d.montage ?? []) as RushSegment[];

// La sonde SÛRE des médias stock (`sonde-stock.ts`) passe par `fetch` : un média « mort » répond 404.
// Une URL de REDIRECTIONS répond 302 vers sa cible (jamais suivie par `fetch` ici : `redirect: manual`).
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

describe('configuration SANS clé `sources` : l’entrée de rendu d’avant, à l’identique', () => {
  it('rush unique : exactement `buildAutopilotDesign` d’avant', async () => {
    const c = cfg();
    const { design, post } = await produire(c);
    expect(design).toEqual(buildAutopilotDesign(post, { posterUrl: 'https://cdn.test/affiche.jpg', rushSeconds: 15, voices: {}, config: c }));
    expect(design.montage).toBeUndefined();
  });

  it('avatar seul (jumeau) : exactement l’entrée avatar d’avant, rushes ni sondés ni montés', async () => {
    const c = cfg({ jumeauAvatar: true, rushUrls: [R1, R2] });
    const { design, post, meta } = await produire(c, AV);
    expect(design).toEqual(buildAutopilotDesign(post, {
      posterUrl: 'https://cdn.test/affiche.jpg', rushSeconds: null, voices: {}, config: c, jumeau: { videoUrl: AV, seconds: 20 },
    }));
    expect(rushEncorePresent).not.toHaveBeenCalledWith(R1);
    expect(meta.multiSources).toBeUndefined();
  });

  it('clé `sources` = défauts, banque sans stock : même entrée que sans clé', async () => {
    const sansCle = await produire(cfg());
    insertions = [];
    const avecCle = await produire(cfg({ designStyle: { sources: sources({}) } }));
    expect(avecCle.design).toEqual(sansCle.design);
  });
});

describe('les combinaisons multi-sources rendent', () => {
  it('avatar + rushes : avatar découpé et synchronisé, voix continue, aucun raccord', async () => {
    const c = cfg({ jumeauAvatar: true, rushUrls: [R1, R2], designStyle: { sources: sources({ avatar: true }) } });
    const { design, meta } = await produire(c, AV);
    const plan = montageDe(design);
    expect(plan.some((s) => s.kind === 'avatar')).toBe(true);
    expect(plan.some((s) => s.source === 'rush')).toBe(true);
    expect(avatarSynchronise(plan)).toBe(true);
    expect(design.videoUrl).toBe(AV);
    expect(design.videoDuration).toBe(20);
    expect(plan.at(-1)!.fin).toBe(20);
    expect(design.rushMuted).toBe(true);
    expect(design.sequenceVoiceUrls).toEqual({ video: AV });
    // Surimpression : séquence Vidéo seule, la voix de l'avatar part à 0.
    expect([design.introDuration, design.cardsDuration, design.ctaDuration]).toEqual([0, 0, 0]);
    expect((design.surimpressions as { voix: Record<string, number> }).voix).toEqual({ video: 0 });
    expect(planFromProps(design as never)).toEqual([{ type: 'video', duration: 20 }]);
    // L'avatar n'est jamais proxifié (sa vidéo sert aussi de voix).
    expect(urlRenduPourRush).not.toHaveBeenCalledWith(AV);
    expect(meta.jumeau).toBe(true);
    expect((meta.multiSources as { avatar: boolean }).avatar).toBe(true);
    expect(buildAutopilotVoices).not.toHaveBeenCalled();
  });

  it('avatar + stock (0 rush) : avatar et médias stock, crédits des médias écrits', async () => {
    const c = cfg({ jumeauAvatar: true, rushUrls: [], designStyle: { sources: sources({ avatar: true, stock: true, rushes: false }, [media(SV1, 'video'), media(P1, 'photo')]) } });
    const { design, meta } = await produire(c, AV);
    const plan = montageDe(design);
    expect(plan[0].kind).toBe('avatar');
    expect(plan.map((s) => s.url)).toEqual(expect.arrayContaining([AV, SV1, P1]));
    expect(plan.find((s) => s.url === P1)!.kind).toBe('image');
    expect(avatarSynchronise(plan)).toBe(true);
    expect(urlRenduPourRush).not.toHaveBeenCalledWith(P1);
    expect((meta.stockCredits as Array<{ url: string }>).map((x) => x.url).sort()).toEqual([P1, SV1].sort());
    expect(meta.rushUrls).toEqual([SV1]);
  });

  it('rushes + stock (sans avatar) : le plan SUGGÉRÉ à l’écran — rushes d’abord, stock en complément', async () => {
    // 1 rush personnel + 3 médias stock (SV1, P1, P2) : le rush ouvre, le stock
    // ne remplit que les créneaux que le rush ne couvre pas.
    const c = cfg({ rushUrls: [R1, SV1], designStyle: { sources: sources({ stock: true }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { design } = await produire(c);
    const plan = montageDe(design);
    expect(plan[0]).toMatchObject({ url: R1, source: 'rush' });
    expect(plan.map((s) => (s.source === 'rush' ? 'rush' : 'stock'))).toEqual(['rush', 'stock', 'stock', 'stock']);
    expect(design.videoUrl).toBe(R1);
    expect(design.videoDuration).toBe(plan.at(-1)!.fin);
  });

  it('rushes + avatar + stock : les trois sources dans un même plan', async () => {
    probeRushSeconds.mockImplementation(async (url: string) => (url.includes('/avatar/') ? 40 : url.includes('stock-') ? 8 : 4));
    const c = cfg({ jumeauAvatar: true, rushUrls: [R1, R2, SV1], designStyle: { sources: sources({ avatar: true, stock: true }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { design } = await produire(c, AV);
    const plan = montageDe(design);
    // Le plan suggéré (avatar, rush, rush, stock, avatar) : les deux rushes personnels d’abord,
    // le premier média stock libre (la vidéo) complète le créneau restant.
    expect(plan.map((s) => s.source)).toEqual(['jumeau', 'rush', 'rush', 'stock', 'jumeau']);
    expect(avatarSynchronise(plan)).toBe(true);
    expect(plan.at(-1)!.fin).toBe(40);
  });

  it('stock seul — photos : plans image, `videoUrl` = la première, jamais proxifiées', async () => {
    const c = cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { design } = await produire(c);
    const plan = montageDe(design);
    expect(plan.length).toBe(2);
    expect(plan.every((s) => s.kind === 'image')).toBe(true);
    expect(design.videoUrl).toBe(P1);
    expect(planFromProps(design as never).some((s) => s.type === 'video')).toBe(true);
    expect(urlRenduPourRush).not.toHaveBeenCalled();
    // Sonde SÛRE : HEAD sans suivre les redirections.
    expect(fetchEspion).toHaveBeenCalledWith(P1, expect.objectContaining({ method: 'HEAD', redirect: 'manual' }));
  });

  it('stock seul — vidéos importées (banque) : montées comme vidéos stock', async () => {
    const c = cfg({ rushUrls: [SV1, SV2], designStyle: { sources: sources({ stock: true, rushes: false }) } });
    const { design } = await produire(c);
    const plan = montageDe(design);
    expect(plan.map((s) => s.url)).toEqual([SV1, SV2]);
    expect(plan.every((s) => s.source === 'stock' && s.kind === 'video')).toBe(true);
    expect(design.videoUrl).toBe(SV1);
  });

  it('un média stock introuvable est LÂCHÉ, jamais le montage', async () => {
    MORTS.add(P2);
    const c = cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { design, meta } = await produire(c);
    expect(montageDe(design).map((s) => s.url)).toEqual([P1]);
    expect(meta.stockIgnores).toEqual([P2]);
  });
});

describe('actives respectés', () => {
  it('rushes désactivés : aucun rush personnel monté', async () => {
    const c = cfg({ rushUrls: [R1, SV1], designStyle: { sources: sources({ rushes: false, stock: true }) } });
    const { design } = await produire(c);
    expect(montageDe(design).some((s) => s.url === R1)).toBe(false);
  });

  it('stock désactivé : ni vidéos stock importées, ni médias retenus', async () => {
    const c = cfg({ rushUrls: [R1, SV1], designStyle: { sources: sources({ stock: false }, [media(P1, 'photo')]) } });
    const { design } = await produire(c);
    expect(design.montage).toBeUndefined();
    expect(design.videoUrl).toBe(R1);
    expect(mediasDesSources(c)).toEqual({ rushesPersonnels: [R1], videosStock: [], photosStock: [] });
  });
});

describe('aucun fournisseur stock n’est interrogé par le moteur', () => {
  it('produire (stock seul) : aucun appel réseau à Pexels / Unsplash', async () => {
    const c = cfg({ rushUrls: [SV1], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    await produire(c);
    const appels = fetchEspion.mock.calls.map((a) => String((a as unknown[])[0]));
    expect(appels.filter((u) => /api\.unsplash\.com|api\.pexels\.com/.test(u))).toEqual([]);
  });
});

describe('validation serveur et devis', () => {
  it('décision du cron : le stock seul suffit ; rien du tout → « sans-rush »', () => {
    const now = Date.parse('2026-10-10T08:00:30.000Z');
    const base = { ...DEFAULT_CONFIG, enabled: true, runTimezone: 'UTC', publishTime: '08:00', lastRunAt: null } as AutopilotConfig;
    const stockSeul = { ...base, rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo')]) } };
    const vide = { ...base, rushUrls: [], designStyle: { sources: sources({ stock: true }) } };
    expect(decideRun({ config: vide, credits: 1000, costPerVideo: 10, now })).toEqual({ run: false, reason: 'sans-rush' });
    expect(decideRun({ config: stockSeul, credits: 1000, costPerVideo: 10, now })).not.toEqual({ run: false, reason: 'sans-rush' });
    // Sans clé : la règle d'avant (banque vide → refus, sauf avatar).
    expect(decideRun({ config: { ...base, rushUrls: [] }, credits: 1000, costPerVideo: 10, now })).toEqual({ run: false, reason: 'sans-rush' });
    expect(decideRun({ config: { ...base, rushUrls: [] }, credits: 1000, costPerVideo: 10, now, allowWithoutRush: true })).not.toEqual({ run: false, reason: 'sans-rush' });
    // Rushes désactivés, banque de rushes perso seulement : plus de source.
    const rushesOff = { ...base, rushUrls: [R1], designStyle: { sources: sources({ rushes: false }) } };
    expect(decideRun({ config: rushesOff, credits: 1000, costPerVideo: 10, now })).toEqual({ run: false, reason: 'sans-rush' });
  });

  it('état des sources calculé depuis la configuration (avatar, stock, rushes)', () => {
    const c = { ...cfg({ jumeauAvatar: true, rushUrls: [R1, SV1] }), designStyle: { sources: sources({ avatar: true, stock: true }, [media(P1, 'photo')]) } };
    expect(etatSourcesServeur(c)).toEqual({ rushesPersonnels: 1, avatarActif: true, avatarPret: true, bibliotheque: 0, stockRetenus: 2 });
    expect(aUneSourceVisuelle(etatSourcesServeur({ ...c, rushUrls: [], jumeauAvatar: false, designStyle: { sources: sources({ stock: true }) } }))).toBe(false);
    // `jumeau_avatar` reste la vérité ; `sources` peut seulement l'éteindre.
    expect(avatarActifConfig({ ...c, designStyle: { sources: sources({ avatar: false }) } })).toBe(false);
    expect(avatarActifConfig({ ...c, jumeauAvatar: false })).toBe(false);
    expect(avatarActifConfig({ ...c, designStyle: {} })).toBe(true);
  });

  it('devis : avatar + stock = rendu + avatar (le stock ne coûte rien)', async () => {
    const c = cfg({ jumeauAvatar: true, rushUrls: [], designStyle: { sources: sources({ avatar: true, stock: true }, [media(P1, 'photo'), media(SV1, 'video')]) } });
    expect(await devisMontage(c)).toEqual({ rendu: 10, avatar: 25, affiche: 0, total: 35 });
    // Avatar éteint par `sources` : pas facturé.
    const off = { ...c, designStyle: { sources: sources({ avatar: false, stock: true }, [media(P1, 'photo')]) } };
    expect(await devisMontage(off)).toEqual({ rendu: 10, avatar: 0, affiche: 0, total: 10 });
  });

  it('montage multi-sources : un seul débit, celui du rendu', async () => {
    const c = cfg({ jumeauAvatar: true, rushUrls: [], designStyle: { sources: sources({ avatar: true, stock: true }, [media(P1, 'photo')]) } });
    await produire(c, AV);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledWith('u1', 10, 'render', 'autopilote:job-1');
  });

  it('jumeau : cadrage « remplir » seulement quand l’avatar est monté avec d’autres sources', () => {
    expect(avatarAvecAutresSources(cfg({ jumeauAvatar: true }))).toBe(false);
    expect(avatarAvecAutresSources(cfg({ jumeauAvatar: true, designStyle: { sources: sources({ avatar: true }) } }))).toBe(true);
    expect(avatarAvecAutresSources(cfg({ jumeauAvatar: true, rushUrls: [], designStyle: { sources: sources({ avatar: true }) } }))).toBe(false);
  });
});

describe('rendu : photo, avatar, hybride', () => {
  const surimp = { titre: [0, 2], cartes: [], cta: [8, 10], voix: {} };
  const commun = { title: 'T', surimpressions: surimp, introDuration: 0, cardsDuration: 0, ctaDuration: 0, rushMuted: true, videoDuration: 10 };

  it('hybride ffmpeg inéligible dès qu’une photo ou l’avatar est dans le plan', () => {
    const video: RushSegment[] = [{ url: R1, debut: 0, fin: 5 }, { url: R2, debut: 5, fin: 10 }];
    expect(raisonNonEligibleHybride({ ...commun, montage: video } as never)).toBeNull();
    expect(raisonNonEligibleHybride({ ...commun, montage: [video[0], { url: P1, debut: 5, fin: 10, kind: 'image' }] } as never)).toMatch(/photo/);
    expect(raisonNonEligibleHybride({ ...commun, montage: [{ url: AV, debut: 0, fin: 5, depuis: 0, kind: 'avatar' }, video[1]] } as never)).toMatch(/avatar/);
  });

  it('Ken Burns : zoom avant / arrière, panoramiques, bornés', () => {
    expect(transformeKenBurns('zoomIn', 0)).toMatchObject({ scale: 1, translateXPct: 0 });
    expect(transformeKenBurns('zoomIn', 1)).toMatchObject({ scale: 1.12 });
    expect(transformeKenBurns('zoomOut', 0).scale).toBe(1.12);
    expect(transformeKenBurns('zoomOut', 1).scale).toBe(1);
    expect(transformeKenBurns('panG', 0)).toMatchObject({ scale: 1.12, translateXPct: 4 });
    expect(transformeKenBurns('panG', 1).translateXPct).toBe(-4);
    expect(transformeKenBurns('panD', 0.5).translateXPct).toBe(0);
    expect(transformeKenBurns(undefined, 2).scale).toBe(1.12);
    expect(transformeKenBurns('zoomIn', 0.5).css).toBe('scale(1.06) translateX(0%)');
  });

  it('composition : une photo passe par `PhotoKenBurns`, l’avatar n’est jamais rééchelonné', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(`${process.cwd()}/remotion/CreerSimpleMontage.tsx`, 'utf-8');
    expect(src).toContain("if (seg.kind === 'image') {");
    expect(src).toContain('<PhotoKenBurns src={seg.url} mouvement={seg.mouvement}');
    expect(src).toContain('avecAvatar ? montage.map((m) => ({ ...m })) : ajusterPlan(montage, dureeVideo)');
    expect(src).toContain("k === 0 && seg.kind !== 'avatar' ? 0 :");
  });

  it('images reconnues ; relecture des métadonnées : kind / source / mouvement', () => {
    expect(estUrlImage(P1)).toBe(true);
    expect(estUrlImage(P2)).toBe(true);
    expect(estUrlImage(SV1)).toBe(false);
    const relus = rushSegmentsDepuisMetadata([
      { url: AV, debut: 0, fin: 3, depuis: 0, kind: 'avatar', source: 'jumeau' },
      { url: P1, debut: 3, fin: 5.5, kind: 'image', source: 'photo', mouvement: 'panG' },
      { url: R1, debut: 5.5, fin: 8, depuis: 2, kind: 'video', source: 'rush' },
      { url: R2, debut: 8, fin: 9 },
    ])!;
    expect(relus[0]).toMatchObject({ kind: 'avatar', source: 'jumeau' });
    expect(relus[1]).toMatchObject({ kind: 'image', mouvement: 'panG' });
    // `kind: 'video'` = le défaut : rien n'est écrit (relecture d'avant).
    expect(relus[2].kind).toBeUndefined();
    expect(relus[3]).toEqual({ url: R2, debut: 8, fin: 9 });
  });
});

describe('SSRF — redirections des médias stock, au niveau du moteur', () => {
  const urlsDemandees = () => fetchEspion.mock.calls.map((a) => String((a as unknown[])[0]));

  it('photo autorisée qui redirige vers 169.254.169.254 : lâchée, la cible jamais demandée, absente du rendu', async () => {
    REDIRECTIONS.set(P2, 'http://169.254.169.254/latest/meta-data/');
    const c = cfg({ rushUrls: [], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P1, 'photo'), media(P2, 'photo', 'unsplash')]) } });
    const { design, meta } = await produire(c);
    expect(urlsDemandees().some((u) => u.includes('169.254'))).toBe(false);
    expect(JSON.stringify(design)).not.toContain('169.254');
    expect(JSON.stringify(design)).not.toContain(P2);
    expect(meta.stockIgnores).toEqual([P2]);
    expect(montageDe(design).map((s) => s.url)).toEqual([P1]);
  });

  it('vidéo de notre stockage qui redirige vers un service interne : lâchée, jamais sondée ni rendue', async () => {
    REDIRECTIONS.set(SV1, 'http://studiio-minio:9000/media/u1/x.mp4');
    const c = cfg({ rushUrls: [SV1, SV2], designStyle: { sources: sources({ stock: true, rushes: false }) } });
    const { design } = await produire(c);
    expect(urlsDemandees().some((u) => u.includes('studiio-minio'))).toBe(false);
    expect(probeRushSeconds).not.toHaveBeenCalledWith(expect.stringContaining('studiio-minio'));
    expect(probeRushSeconds).not.toHaveBeenCalledWith(SV1);
    expect(montageDe(design).map((s) => s.url)).toEqual([SV2]);
  });

  it('redirection autorisée → autorisée : le RENDU (et parseMedia, le proxy) ne reçoit que l’URL finale', async () => {
    const FINALE_P = 'https://images.unsplash.com/photo-final?w=1080';
    const FINALE_V = `${S}stock-pexels-video-333.mp4`;
    REDIRECTIONS.set(P2, FINALE_P);
    REDIRECTIONS.set(SV1, FINALE_V);
    const c = cfg({ rushUrls: [SV1], designStyle: { sources: sources({ stock: true, rushes: false }, [media(P2, 'photo', 'unsplash')]) } });
    const { design, meta } = await produire(c);
    const rendu = JSON.stringify(design);
    expect(rendu).toContain(FINALE_P);
    expect(rendu).toContain(FINALE_V);
    expect(rendu).not.toContain(P2);
    expect(rendu).not.toContain(SV1);
    expect(probeRushSeconds).toHaveBeenCalledWith(FINALE_V);
    expect(probeRushSeconds).not.toHaveBeenCalledWith(SV1);
    expect(urlRenduPourRush).toHaveBeenCalledWith(FINALE_V);
    expect(urlRenduPourRush).not.toHaveBeenCalledWith(SV1);
    // Métadonnées : les médias RETENUS (attribution) gardent leur URL d'origine.
    expect((meta.stockCredits as Array<{ url: string }>).map((x) => x.url)).toEqual([P2]);
  });
});
