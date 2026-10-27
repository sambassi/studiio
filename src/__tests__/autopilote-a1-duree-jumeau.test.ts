import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * PR A1 — UN JUMEAU SANS DURÉE FIABLE N'EST PLUS SUPPRIMÉ EN SILENCE.
 *
 * Défaut N1 : sonde du MP4 du jumeau en échec → `jumeauSeconds ?? 0` →
 * séquence « Vidéo » de 0 s → supprimée par `planSequences` : l'avatar, payé,
 * disparaissait du montage sans motif.
 *
 * 1. CARACTÉRISATION (verte avant ET après le correctif, sans modification) :
 *    montage SANS jumeau figé à l'octet (design rendu + métadonnées), jumeau à
 *    durée valide (arrondi au supérieur, inchangé).
 * 2. DÉFAUT (rouge avant, vert après) : durée 0 / NaN / négative / Infinity /
 *    null / hors plafond / sonde qui lève / fichier absent / fichier corrompu
 *    → montage ARRÊTÉ (`jumeau_illisible`), ni rendu, ni débit, ni post ;
 *    sonde illisible mais fichier lisible en secours → avatar monté.
 *
 * Aucun réseau : rendu, sondes, stockage, crédits et base sont doublés.
 */

// ── Rendu doublé : on CAPTURE le design réellement rendu ────────────────────
let lastDesign: Record<string, unknown> | null = null;
const renderAndUpload = vi.fn(async (arg: { design: Record<string, unknown> }) => {
  lastDesign = arg.design;
  return { videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 };
});
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [{ design: Record<string, unknown> }])),
}));

// ── Sondes doublées ─────────────────────────────────────────────────────────
type Sonde = number | null | 'leve';
let sondeJumeau: Sonde = 12;
const probeRushSeconds = vi.fn(async (url: string) => {
  if (!url.includes('/avatar/')) return 6;
  if (sondeJumeau === 'leve') throw new Error('sonde HS');
  return sondeJumeau;
});
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: (...a: unknown[]) => probeRushSeconds(...(a as [string])),
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

vi.mock('@/lib/autopilot/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/autopilot/voice')>();
  return { ...actual, buildAutopilotVoices: vi.fn(async () => ({})) };
});

// ── Crédits doublés : AUCUN débit ne doit partir sur un montage arrêté ──────
const deductCredits = vi.fn(async () => true);
vi.mock('@/lib/credits/system', () => ({
  getVideoRenderCost: () => 10,
  deductCredits: (...a: unknown[]) => deductCredits(...(a as [])),
}));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));

// ── Base en mémoire ─────────────────────────────────────────────────────────
let insertions: Array<Record<string, unknown>> = [];
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

// ── Stockage interne (MinIO) doublé : le secours lit ICI, jamais le réseau ──
let objets = new Map<string, Buffer>();
const lecturesMinio = vi.fn();
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      const o = objets.get(`${b}/${c}`);
      if (!o) throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
      return { size: o.length };
    },
    putObject: async () => undefined,
  }),
  lecteurMinio: () => ({
    getObject: async (b: string, c: string) => {
      lecturesMinio(b, c);
      const o = objets.get(`${b}/${c}`) as Buffer;
      return (async function* flux() { yield o; })();
    },
  }),
}));

// Plein cadre : hors sujet ici (testé ailleurs) — l'URL d'origine est montée.
vi.mock('@/lib/avatar/jumeau-plein-cadre', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/avatar/jumeau-plein-cadre')>();
  return { ...actual, jumeauPleinCadre: async (a: { url: string }) => ({ url: a.url, statut: 'original' }) };
});

// ffprobe : réel par défaut ; doublé quand le test fixe une durée de secours.
let ffprobeDouble: number | null | undefined;
vi.mock('@/lib/avatar/preparation-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/avatar/preparation-source')>();
  return {
    ...actual,
    infosVideo: async (chemin: string) => (ffprobeDouble === undefined
      ? actual.infosVideo(chemin)
      : { dureeS: ffprobeDouble ?? 0 } as Awaited<ReturnType<typeof actual.infosVideo>>),
  };
});

// Aucun fournisseur ne doit jamais être appelé.
const fournisseur = vi.fn();
vi.mock('@/lib/avatar/heygen', () => ({ getVideoStatus: fournisseur, downloadVideo: fournisseur, generateVideo: fournisseur }));

import { produireUnMontage } from '@/lib/autopilot/produire';
import {
  mesurerDureeJumeau, dureeJumeauValide, dureeDuContenu, estJumeauIllisible,
  DUREE_JUMEAU_MAX_S, MESSAGE_JUMEAU_ILLISIBLE,
} from '@/lib/autopilot/duree-jumeau';

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const GEN = 'c0ffee00-3333-4333-8333-333333333333';
const JUMEAU_URL = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GEN}.mp4`;
const CLE_MINIO = `media/u1/avatar/${GEN}.mp4`;
const RUSH = 'https://projet.supabase.co/storage/v1/object/public/media/u1/rush.mp4';

const ffprobeDispo = (() => {
  try { execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [RUSH], voiceEnabled: false, ...p,
});

async function produire(jumeauVideoUrl: string | null, c: AutopilotConfig = cfg()) {
  const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
  const rendu = await produireUnMontage({
    userId: 'u1', config: c, post, rang: 0, now: T0, jobId: 'autopilote-u1-2026-08-05-1', jumeauVideoUrl,
  });
  return { rendu, meta: insertions[0]?.metadata as Record<string, unknown> };
}

beforeEach(() => {
  insertions = [];
  lastDesign = null;
  objets = new Map();
  sondeJumeau = 12;
  ffprobeDouble = undefined;
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════
// 1. CARACTÉRISATION — inchangée par le correctif
// ═════════════════════════════════════════════════════════════════════════
describe('A1 — caractérisation : ce qui ne doit pas bouger', () => {
  it('montage SANS jumeau : design rendu et métadonnées identiques à l’octet', async () => {
    const { meta } = await produire(null);
    expect(JSON.stringify(lastDesign)).toMatchSnapshot('design-sans-jumeau');
    // Seuls les chronos (`*_MS`) varient d'une exécution à l'autre : neutralisés.
    // Seuls ajouts (2026-10-20, plan = MP4) : la vérification ADDITIVE de la
    // durée du MP4 final — sortie du cliché, vérifiée à part ; tout le reste
    // reste identique à l'octet.
    const { dureeVerifiee, dureeRendu, ...metaAvant } = meta as Record<string, unknown>;
    expect(typeof dureeVerifiee).toBe('boolean');
    expect(dureeRendu).toMatchObject({ planS: expect.any(Number) });
    expect(JSON.stringify(metaAvant, (k, v) => (/_MS$/.test(k) ? 0 : v))).toMatchSnapshot('meta-sans-jumeau');
    // Aucune mesure de jumeau, aucun accès au stockage interne.
    expect(probeRushSeconds.mock.calls.some(([u]) => String(u).includes('/avatar/'))).toBe(false);
    expect(lecturesMinio).not.toHaveBeenCalled();
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('buildAutopilotDesign SANS jumeau : identique à l’octet', () => {
    const c = cfg();
    const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
    expect(JSON.stringify(buildAutopilotDesign(post, { config: c, rushSeconds: 6 }))).toMatchSnapshot('build-sans-jumeau');
  });

  it.each([
    // A3 : + 0,8 s, le fondu de sortie vers le CTA (la parole finit avant lui).
    [12, 12.8], [12.3, 13.1], [2.2, 3], [47.01, 47.9], [0.4, 1.2],
  ])('jumeau à durée valide %s s → séquence Vidéo de %s s (A4 : au dixième supérieur ; A3 : + fondu de sortie)', (s, attendu) => {
    const post = { title: 'Sujet', content: { subtitle: 's', cards: [], tagLine: 'cta' }, rushUrl: RUSH } as unknown as Parameters<typeof buildAutopilotDesign>[0];
    const d = buildAutopilotDesign(post, { config: DEFAULT_CONFIG, jumeau: { videoUrl: JUMEAU_URL, seconds: s } });
    expect(d.videoDuration).toBe(attendu);
    expect(d.videoUrl).toBe(JUMEAU_URL);
  });

  it('montage AVEC jumeau lisible (sonde 12,3 s) : avatar monté, 12,3 s (A4), un rendu, un débit, design figé', async () => {
    sondeJumeau = 12.3;
    const { meta } = await produire(JUMEAU_URL);
    expect(lastDesign?.videoUrl).toBe(JUMEAU_URL);
    expect(lastDesign?.videoDuration).toBe(13.1); // A3 : 12,3 + fondu de sortie 0,8
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(lecturesMinio).not.toHaveBeenCalled(); // pas de secours quand la sonde suffit
    expect(JSON.stringify(lastDesign)).toMatchSnapshot('design-jumeau-valide');
    expect(meta).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. LE DÉFAUT N1 — rouge avant le correctif
// ═════════════════════════════════════════════════════════════════════════
describe('A1 — sans durée fiable, le montage est ARRÊTÉ (jamais produit sans avatar)', () => {
  const attendreArret = async () => {
    let erreur: unknown = null;
    try { await produire(JUMEAU_URL); } catch (e) { erreur = e; }
    expect(estJumeauIllisible(erreur)).toBe(true);
    expect((erreur as Error).message).toBe(MESSAGE_JUMEAU_ILLISIBLE);
    // Ni rendu, ni débit, ni post déposé, ni fournisseur rappelé.
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(insertions).toHaveLength(0);
    expect(fournisseur).not.toHaveBeenCalled();
  };

  it.each<[string, Sonde]>([
    ['0', 0], ['NaN', Number.NaN], ['négative', -3], ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null], ['hors plafond', DUREE_JUMEAU_MAX_S + 1], ['sonde qui lève', 'leve'],
  ])('sonde %s, fichier ABSENT du stockage (404) → arrêt motivé', async (_n, v) => {
    sondeJumeau = v;
    await attendreArret();
  });

  it('sonde null, secours ffprobe à 0 → arrêt motivé', async () => {
    sondeJumeau = null;
    objets.set(CLE_MINIO, Buffer.from('x'));
    ffprobeDouble = 0;
    await attendreArret();
  });

  it.skipIf(!ffprobeDispo)('sonde null, fichier CORROMPU (octets aléatoires, vrai ffprobe) → arrêt motivé', async () => {
    sondeJumeau = null;
    objets.set(CLE_MINIO, randomBytes(64 * 1024));
    await attendreArret();
    expect(lecturesMinio).toHaveBeenCalledWith('media', `u1/avatar/${GEN}.mp4`);
  });

  it('sonde null mais fichier LISIBLE en secours (14,2 s) → avatar monté sur 14,2 s (A4)', async () => {
    sondeJumeau = null;
    objets.set(CLE_MINIO, Buffer.from('mp4'));
    ffprobeDouble = 14.2;
    await produire(JUMEAU_URL);
    expect(lastDesign?.videoUrl).toBe(JUMEAU_URL);
    expect(lastDesign?.videoDuration).toBe(15); // A3 : 14,2 + fondu de sortie 0,8
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(fournisseur).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. La mesure elle-même
// ═════════════════════════════════════════════════════════════════════════
describe('A1 — mesurerDureeJumeau / dureeJumeauValide', () => {
  it.each([
    [0, null], [-1, null], [Number.NaN, null], [Number.POSITIVE_INFINITY, null], [null, null], [undefined, null],
    ['12', null], [DUREE_JUMEAU_MAX_S + 0.01, null], [0.01, 0.01], [12.3, 12.3], [DUREE_JUMEAU_MAX_S, DUREE_JUMEAU_MAX_S],
  ])('dureeJumeauValide(%s) = %s', (v, attendu) => {
    expect(dureeJumeauValide(v)).toBe(attendu);
  });

  it('plafond = durée maximale d’un montage du produit (120 s)', () => {
    expect(DUREE_JUMEAU_MAX_S).toBe(120);
  });

  it('sonde valide → secours jamais appelé', async () => {
    const secours = vi.fn(async () => 99);
    expect(await mesurerDureeJumeau({ url: JUMEAU_URL, userId: 'u1' }, { sonder: async () => 8.5, secours }))
      .toEqual({ secondes: 8.5, methode: 'sonde' });
    expect(secours).not.toHaveBeenCalled();
  });

  it('sonde invalide → secours valide retenu', async () => {
    expect(await mesurerDureeJumeau({ url: JUMEAU_URL, userId: 'u1' }, { sonder: async () => 0, secours: async () => 9.5 }))
      .toEqual({ secondes: 9.5, methode: 'secours' });
  });

  it('les deux lèvent ou sont invalides → null (jamais une durée inventée)', async () => {
    const leve = async () => { throw new Error('x'); };
    expect(await mesurerDureeJumeau({ url: JUMEAU_URL, userId: 'u1' }, { sonder: leve, secours: leve })).toBeNull();
    expect(await mesurerDureeJumeau({ url: JUMEAU_URL, userId: 'u1' }, { sonder: async () => Number.NaN, secours: async () => Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('secours par défaut : URL d’un AUTRE compte → jamais lue', async () => {
    objets.set(`media/u2/avatar/${GEN}.mp4`, Buffer.from('x'));
    ffprobeDouble = 10;
    const r = await mesurerDureeJumeau(
      { url: `https://studiio.pro/storage/v1/object/public/media/u2/avatar/${GEN}.mp4`, userId: 'u1' },
      { sonder: async () => null },
    );
    expect(r).toBeNull();
    expect(lecturesMinio).not.toHaveBeenCalled();
  });

  it.skipIf(!ffprobeDispo)('dureeDuContenu : octets aléatoires → null (vrai ffprobe, fichier local)', async () => {
    expect(await dureeDuContenu(randomBytes(32 * 1024))).toBeNull();
  });
});
