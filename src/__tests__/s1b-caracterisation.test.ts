// @vitest-environment node
/**
 * S1b — CARACTÉRISATION (doit passer AVANT et APRÈS le correctif, sans retouche).
 *
 * Fige le comportement ACTUEL des cas LÉGITIMES :
 *  - `localiserEntreesRendu` : notre stockage (anciens projets, rushs[],
 *    montage[], avatar/jumeau, affiche IA), chemin relais relatif, médias
 *    externes publics https (copiés par le fetch sûr, même clé
 *    `cleMediaExterne`), musique, voix ;
 *  - filtres de lecture (`mediaLisiblePar`, `urlDeLecture`) utilisés par
 *    l'Autopilote et par le chemin hybride ;
 *  - `produireUnMontage` : affiche « mes photos » du compte, affiche Pexels /
 *    Unsplash publique, affiche automatique.
 *
 * TOUT est simulé : le fetch sûr garde sa VRAIE politique
 * (`verifierCibleSure`) sur un faux DNS, sans transport ; MinIO, base,
 * rendu, fournisseurs remplacés. Aucun octet ne part.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile } from 'fs/promises';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.test';
process.env.NEXTAUTH_URL = 'https://studiio.test';
process.env.PUBLIC_STORAGE_URL = 'https://storage.exemple.test';
process.env.SUPABASE_LEGACY_STORAGE_URL = '';
const APP = 'https://studiio.test';
const CDN = 'https://storage.exemple.test';
const UID = 'u1';

const fauxDns = async (_h: string) => [{ address: '93.184.216.34', family: 4 }];

const appelsFetch: Array<{ url: string; verdict: string }> = [];
vi.mock('@/lib/securite/fetch-sur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/fetch-sur')>();
  return {
    ...actual,
    telechargerSur: async (url: string, destination: string, opts: import('@/lib/securite/fetch-sur').OptionsFetchSur = {}) => {
      try {
        await actual.verifierCibleSure(url, { ...opts, resoudre: fauxDns });
      } catch (e) {
        appelsFetch.push({ url, verdict: `REFUS:${(e as { motif?: string }).motif ?? (e as Error).name}` });
        throw e;
      }
      appelsFetch.push({ url, verdict: 'TELECHARGE' });
      await writeFile(destination, 'x');
      return { url, octets: 1, typeContenu: null };
    },
  };
});
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({ statObject: async () => { throw new Error('absent'); }, putObject: async () => undefined }),
  signeurInterne: () => null,
}));

// ── Autopilote : rendu, affiches, crédits, base doublés ─────────────────────
let lastDesign: Record<string, unknown> | null = null;
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: async (arg: { design: Record<string, unknown> }) => {
    lastDesign = arg.design;
    return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
  },
}));
const pickPosterUrl = vi.fn(async (..._a: unknown[]) => 'https://images.pexels.com/photos/9/auto.jpeg');
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: (...a: unknown[]) => pickPosterUrl(...a),
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
const genererAfficheReference = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/ai/affiche-reference', () => ({
  genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a),
}));
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
  const storage = { from: (b: string) => ({ getPublicUrl: (c: string) => ({ data: { publicUrl: `${APP}/storage/v1/object/public/${b}/${c}` } }) }) };
  return { supabaseAdmin: { from, storage }, supabase: { from, storage } };
});

import { localiserEntreesRendu, cleMediaExterne, type DepotMedias } from '@/lib/securite/medias-externes';
import { mediaLisiblePar, classerUrlLecture } from '@/lib/creer/analyse-rush-serveur';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { produireUnMontage } from '@/lib/autopilot/produire';

const deposes: string[] = [];
const depot: DepotMedias = {
  existe: async () => false,
  deposer: async (b, c) => { deposes.push(`${b}/${c}`); },
  urlPublique: (b, c) => `${APP}/storage/v1/object/public/${b}/${c}`,
};
const copie = (url: string, genre: 'video' | 'image' | 'audio') => `${APP}/storage/v1/object/public/media/${cleMediaExterne(url, genre)}`;

const NOTRE_RUSH = `${APP}/storage/v1/object/public/videos/${UID}/rush-1.mp4`;
const NOTRE_RUSH_CDN = `${CDN}/storage/v1/object/public/videos/${UID}/rush-2.mp4`;
const RUSH_ESPACE = `${APP}/storage/v1/object/public/videos/${UID}/mon%20rush.mp4`;
const RUSH_UNICODE = `${APP}/storage/v1/object/public/media/${UID}/été.mp4`;
const AFFICHE_IA = `${APP}/storage/v1/object/public/media/${UID}/autopilote-affiche/job-1.webp`;
const JUMEAU = `${APP}/storage/v1/object/public/videos/${UID}/avatar/jumeau.mp4`;
const VOIX = `${APP}/storage/v1/object/public/audio/${UID}/voix-titre.mp3`;
const MUSIQUE = `${APP}/storage/v1/object/public/audio/${UID}/musique.mp3`;
const COPIE_EXISTANTE = `${APP}/storage/v1/object/public/media/externes/0123456789abcdef.jpg`;
const RELAIS_RELATIF = `/storage/v1/object/public/videos/${UID}/rush-3.mp4`;
const PEXELS = 'https://images.pexels.com/photos/1/a.jpeg';
const UNSPLASH = 'https://images.unsplash.com/photo-1?w=1080';
const MUSIQUE_EXT = 'https://cdn.musique.example/piste.mp3';
const VIDEO_EXT = 'https://videos.pexels.com/video-files/1/v.mp4';

beforeEach(() => { appelsFetch.length = 0; deposes.length = 0; insertions = []; lastDesign = null; vi.clearAllMocks(); });

describe('S1b caractérisation — localiserEntreesRendu, cas légitimes', () => {
  it('notre stockage (anciens projets, rushs[], montage[], avatar, voix, affiche IA) : intact, aucun fetch', async () => {
    const d = {
      title: 'T',
      posterUrl: AFFICHE_IA,
      videoUrl: JUMEAU,
      rushs: [{ url: NOTRE_RUSH }, { url: NOTRE_RUSH_CDN }],
      montage: [{ url: NOTRE_RUSH, debut: 0, fin: 2 }, { url: RUSH_ESPACE, debut: 0, fin: 2 }, { url: RUSH_UNICODE, debut: 0, fin: 1 }],
      musicUrl: MUSIQUE,
      voiceUrl: VOIX,
      sequenceVoiceUrls: { titre: VOIX, video: JUMEAU, cta: null },
      sequenceBackgrounds: { intro: COPIE_EXISTANTE, cta: null },
    } as unknown as CreerSimpleRenderInput;
    const sortie = await localiserEntreesRendu(d, { depot });
    expect(sortie).toEqual(d);
    expect(appelsFetch).toEqual([]);
    expect(deposes).toEqual([]);
  });

  it('chemin relais RELATIF du compte : intact (signé plus tard par signerUrlsRelaisProfond)', async () => {
    const d = { title: 'T', videoUrl: RELAIS_RELATIF, rushs: [{ url: RELAIS_RELATIF }], musicUrl: `/storage/v1/object/public/audio/${UID}/m.mp3` } as unknown as CreerSimpleRenderInput;
    const sortie = await localiserEntreesRendu(d, { depot });
    expect(sortie).toEqual(d);
    expect(appelsFetch).toEqual([]);
  });

  it('champs absents, null ou vides : inchangés', async () => {
    const d = { title: 'T', posterUrl: null, videoUrl: '', musicUrl: null, voiceUrl: undefined } as unknown as CreerSimpleRenderInput;
    const sortie = await localiserEntreesRendu(d, { depot });
    expect(sortie).toEqual(d);
    expect(appelsFetch).toEqual([]);
  });

  it('médias externes publics https : copiés UNE fois par le fetch sûr, même clé cleMediaExterne', async () => {
    const d = {
      title: 'T',
      posterUrl: PEXELS,
      sequenceBackgrounds: { intro: UNSPLASH },
      videoUrl: VIDEO_EXT,
      rushs: [{ url: VIDEO_EXT }],
      montage: [{ url: VIDEO_EXT, debut: 0, fin: 2 }, { url: PEXELS, kind: 'image', debut: 0, fin: 2 }],
      musicUrl: MUSIQUE_EXT,
    } as unknown as CreerSimpleRenderInput;
    const sortie = await localiserEntreesRendu(d, { depot });
    expect(sortie.posterUrl).toBe(copie(PEXELS, 'image'));
    expect(sortie.sequenceBackgrounds?.intro).toBe(copie(UNSPLASH, 'image'));
    expect(sortie.videoUrl).toBe(copie(VIDEO_EXT, 'video'));
    expect(sortie.rushs?.[0]?.url).toBe(copie(VIDEO_EXT, 'video'));
    expect(sortie.montage?.[0]?.url).toBe(copie(VIDEO_EXT, 'video'));
    expect(sortie.montage?.[1]?.url).toBe(copie(PEXELS, 'image'));
    expect(sortie.musicUrl).toBe(copie(MUSIQUE_EXT, 'audio'));
    expect(appelsFetch.map((a) => a.verdict)).toEqual(['TELECHARGE', 'TELECHARGE', 'TELECHARGE', 'TELECHARGE']);
    expect(appelsFetch.map((a) => a.url).sort()).toEqual([MUSIQUE_EXT, PEXELS, UNSPLASH, VIDEO_EXT].sort());
    expect(copie(PEXELS, 'image')).toMatch(/\/media\/externes\/[0-9a-f]{40}\.jpeg$/);
  });

  it('avatar externe servant aussi de voix : localisé en VIDÉO une seule fois', async () => {
    const av = 'https://files.heygen.example/out/v.mp4';
    const d = { title: 'T', videoUrl: av, sequenceVoiceUrls: { video: av } } as unknown as CreerSimpleRenderInput;
    const sortie = await localiserEntreesRendu(d, { depot });
    expect(sortie.videoUrl).toBe(copie(av, 'video'));
    expect(sortie.sequenceVoiceUrls?.video).toBe(copie(av, 'video'));
    expect(appelsFetch).toHaveLength(1);
  });

  it('URL de notre stockage avec chaîne de requête (signée) : comportement actuel figé (refus, jamais copiée)', async () => {
    const signee = `${NOTRE_RUSH}?sr=abc`;
    await expect(localiserEntreesRendu({ title: 'T', videoUrl: signee } as CreerSimpleRenderInput, { depot }))
      .rejects.toMatchObject({ name: 'RefusSsrf' });
    expect(deposes).toEqual([]);
  });
});

describe('S1b caractérisation — filtres de lecture (Autopilote, hybride)', () => {
  it('mediaLisiblePar / classerUrlLecture : médias légitimes du compte et publics', () => {
    for (const u of [NOTRE_RUSH, NOTRE_RUSH_CDN, AFFICHE_IA, JUMEAU, MUSIQUE, RELAIS_RELATIF, COPIE_EXISTANTE, RUSH_ESPACE]) {
      expect(mediaLisiblePar(u, UID), u).toBe(true);
      expect(classerUrlLecture(u, UID).genre, u).toBe('stockage');
    }
    for (const u of [PEXELS, UNSPLASH, MUSIQUE_EXT, VIDEO_EXT]) {
      expect(mediaLisiblePar(u, UID), u).toBe(true);
      expect(classerUrlLecture(u, UID).genre, u).toBe('externe');
    }
  });
});

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], voiceEnabled: false, ...p,
});
async function produire(c: AutopilotConfig) {
  const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  await produireUnMontage({ userId: UID, config: c, post, rang: 0, now: T0, jobId: 'job-1' });
  return { meta: insertions[0]?.metadata as Record<string, unknown> };
}

describe('S1b caractérisation — affiches de l’Autopilote', () => {
  it('« mes photos » : photo de MON stockage → affiche du montage', async () => {
    const photo = `${APP}/storage/v1/object/public/media/${UID}/photos/moi.jpg`;
    await produire(cfg({ posterMode: 'custom', posterUrls: [photo] }));
    expect(lastDesign?.posterUrl).toBe(photo);
    expect(pickPosterUrl).not.toHaveBeenCalled();
  });

  it('« mes photos » : photo publique Pexels / Unsplash → affiche du montage', async () => {
    await produire(cfg({ posterMode: 'custom', posterUrls: [UNSPLASH] }));
    expect(lastDesign?.posterUrl).toBe(UNSPLASH);
    await produire(cfg({ posterMode: 'custom', posterUrls: [PEXELS] }));
    expect(lastDesign?.posterUrl).toBe(PEXELS);
    expect(pickPosterUrl).not.toHaveBeenCalled();
  });

  it('« référence IA » : ma photo sert de référence, l’affiche générée par le serveur est montée', async () => {
    const photo = `${APP}/storage/v1/object/public/media/${UID}/photos/moi.jpg`;
    genererAfficheReference.mockResolvedValue({ ok: true, url: AFFICHE_IA });
    await produire(cfg({ posterMode: 'reference', posterUrls: [photo] }));
    expect((genererAfficheReference.mock.calls[0][0] as { referenceUrl: string }).referenceUrl).toBe(photo);
    expect(lastDesign?.posterUrl).toBe(AFFICHE_IA);
  });

  it('« référence IA » en échec : ma photo gardée, échec écrit', async () => {
    const photo = `${APP}/storage/v1/object/public/media/${UID}/photos/moi.jpg`;
    genererAfficheReference.mockResolvedValue({ ok: false, motif: 'x' });
    const { meta } = await produire(cfg({ posterMode: 'reference', posterUrls: [photo] }));
    expect(lastDesign?.posterUrl).toBe(photo);
    expect(meta.posterReferenceEchec).toBe(true);
  });

  it('automatique : Pexels', async () => {
    await produire(cfg({ posterMode: 'auto', posterUrls: [] }));
    expect(pickPosterUrl).toHaveBeenCalled();
    expect(lastDesign?.posterUrl).toBe('https://images.pexels.com/photos/9/auto.jpeg');
  });
});
