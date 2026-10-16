/**
 * M2-c — Autopilote : la PERTINENCE des rushes est un DIAGNOSTIC écrit dans
 * `metadata.decisionMontage.pertinenceRushs`, APRÈS le rendu, sur les fiches
 * déjà lues (v1 M2-a, v2 M2-b en cache). Sélection, ordre, design et entrée
 * de rendu IDENTIQUES. Harnais repris de `autopilote-contenu-rushs-metadata`
 * (moteur réel, rendu doublé, MinIO en mémoire). Aucune IA, aucun réseau.
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
// MinIO doublé EN MÉMOIRE : objets (taille), attributions et fiches.
const OBJETS = new Map<string, Buffer>();
let minioEnPanne = false;
const ecritures: string[] = [];
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string) => presignedGetObject(b, c) }),
  clientMinio: () => ({
    statObject: async (b: string, c: string) => { if (minioEnPanne) throw new Error('ECONNREFUSED'); return { size: OBJETS.get(`${b}/${c}`)?.length ?? 1 }; },
    putObject: async (b: string, c: string, corps: Buffer) => { if (minioEnPanne) throw new Error('ECONNREFUSED'); ecritures.push(`${b}/${c}`); OBJETS.set(`${b}/${c}`, Buffer.from(corps)); },
  }),
  lecteurMinio: () => ({
    getObject: async (b: string, c: string) => {
      if (minioEnPanne) throw new Error('ECONNREFUSED');
      const o = OBJETS.get(`${b}/${c}`);
      if (!o) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' });
      const { Readable } = await import('stream');
      return Readable.from([o]);
    },
  }),
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
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';
import { cleFicheContenu } from '@/lib/creer/fiche-contenu-serveur';
import { ficheContenuRush } from '@/lib/creer/fiche-contenu';
import { fusionnerFicheV2 } from '@/lib/creer/fiche-contenu-v2';
import { writeFileSync } from 'fs';

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const PUB = 'https://studiio.pro/storage/v1/object/public';
const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const R1 = `${PUB}/media/${U}/library/stock-pexels-video-8955360.mp4`;
const R2 = `${PUB}/media/${U}/library/converted_1791985445290.mp4`;
const R3 = `${PUB}/media/${U}/library/converted_1792081208949.mp4`;

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], voiceEnabled: false, ...p,
});

let journaux: string[];
async function produire(c: AutopilotConfig, titre: string) {
  const post0 = preparePosts({ config: c, topic: titre, count: 1, now: T0 })[0];
  const post = { ...post0, title: titre };
  const onRushMort = vi.fn();
  const rendu = await produireUnMontage({ userId: U, config: c, post, rang: 0, now: T0, jobId: 'job-1', onRushMort, jumeauVideoUrl: null });
  return { rendu, design: lastDesign as Record<string, unknown>, meta: insertions[0]?.metadata as Record<string, unknown> };
}
const montage = (d: Record<string, unknown>) => (d.montage ?? []) as RushSegment[];
const entreeRendu = () => JSON.stringify(renderAndUpload.mock.calls);
let appelsReseau: string[];

beforeEach(() => {
  insertions = [];
  lastDesign = null;
  STATUTS.clear();
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
  appelsReseau = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => { appelsReseau.push(String(u)); throw new Error('réseau interdit'); }));
  journaux = [];
  for (const k of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { journaux.push(a.map(String).join(' ')); });
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function analyse(url: string, nettete: number, mouvement = 0.05): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < 15; t += 0.5) {
    echantillons.push({ t, mouvement: mouvement + 0.01 * Math.abs(Math.sin(t * 3)), luminosite: 0.45, nettete, audio: 0.3,
      empreinte: Array.from({ length: 64 }, (_, i) => ((Math.floor(t * 2) * 31 + i * 17 + url.length) % 97) / 97) });
  }
  return { url, duree: 15, echantillons };
}

const ATTRIBUTION = JSON.stringify({ provider: 'pexels', providerAssetId: '8955360', type: 'video', sourceUrl: 'https://www.pexels.com/video/women-dancing-in-a-studio-8955360/', description: 'women dancing in a studio', requete: 'dance workout' });
/** Fiche v2 EN CACHE (M2-b) : l'image ET la parole montrent de la finance. */
const V2_FINANCE = fusionnerFicheV2({
  v1: ficheContenuRush({ nomFichier: 'converted_1791985445290.mp4' }),
  vision: { objets: [], lieu: null, action: null, personnes: null, categories: [{ id: 'personal-finance', confiance: 'moyenne' }] },
  parole: { sujets: ['personal-finance'], dureeParlee: 8, source: 'parole' }, langue: 'fr', paroleEcoutee: true,
  etapes: { vision: { etat: 'faite' }, transcription: { etat: 'faite' } }, usage: { tarifs: 't' },
});

function preparer(o: { attribution?: boolean; v2?: boolean; minio?: boolean } = {}) {
  OBJETS.clear();
  ecritures.length = 0;
  minioEnPanne = o.minio === false;
  OBJETS.set(`media/${U}/library/stock-pexels-video-8955360.mp4`, Buffer.alloc(4096));
  OBJETS.set(`media/${U}/library/converted_1791985445290.mp4`, Buffer.alloc(2048));
  OBJETS.set(`media/${U}/library/converted_1792081208949.mp4`, Buffer.alloc(3072));
  if (o.attribution !== false) OBJETS.set(`media/stock-attributions/${U}/stock-pexels-video-8955360.mp4.json`, Buffer.from(ATTRIBUTION));
  if (o.v2) OBJETS.set(`media/${cleFicheContenu(U, 'media', `${U}/library/converted_1791985445290.mp4`, 2048, 2)}`, Buffer.from(JSON.stringify(V2_FINANCE)));
  const mesures: Record<string, AnalyseRush> = { [R1]: analyse(R1, 0.18), [R2]: analyse(R2, 0.25), [R3]: analyse(R3, 0.02, 0.0005) };
  analyserRushServeurCache.mockImplementation(async (u: unknown) => mesures[u as string] ?? null);
}

type Pert = { version: number; theme: string[]; rushs: Array<{ cle: string; niveau: string; aVerifier?: true; score: number | null; raisons: string[]; sources: string[] }> };
const pertinence = (meta: Record<string, unknown>) => (meta.decisionMontage as { pertinenceRushs?: Pert } | undefined)?.pertinenceRushs;

describe('M2-c — Autopilote : diagnostic de pertinence, montage inchangé', () => {
  it('danse : stock « women dancing in a studio » = lien, rush perso v2 finance (image + parole) = hors sujet', async () => {
    preparer({ v2: true });
    const { meta, design } = await produire(cfg({ rushUrls: [R1, R2] }), 'Cours de danse');
    const p = pertinence(meta)!;
    expect(p.version).toBe(1);
    expect(p.theme).toContain('dance');
    const stock = p.rushs.find((r) => r.cle.endsWith('stock-pexels-video-8955360.mp4'))!;
    expect(stock.niveau).toBe('partiel'); // une seule source forte (description) : jamais « pertinent » sur la requête
    expect(stock.aVerifier).toBeUndefined();
    const perso = p.rushs.find((r) => r.cle.endsWith('converted_1791985445290.mp4'))!;
    expect(perso).toMatchObject({ niveau: 'hors_sujet', score: 0.15, sources: ['vision', 'parole'] });
    expect(perso.raisons).toEqual(['Hors sujet pour Danse : montre Finance (image + parole)']);
    expect(JSON.stringify(p)).not.toMatch(/https?:|women|studio/);
    // Diagnostic seulement : le rush hors sujet est TOUJOURS monté.
    expect(montage(design).some((s) => s.url === R2)).toBe(true);
    // (`pertinence` seul existe déjà : score des extraits du moteur V2.)
    expect(entreeRendu()).not.toMatch(/pertinenceRushs|hors_sujet|aVerifier/);
    expect(appelsReseau.filter((u) => /anthropic|groq|openai|pexels\.com\/v|api\./.test(u))).toEqual([]);
  });

  it('sans aucune fiche informative : pas de clé, post identique à avant', async () => {
    preparer({ attribution: false });
    const { meta } = await produire(cfg({ rushUrls: [R2, R3] }), 'Cours de danse');
    expect((meta.decisionMontage as Record<string, unknown>).pertinenceRushs).toBeUndefined();
    expect((meta.decisionMontage as Record<string, unknown>).contenuRushs).toBeUndefined();
  });

  it('M2-b manquante : v1 seule, aucun hors sujet sur une seule source', async () => {
    preparer();
    const { meta } = await produire(cfg({ rushUrls: [R1, R2] }), 'Épargner chaque mois : finance');
    const p = pertinence(meta)!;
    expect(p.theme).toContain('personal-finance');
    expect(p.rushs.find((r) => r.cle.endsWith('8955360.mp4'))).toMatchObject({ niveau: 'partiel', aVerifier: true });
    expect(p.rushs.find((r) => r.cle.endsWith('converted_1791985445290.mp4'))).toMatchObject({ niveau: 'inconnu', score: null });
    expect(p.rushs.some((r) => r.niveau === 'hors_sujet')).toBe(false);
  });

  it('MinIO en panne : aucun diagnostic, le montage sort', async () => {
    preparer({ v2: true, minio: false });
    const { meta, rendu } = await produire(cfg({ rushUrls: [R1, R2] }), 'Cours de danse');
    expect(rendu).toBeTruthy();
    expect((meta.decisionMontage as Record<string, unknown>).pertinenceRushs).toBeUndefined();
  });

  const SCENARIOS = [
    { nom: 'danse-2', titre: 'Cours de danse', rushs: [R1, R2] },
    { nom: 'danse-3', titre: 'Cours de danse', rushs: [R1, R2, R3] },
    { nom: 'finance-2', titre: 'Épargner chaque mois : finance', rushs: [R2, R1] },
    { nom: 'nutrition-3', titre: 'Nutrition : bien manger', rushs: [R3, R1, R2] },
    { nom: 'inconnu-2', titre: 'Mon anniversaire', rushs: [R1, R2] },
  ];

  it('NON-RÉGRESSION : entrée de rendu, design, plan et ordre IDENTIQUES avec ou sans fiches, sur plusieurs scénarios', async () => {
    const instantanes: Record<string, unknown> = {};
    for (const s of SCENARIOS) {
      preparer({ v2: true });
      insertions = []; renderAndUpload.mockClear();
      const avec = await produire(cfg({ rushUrls: s.rushs }), s.titre);
      const renduAvec = entreeRendu();
      preparer({ attribution: false });
      insertions = []; renderAndUpload.mockClear();
      const sans = await produire(cfg({ rushUrls: s.rushs }), s.titre);
      expect(entreeRendu()).toBe(renduAvec);
      expect(avec.design).toEqual(sans.design);
      expect(avec.meta.rushSegments).toEqual(sans.meta.rushSegments);
      expect(avec.meta.rushUrls).toEqual(sans.meta.rushUrls);
      const norme = (m: Record<string, unknown>) => { const c = JSON.parse(JSON.stringify(m, (k, v) => (/_MS$/.test(k) ? 0 : v))); delete c.decisionMontage; return c; };
      expect(norme(avec.meta)).toEqual(norme(sans.meta));
      instantanes[s.nom] = { rendu: JSON.parse(renduAvec), meta: norme(avec.meta) };
    }
    // Comparaison ANCIEN / NOUVEAU code : le même instantané, produit sur la base (main) et sur cette branche.
    if (process.env.M2C_INSTANTANE) writeFileSync(process.env.M2C_INSTANTANE, JSON.stringify(instantanes));
  });

  it('pertinence calculée APRÈS le rendu, jamais passée au plan', async () => {
    const { readFileSync } = await import('fs');
    const p = readFileSync('src/lib/autopilot/produire.ts', 'utf8');
    expect(p.indexOf('evaluerPertinenceRushs(')).toBeGreaterThan(p.indexOf('await renderAndUpload({'));
    expect(p.indexOf('lireFicheV2(')).toBeGreaterThan(p.indexOf('await renderAndUpload({'));
    expect(p).not.toMatch(/lancerAnalyseIA/);
    // déclaration, 2 affectations (un seul contexte, celui du plan), garde, lecture.
    expect(p.match(/contextePertinence/g)?.length).toBe(5);
  });
});
