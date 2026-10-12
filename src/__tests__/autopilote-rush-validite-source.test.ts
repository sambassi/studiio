/**
 * SOURCE DISPONIBLE = média RÉELLEMENT lisible et utilisable pour le montage.
 *
 * Un rush expiré (signature, refus du stockage : 400/401/403), introuvable
 * (404/410, supprimé), ou refusé par la garde de sécurité (#546, objet d'un
 * autre compte) ne compte JAMAIS comme source : il n'entre pas dans le plan,
 * ne part jamais au rendu, et ne bloque pas le repli sur les autres sources
 * (rush valide suivant, stock, avatar).
 *
 * Moteur RÉEL (`produireUnMontage`, `rushEncorePresent`, `mediaLisiblePar`) ;
 * seule la sonde HTTP (`sonderSur`) est doublée — par statut, par URL. Aucun
 * fournisseur, aucun réseau, aucun rendu réel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import type { RushSegment } from '@/lib/creer/multi-rush';
import {
  etatDepuisStatut, etatsDepuisReponseVerifier, rushesUtilisables,
} from '@/lib/autopilot/validite-rush';

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
const analyserRushServeurCache = vi.fn(async (..._a: unknown[]) => null);
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

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const PUB = 'https://studiio.pro/storage/v1/object/public';
const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const AUTRE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const R1 = `${PUB}/media/${U}/library/rush-a.mp4`;
const R2 = `${PUB}/media/${U}/library/rush-b.mp4`;
const R3 = `${PUB}/media/${U}/library/rush-c.mp4`;
const R_AUTRE = `${PUB}/media/${AUTRE}/library/rush-prive.mp4`;
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const AV = `${PUB}/videos/${U}/avatar/gen-1.mp4`;

const photo = (url: string): MediaStockRetenu => ({
  url, type: 'photo', provider: 'pexels', providerAssetId: '1', auteur: 'Auteur', sourceUrl: 'https://www.pexels.com/x', licence: 'Pexels', vignetteUrl: '',
});
const sources = (p: Partial<ConfigSources['actives']>, stock: MediaStockRetenu[] = []): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...p }, stock, gabarit: [],
});
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

describe('La règle (pure)', () => {
  it('statut → état : 404/410 introuvable, 400/401/403 expiré, le reste utilisable (doute)', () => {
    expect([404, 410].map(etatDepuisStatut)).toEqual(['introuvable', 'introuvable']);
    expect([400, 401, 403].map(etatDepuisStatut)).toEqual(['expire', 'expire', 'expire']);
    expect([200, 206, 302, 405, 500, 503].map(etatDepuisStatut).every((e) => e === 'utilisable')).toBe(true);
  });
});

describe('#547 — la sonde HEAD lit le relais avec un jeton, au nom du compte', () => {
  it('rush du compte : sondé avec ?sr= ; rendu et métadonnées reçoivent l URL NUE', async () => {
    const { design } = await produire(cfg({ rushUrls: [R1] }));
    const sondees = sonderSur.mock.calls.map((c) => c[0] as string);
    expect(sondees.some((u) => u.startsWith(`${R1}?sr=`))).toBe(true);
    expect(design.videoUrl).toBe(R1);
    expect(entreeRendu()).not.toContain('?sr=');
    expect(JSON.stringify(insertions)).not.toContain('?sr=');
  });
});

describe('A — 1 rush valide', () => {
  it('compté 1, envoyé au rendu', async () => {
    const { design, meta, onRushMort } = await produire(cfg({ rushUrls: [R1] }));
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(design.videoUrl).toBe(R1);
    expect(meta.rushIgnore).toBeUndefined();
    expect(onRushMort).not.toHaveBeenCalled();
  });
});

describe('B — 1 rush expiré', () => {
  it('403 (signature expirée) : compté 0, JAMAIS envoyé au rendu, jamais retiré de la banque', async () => {
    STATUTS.set(R1, 403);
    const { design, meta, onRushMort, rendu } = await produire(cfg({ rushUrls: [R1] }));
    expect(renderAndUpload).toHaveBeenCalledTimes(1); // montage titre/cartes/CTA, valide
    expect(entreeRendu()).not.toContain(R1);
    expect(design.videoUrl ?? null).toBeNull();
    expect(rendu.rushUrl).toBeNull();
    expect(urlRenduPourRush).not.toHaveBeenCalled();
    expect(analyserRushServeurCache).not.toHaveBeenCalled();
    expect(meta.rushIgnore).toBe(true);
    // Un 403 peut être passager : la banque n'est pas modifiée.
    expect(onRushMort).not.toHaveBeenCalled();
    expect(ecrituresInterdites).not.toHaveBeenCalled();
  });

  it('404 (supprimé) : compté 0, jamais rendu ; signalé mort comme avant', async () => {
    STATUTS.set(R1, 404);
    const { onRushMort, meta } = await produire(cfg({ rushUrls: [R1] }));
    expect(entreeRendu()).not.toContain(R1);
    expect(onRushMort).toHaveBeenCalledWith(R1);
    expect(meta.rushIgnore).toBe(true);
  });
});

describe('C — 1 rush expiré + 1 valide', () => {
  it('A expiré (403) + B valide : B gardé, A jamais rendu', async () => {
    STATUTS.set(R1, 403);
    const { design, rendu } = await produire(cfg({ rushUrls: [R1, R2] }), { rushDuPost: R1 });
    expect(rendu.rushUrl).toBe(R2);
    expect(entreeRendu()).toContain(R2);
    expect(entreeRendu()).not.toContain(R1);
    expect(JSON.stringify(design)).not.toContain('rush-a.mp4');
  });

  it('A supprimé (404) + B valide : B gardé (avant : montage SANS vidéo)', async () => {
    STATUTS.set(R1, 404);
    const { rendu, onRushMort } = await produire(cfg({ rushUrls: [R1, R2] }), { rushDuPost: R1 });
    expect(rendu.rushUrl).toBe(R2);
    expect(entreeRendu()).not.toContain(R1);
    expect(onRushMort).toHaveBeenCalledWith(R1);
  });

  it('3 rushes dont 1 expiré : le plan réunit les 2 valides seulement', async () => {
    STATUTS.set(R2, 403);
    const { design } = await produire(cfg({ rushUrls: [R1, R2, R3] }), { rushDuPost: R1 });
    const urls = new Set(montage(design).map((s) => s.url));
    expect(urls.has(R2)).toBe(false);
    expect([...urls].sort()).toEqual([R1, R3].sort());
    expect(entreeRendu()).not.toContain(R2);
  });
});

describe('D — tous expirés, stock autorisé', () => {
  it('repli sur le stock : le montage se fait, aucun rush mort au rendu', async () => {
    STATUTS.set(R1, 403);
    STATUTS.set(R2, 404);
    const c = cfg({ rushUrls: [R1, R2], designStyle: { sources: sources({ stock: true }, [photo(P1)]) } });
    const { design } = await produire(c, { rushDuPost: R1 });
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    const plan = montage(design);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((s) => s.url === P1)).toBe(true);
    expect(entreeRendu()).not.toContain(R1);
    expect(entreeRendu()).not.toContain(R2);
  });
});

describe('E — tous expirés, avatar autorisé', () => {
  it('repli sur l avatar : plan avatar seul, aucun rush mort au rendu', async () => {
    STATUTS.set(R1, 403);
    STATUTS.set(R2, 410);
    const c = cfg({ jumeauAvatar: true, rushUrls: [R1, R2], designStyle: { sources: sources({ avatar: true }) } });
    const { design } = await produire(c, { rushDuPost: R1, jumeau: AV });
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    const plan = montage(design);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((s) => s.kind === 'avatar')).toBe(true);
    expect(design.videoUrl).toBe(AV);
    expect(entreeRendu()).not.toContain(R1);
    expect(entreeRendu()).not.toContain(R2);
  });
});

describe('F — rush d un AUTRE compte (refus de sécurité #546)', () => {
  it('jamais sondé, lu, signé ni rendu ; ni retiré ni « réparable » ; aucune fuite', async () => {
    const { design, meta, onRushMort, rendu } = await produire(cfg({ rushUrls: [R_AUTRE, R1] }), { rushDuPost: R_AUTRE });
    // Le montage continue avec le rush du compte.
    expect(rendu.rushUrl).toBe(R1);
    // Jamais sondé, jamais lu, jamais signé, jamais rendu.
    expect(sonderSur).not.toHaveBeenCalledWith(R_AUTRE);
    expect(JSON.stringify(analyserRushServeurCache.mock.calls)).not.toContain(AUTRE);
    expect(JSON.stringify(urlRenduPourRush.mock.calls)).not.toContain(AUTRE);
    expect(presignedGetObject.mock.calls.filter((c) => JSON.stringify(c).includes(AUTRE))).toHaveLength(0);
    expect(createSignedUrl).toHaveBeenCalledTimes(0);
    expect(entreeRendu()).not.toContain(AUTRE);
    // Ni mort, ni drapeau « expiré — réimportez », ni écriture.
    expect(onRushMort).not.toHaveBeenCalled();
    expect(meta.rushIgnore).toBeUndefined();
    expect(ecrituresInterdites).not.toHaveBeenCalled();
    // Aucune fuite : ni métadonnées, ni design, ni journaux.
    expect(JSON.stringify(meta)).not.toContain(AUTRE);
    expect(JSON.stringify(design)).not.toContain(AUTRE);
    expect(journaux.join('\n')).not.toContain(AUTRE);
  });

  it('seul rush de la banque refusé : montage sans rush, toujours aucune lecture', async () => {
    const { rendu } = await produire(cfg({ rushUrls: [R_AUTRE] }), { rushDuPost: R_AUTRE });
    expect(rendu.rushUrl).toBeNull();
    expect(sonderSur).not.toHaveBeenCalled();
    expect(presignedGetObject).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(entreeRendu()).not.toContain(AUTRE);
  });
});

describe('G — rechargement : le résumé reste cohérent', () => {
  it('3 rushes dont 1 expiré → 2, avant comme après relecture de la réponse de vérification', () => {
    const banque = [R1, R2, R3];
    const reponse = { success: true, resultats: { [R1]: true, [R2]: false, [R3]: true }, etats: { [R1]: 'utilisable', [R2]: 'expire', [R3]: 'utilisable' } };
    const etats = etatsDepuisReponseVerifier(reponse);
    expect(rushesUtilisables(banque, etats)).toEqual([R1, R3]);
    // « Rechargement » : la même réponse relue (JSON) donne le même compte.
    expect(rushesUtilisables(banque, etatsDepuisReponseVerifier(JSON.parse(JSON.stringify(reponse))))).toHaveLength(2);
    // Et le moteur rend exactement ces deux-là.
  });

  it('le moteur, relancé sur la même banque, monte les mêmes 2 rushes', async () => {
    STATUTS.set(R2, 403);
    const premier = await produire(cfg({ rushUrls: [R1, R2, R3] }), { rushDuPost: R1 });
    const urls1 = [...new Set(montage(premier.design).map((s) => s.url))].sort();
    insertions = [];
    const second = await produire(cfg({ rushUrls: [R1, R2, R3] }), { rushDuPost: R1 });
    const urls2 = [...new Set(montage(second.design).map((s) => s.url))].sort();
    expect(urls1).toEqual([R1, R3].sort());
    expect(urls2).toEqual(urls1);
  });
});

describe('H — projet existant (sans clé `sources`) : aucune régression', () => {
  it('rush unique valide : exactement l’entrée de rendu d’avant', async () => {
    const c = cfg({ rushUrls: [R1] });
    const { design, post } = await produire(c);
    expect(design).toEqual(buildAutopilotDesign(post, { posterUrl: 'https://cdn.test/affiche.jpg', rushSeconds: 15, voices: {}, config: c }));
  });

  it('réponse de vérification d’avant (booléens seuls) : lue comme avant', () => {
    const etats = etatsDepuisReponseVerifier({ success: true, resultats: { [R1]: true, [R2]: false } });
    expect(etats).toEqual({ [R1]: 'utilisable', [R2]: 'introuvable' });
    // Non vérifié = compte (le doute profite au rush).
    expect(rushesUtilisables([R1, R2, R3], etats)).toEqual([R1, R3]);
  });

  it('erreur réseau / 5xx : le rush reste utilisable (le doute lui profite)', async () => {
    STATUTS.set(R1, 503);
    const { rendu } = await produire(cfg({ rushUrls: [R1] }));
    expect(rendu.rushUrl).toBe(R1);
  });
});
