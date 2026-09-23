import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, unlinkSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

/**
 * La chaîne Autopilote, DE BOUT EN BOUT, par le vrai gestionnaire du cron.
 *
 *   déclencheur (GET /api/cron/autopilot, jeton CRON_SECRET)
 *   → décision (`decideRun`) → préparation (`preparePosts`)
 *   → `produireUnMontage` → `renderAndUpload` (VRAI module)
 *   → rendu → vignette (VRAI ffmpeg) → stockage → `scheduled_posts` → débit
 *
 * Ce qui est doublé, et SEULEMENT ça : la base (en mémoire), les crédits, le
 * stockage (un dossier temporaire tient lieu de MinIO), la composition
 * Remotion (un vrai MP4 de 2 s fabriqué par ffmpeg tient lieu du rendu
 * Chromium) et les fournisseurs (Pexels, ElevenLabs, Replicate, D-ID).
 * AUCUN appel réseau, AUCUN fournisseur payant.
 *
 * Un « 200 » du cron n'est pas une preuve : chaque cas vérifie un FICHIER
 * sur disque et une LIGNE insérée qui pointe dessus.
 */

// ── Base en mémoire ──────────────────────────────────────────────────────
let configs: Array<Record<string, unknown>>;
let posts: Array<Record<string, unknown>>;
let majConfig: Array<Record<string, unknown>>;

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    let maj: Record<string, unknown> | null = null;
    const lire = () => {
      if (maj) {
        if (table === 'autopilot_config') {
          majConfig.push(maj);
          for (const c of configs) Object.assign(c, maj);
        }
        return { data: null, error: null };
      }
      if (table === 'autopilot_config') return { data: configs, error: null };
      if (table === 'scheduled_posts') return { data: posts, error: null };
      if (table === 'users') return { data: [{ email: null }], error: null };
      return { data: [], error: null };
    };
    const chaine: Record<string, unknown> = {};
    const self = () => chaine;
    Object.assign(chaine, {
      select: self, eq: self, in: self, order: self,
      update(v: Record<string, unknown>) { maj = v; return chaine; },
      async limit() { return lire(); },
      then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
        return Promise.resolve(lire()).then(ok, ko);
      },
      insert(row: Record<string, unknown>) {
        if (table !== 'scheduled_posts') throw new Error(`insertion inattendue : ${table}`);
        const id = `post-${posts.length + 1}`;
        posts.push({ ...row, id });
        return { async select() { return { data: [{ id }], error: null }; } };
      },
    });
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

// ── Crédits ──────────────────────────────────────────────────────────────
const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 500,
  deductCredits: (...a: unknown[]) => deductCredits(...a),
  getVideoRenderCost: () => 10,
}));

vi.mock('@/lib/email/resend', () => ({ sendEmailSilent: vi.fn() }));
vi.mock('@/lib/notifications/store', () => ({
  notifyOnce: async () => ({ created: false }),
  NOTIFICATION_KINDS: { autopiloteCredits: 'c', autopiloteSansRush: 's', autopiloteRushIntrouvable: 'r' },
}));

// ── Jumeau : hors de cette preuve (aucun appel D-ID) ────────────────────
const lancerJumeauMontage = vi.fn();
vi.mock('@/lib/autopilot/jumeau-async', () => ({
  finaliserJumeauxPrets: async () => ({ examines: 0, rendus: 0, encore: 0, echecs: 0 }),
  lancerJumeauMontage: (...a: unknown[]) => lancerJumeauMontage(...a),
  creneauxJumeauEnAttente: async () => new Set<string>(),
}));

// ── Fournisseurs : aucun appel réel ─────────────────────────────────────
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 3,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
vi.mock('@/lib/autopilot/voice', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autopilot/voice')>('@/lib/autopilot/voice');
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
const genererAfficheReference = vi.fn(async (..._a: unknown[]) => ({ ok: true, url: 'https://minio.test/images/affiche-ia.jpg' }));
vi.mock('@/lib/ai/affiche-reference', () => ({
  genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a),
}));

// ── Rendu : un VRAI fichier MP4, fabriqué par ffmpeg ────────────────────
// Le binaire embarqué s'il a été téléchargé, sinon celui du système — la CI
// installe le second, pas le premier.
const ffmpegStatic = require('ffmpeg-static') as string | null;
const ffmpeg = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
const racine = mkdtempSync(join(tmpdir(), 'studiio-preuve-autopilote-'));
const stockage = join(racine, 'minio');
const journal: string[] = [];
let renduEchoue = false;

const renderCreerSimple = vi.fn(async (input: { jobId: string }) => {
  journal.push(`RENDER_STARTED jobId=${input.jobId}`);
  if (renduEchoue) throw new Error('Chromium a refusé de démarrer (simulé)');
  const outputPath = join(racine, `studiio-render-${input.jobId}.mp4`);
  execFileSync(ffmpeg, [
    '-f', 'lavfi', '-i', 'color=c=purple:s=108x192:d=2', '-pix_fmt', 'yuv420p', '-y', outputPath,
  ], { stdio: 'ignore' });
  journal.push(`RENDER_COMPLETED ${outputPath} (${statSync(outputPath).size} octets)`);
  return { outputPath, durationFrames: 60 };
});
vi.mock('@/lib/render/creerSimple', () => ({
  renderCreerSimple: (i: { jobId: string }) => renderCreerSimple(i),
}));

// ── Stockage : un dossier tient lieu de MinIO ───────────────────────────
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorage: async (o: { filePath: string; bucket: string; storagePath: string }) => {
    const cible = join(stockage, o.bucket, o.storagePath);
    mkdirSync(dirname(cible), { recursive: true });
    copyFileSync(o.filePath, cible);
    unlinkSync(o.filePath);
    journal.push(`MEDIA_STORED ${o.bucket}/${o.storagePath}`);
    return `https://minio.test/${o.bucket}/${o.storagePath}`;
  },
}));

afterAll(() => { rmSync(racine, { recursive: true, force: true }); });

// ── Scénario ─────────────────────────────────────────────────────────────
/** 2026-09-23 à 08:00:02 à Paris (UTC+2) — l'heure de départ du compte. */
const PASSAGE = Date.parse('2026-09-23T06:00:02.000Z');
const JOUR = 86_400_000;

const ligneConfig = (p: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  enabled: true,
  mode: 'review',
  cadence: 'daily',
  count_per_cycle: 1,
  platforms: [],
  credit_floor: 0,
  rush_urls: ['https://minio.test/rushes/u1/rush-a.mp4'],
  topics: ['yoga'],
  run_hour: 8,
  run_timezone: 'Europe/Paris',
  publish_time: '18:00',
  last_run_at: null,
  voice_enabled: false,
  ...p,
});

async function passageDuCron(now = PASSAGE) {
  vi.setSystemTime(now);
  vi.resetModules();
  const { GET } = await import('@/app/api/cron/autopilot/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('http://localhost/api/cron/autopilot', {
    headers: { authorization: 'Bearer secret-test' },
  }));
  return { status: res.status, body: await res.json() };
}

/** Chemin local d'une URL « MinIO » de ce test. */
const surDisque = (url: string) => join(stockage, url.replace('https://minio.test/', ''));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  process.env.CRON_SECRET = 'secret-test';
  configs = [ligneConfig()];
  posts = [];
  majConfig = [];
  journal.length = 0;
  renduEchoue = false;
  deductCredits.mockClear();
  renderCreerSimple.mockClear();
  genererAfficheReference.mockClear();
  lancerJumeauMontage.mockClear();
});

describe('Preuve : du déclencheur au post relié à son média', () => {
  it('un passage rend un vrai fichier, le stocke, et le post pointe dessus', async () => {
    const { status, body } = await passageDuCron();
    expect(status).toBe(200);
    expect(body.rendus).toBe(1);

    // RENDER_STARTED / RENDER_COMPLETED
    expect(renderCreerSimple).toHaveBeenCalledTimes(1);
    // MEDIA_STORED — le montage ET sa vignette, extraite par le vrai ffmpeg.
    expect(posts).toHaveLength(1);
    const post = posts[0];
    const meta = post.metadata as Record<string, unknown>;
    const video = String(post.media_url);
    expect(existsSync(surDisque(video))).toBe(true);
    expect(statSync(surDisque(video)).size).toBeGreaterThan(0);
    expect(typeof meta.thumbnailUrl).toBe('string');
    expect(existsSync(surDisque(String(meta.thumbnailUrl)))).toBe(true);

    // POST_LINKED_TO_MEDIA — les deux champs que le Calendrier lit.
    expect(meta.videoUrl).toBe(video);
    expect(post.media_type).toBe('video');
    expect(post.agent_generated).toBe(true);
    expect(meta.source).toBe('autopilote');

    // UN débit, APRÈS le dépôt, référence stable du créneau.
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits.mock.calls[0][3]).toBe('autopilote:autopilote-u1-2026-09-24-1800');

    // La cadence avance.
    expect(majConfig.some((m) => typeof m.last_run_at === 'string')).toBe(true);

    console.log(['AUTOPILOT_TRIGGER GET /api/cron/autopilot → 200', ...journal,
      `POST_LINKED_TO_MEDIA ${post.id} media_url=${video}`].join('\n'));
  });

  it('un second passage sur le même créneau ne rend ni ne débite rien', async () => {
    await passageDuCron();
    configs[0].last_run_at = null; // même si la cadence n'avait pas été écrite
    const second = await passageDuCron(PASSAGE + 60_000);
    expect(second.body.rendus).toBe(0);
    expect(renderCreerSimple).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });
});

describe('Cause racine : un déclencheur quelques secondes en avance saute la journée', () => {
  it('cadence quotidienne, dernier passage 24 h moins 3 s plus tôt : on produit', async () => {
    // Hier, le déclencheur est parti à 08:00:05 ; aujourd'hui à 08:00:02.
    configs = [ligneConfig({ last_run_at: new Date(PASSAGE - JOUR + 3_000).toISOString() })];
    const { body } = await passageDuCron();
    expect(body.rapport[0].saute).toBeUndefined();
    expect(body.rendus).toBe(1);
    expect(posts).toHaveLength(1);
  });

  it('mais jamais deux cycles le même jour', async () => {
    configs = [ligneConfig({ last_run_at: new Date(PASSAGE - 30 * 60_000).toISOString() })];
    const { body } = await passageDuCron();
    expect(body.rapport[0].saute).toBe('pas-encore');
    expect(renderCreerSimple).not.toHaveBeenCalled();
  });

  it('cadence hebdomadaire : même tolérance, pas plus', async () => {
    configs = [ligneConfig({ cadence: 'weekly', last_run_at: new Date(PASSAGE - 7 * JOUR + 3_000).toISOString() })];
    expect((await passageDuCron()).body.rendus).toBe(1);
    configs = [ligneConfig({ cadence: 'weekly', last_run_at: new Date(PASSAGE - 6 * JOUR).toISOString() })];
    posts = [];
    expect((await passageDuCron()).body.rapport[0].saute).toBe('pas-encore');
  });
});

describe('Le cron lit la date de début, comme « Produire maintenant »', () => {
  it('date de début future : aucun rendu, aucun débit', async () => {
    configs = [ligneConfig({ start_date: '2026-10-01' })];
    const { body } = await passageDuCron();
    expect(body.rapport[0].saute).toBe('avant-la-date-de-debut');
    expect(renderCreerSimple).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });
});

describe('Rendu en échec : aucun débit, aucune vidéo fantôme, rejeu borné', () => {
  it('ni débit du rendu, ni débit de l affiche IA, ni post, ni avance de cadence', async () => {
    renduEchoue = true;
    configs = [ligneConfig({ poster_mode: 'reference', poster_urls: ['https://minio.test/photos/moi.jpg'] })];
    const { status, body } = await passageDuCron();
    expect(status).toBe(200);
    expect(body.echecs).toBe(1);
    expect(renderCreerSimple).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(0);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(majConfig.some((m) => 'last_run_at' in m)).toBe(false);
  });

  it('le rejeu du même créneau réutilise le MÊME job : fichiers et débits idempotents', async () => {
    renduEchoue = true;
    configs = [ligneConfig({ poster_mode: 'reference', poster_urls: ['https://minio.test/photos/moi.jpg'] })];
    await passageDuCron();
    renduEchoue = false;
    await passageDuCron(PASSAGE + 5 * 60_000);
    const jobs = genererAfficheReference.mock.calls.map((c) => (c[0] as { jobId: string }).jobId);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toBe(jobs[0]);
    // Le succès débite le rendu ET l'affiche — une fois chacun.
    expect(deductCredits).toHaveBeenCalledTimes(2);
    const refs = deductCredits.mock.calls.map((c) => c[3]);
    expect(new Set(refs).size).toBe(2);
    expect(posts).toHaveLength(1);
  });
});
