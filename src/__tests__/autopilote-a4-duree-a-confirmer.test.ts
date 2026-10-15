import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/autopilot/rules';

/**
 * A4 v3 — avatar seul, durée < 20 s : JAMAIS de génération sans l'accord de
 * l'utilisateur, jamais une autre durée que celle choisie. Harnais repris de
 * autopilote-cron-jumeau.test.ts (vrai cron, vraie file, vrai produireUnMontage).
 *
 * Par le VRAI gestionnaire du cron, la VRAIE file (`lancerJumeauMontage`,
 * `finaliserJumeauxPrets`) et le VRAI `produireUnMontage`. Sont doublés : la
 * base (en mémoire, avec l'unicité `(user_id, slot_key)`), le moteur du
 * jumeau, son suivi, le rendu, les crédits et les fournisseurs. AUCUN appel
 * réel — ni D-ID, ni HeyGen, ni Replicate, ni publication.
 */

type Ligne = Record<string, unknown>;
let tables: Record<string, Ligne[]>;
let sequence = 0;

function filtrer(t: string, f: Array<(r: Ligne) => boolean>) {
  return (tables[t] ?? []).filter((r) => f.every((p) => p(r)));
}

vi.mock('@/lib/db/supabase', () => {
  const from = (t: string) => {
    const f: Array<(r: Ligne) => boolean> = [];
    let action: 'select' | 'update' | 'delete' = 'select';
    let patch: Ligne = {};
    let borne = Infinity;
    const executer = () => {
      const hit = filtrer(t, f);
      if (action === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      if (action === 'delete') { tables[t] = (tables[t] ?? []).filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      return { data: hit.slice(0, borne), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; },
      lt: (k: string, v: string) => { f.push((r) => String(r[k] ?? '') < v); return q; },
      is: (k: string, v: unknown) => { f.push((r) => (r[k] ?? null) === v); return q; },
      order: () => q,
      limit: (n: number) => { borne = n; return q; },
      single: async () => { const r = executer(); return { data: (r.data as Ligne[] | null)?.[0] ?? null, error: null }; },
      update: (p: Ligne) => { action = 'update'; patch = p; return q; },
      delete: () => { action = 'delete'; return q; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(executer()).then(ok, ko),
      insert: (row: Ligne) => {
        const unique = t === 'autopilot_jumeau_attente'
          && (tables[t] ?? []).some((r) => r.user_id === row.user_id && r.slot_key === row.slot_key);
        const id = `${t}-${++sequence}`;
        if (!unique) (tables[t] ??= []).push({ statut: 'en_attente', tentatives: 0, ...row, id });
        const res = unique
          ? { data: null, error: { code: '23505', message: 'duplicate key' } }
          : { data: [{ id }], error: null };
        return {
          select: () => ({
            single: async () => ({ data: res.data?.[0] ?? null, error: res.error }),
            then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok),
          }),
        };
      },
    };
    return q;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

let solde = 1000;
const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => solde,
  deductCredits: (...a: unknown[]) => deductCredits(...a),
  getVideoRenderCost: () => 10,
}));
vi.mock('@/lib/email/resend', () => ({ sendEmailSilent: vi.fn() }));
/** notifyOnce avec son anti-doublon (clé user|kind, fenêtre dedupeMs). */
const notifs: Array<{ kind: string; title: string; dedupeMs?: number }> = [];
const vus = new Map<string, number>();
const notifyOnce = vi.fn(async (n: { userId: string; kind: string; title: string; dedupeMs?: number; now?: number }) => {
  const t = Date.now(); const k = n.userId + '|' + n.kind; const f = n.dedupeMs ?? 86_400_000;
  if (vus.has(k) && t - (vus.get(k) as number) < f) return { created: false };
  vus.set(k, t); notifs.push(n); return { created: true };
});
vi.mock('@/lib/notifications/store', () => ({
  notifyOnce: (n: never) => notifyOnce(n),
  NOTIFICATION_KINDS: { autopiloteCredits: 'c', autopiloteSansRush: 's', autopiloteRushIntrouvable: 'r', autopiloteDureeAConfirmer: 'duree' },
}));

// ── Le moteur du jumeau : SIMULÉ ─────────────────────────────────────────
const genererVideoJumeau = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => {
  await new Promise((r) => setTimeout(r, 10));
  return { ok: true, generationId: 'gen-1' };
});
vi.mock('@/lib/avatar/moteur-jumeau', () => ({ genererVideoJumeau: (...a: unknown[]) => genererVideoJumeau(...a) }));
const avancer = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ status: 'processing', videoUrl: null }));
vi.mock('@/lib/avatar/statut', () => ({ avancerStatutGeneration: (...a: unknown[]) => avancer(...a) }));

// ── Rendu et fournisseurs : SIMULÉS ──────────────────────────────────────
const renderAndUpload = vi.fn(async (_i: { jobId: string; design: Ligne }) => ({
  videoUrl: 'https://minio.test/videos/u1/rendu.mp4', thumbnailUrl: 'https://minio.test/images/v.jpg', durationFrames: 900,
}));
vi.mock('@/lib/autopilot/render', () => ({ renderAndUpload: (i: { jobId: string; design: Ligne }) => renderAndUpload(i) }));
let absentes = new Set<string>();
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async (u: string) => !absentes.has(u),
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
vi.mock('@/lib/autopilot/voice', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autopilot/voice')>('@/lib/autopilot/voice');
  return { ...actual, buildAutopilotVoices: async () => ({}) };
});
const genererAfficheReference = vi.fn();
vi.mock('@/lib/ai/affiche-reference', () => ({ genererAfficheReference: (...a: unknown[]) => genererAfficheReference(...a) }));
const publication = vi.fn();
vi.mock('@/lib/social/publish', () => ({
  publishToInstagram: publication, publishToTikTok: publication, publishToFacebook: publication, publishToYouTube: publication,
}));

/** 2026-09-23 08:00:02 à Paris — l'heure de départ. */
const PASSAGE = Date.parse('2026-09-23T06:00:02.000Z');

const config = (p: Ligne = {}): Ligne => ({
  user_id: 'u1', enabled: true, mode: 'review', cadence: 'daily', count_per_cycle: 1,
  platforms: ['instagram'], credit_floor: 0, rush_urls: ['https://minio.test/rushes/u1/a.mp4'],
  topics: ['yoga'], run_hour: 8, run_timezone: 'Europe/Paris', publish_time: '18:00',
  last_run_at: null, voice_enabled: false, jumeau_avatar: true, ...p,
});

async function passage(now = PASSAGE) {
  vi.setSystemTime(now);
  const { GET } = await import('@/app/api/cron/autopilot/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('http://localhost/api/cron/autopilot', { headers: { authorization: 'Bearer s' } }));
  return res.json();
}
const file = () => tables.autopilot_jumeau_attente ?? [];
const posts = () => tables.scheduled_posts ?? [];
/** Rejouer le même créneau : la cadence est remise à zéro, comme si `last_run_at` n'avait pas été écrit. */
const rejouer = () => { tables.autopilot_config[0].last_run_at = null; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.resetModules();
  process.env.CRON_SECRET = 's';
  tables = { autopilot_config: [config()], scheduled_posts: [], users: [{ id: 'u1', email: null }] };
  solde = 1000;
  absentes = new Set();
  vi.clearAllMocks();
  notifs.length = 0; vus.clear();
  genererVideoJumeau.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, generationId: 'gen-1' };
  });
  avancer.mockImplementation(async () => ({ status: 'processing', videoUrl: null }));
});


const sendEmail = async () => (await import('@/lib/email/resend')).sendEmailSilent as unknown as ReturnType<typeof vi.fn>;

describe('A4 v3 — cron : durée < 20 s avec avatar seul', () => {
  it('15 s sans confirmation → cycle sauté (duree_a_confirmer), aucune génération, aucun rendu, aucun débit, aucun post', async () => {
    tables.autopilot_config = [config({ brief: { duree: 15 } })];
    const r = await passage();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(file()).toHaveLength(0);
    expect(posts()).toHaveLength(0);
    expect(JSON.stringify(r)).toContain('duree_a_confirmer');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe('duree');
  });

  it('passes répétées → UNE seule notification, jamais d’échec ni de boucle', async () => {
    tables.autopilot_config = [config({ brief: { duree: 15 }, users_email: null })];
    tables.users = [{ id: 'u1', email: 'a@b.c' }];
    for (let h = 0; h < 5; h += 1) { rejouer(); await passage(PASSAGE + h * 3_600_000 + h * 86_400_000); }
    expect(notifs).toHaveLength(1);
    expect((await sendEmail())).toHaveBeenCalledTimes(1);
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('après « Passer à 30 s » (config à 30 s) → génération lancée normalement', async () => {
    tables.autopilot_config = [config({ brief: { duree: 15 } })];
    await passage();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    tables.autopilot_config[0].brief = { duree: 30 };
    rejouer();
    await passage(PASSAGE + 60_000);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(file()).toHaveLength(1);
  });

  it('20 s et 30 s → lancés (pas de confirmation requise)', async () => {
    for (const duree of [20, 30]) {
      tables.autopilot_config = [config({ brief: { duree } })];
      tables.autopilot_jumeau_attente = [];
      genererVideoJumeau.mockClear();
      await passage();
      expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    }
  });

  it('sans avatar, 15 s → montage ordinaire, rien n’est bloqué', async () => {
    tables.autopilot_config = [config({ jumeau_avatar: false, brief: { duree: 15 } })];
    await passage();
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(notifs).toHaveLength(0);
  });

  it('ligne DÉJÀ en file à 15 s (jumeau lancé et payé) → produite à SA durée, un rendu, un débit', async () => {
    tables.autopilot_config = [config({ brief: { duree: 30 } })];
    await passage();
    expect(file()).toHaveLength(1);
    // Ligne mise en file avant la règle, avec une cible de 15 s.
    const snap = file()[0].snapshot as { post: { brief: Record<string, unknown> }; config: { brief: Record<string, unknown> } };
    snap.post.brief = { ...snap.post.brief, duree: 15 };
    snap.config.brief = { duree: 15 };
    tables.autopilot_config[0].brief = { duree: 15 };
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio.test/media/u1/avatar/gen-1.mp4' });
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1); // aucune nouvelle génération
    const d = renderAndUpload.mock.calls[0][0].design as Record<string, number>;
    const total = d.introDuration + d.cardsDuration + d.videoDuration + d.ctaDuration;
    expect(Math.abs(total - 15)).toBeLessThanOrEqual(0.3); // la durée CHOISIE, pas 30 s
  });
});

describe('A4 v3 — lancerJumeauMontage refuse sans rien réserver', () => {
  it('cible 15 s, avatar seul → duree_a_confirmer, aucune ligne, aucun appel', async () => {
    const { lancerJumeauMontage } = await import('@/lib/autopilot/jumeau-async');
    const { preparePosts } = await import('@/lib/autopilot/engine');
    const cfg = { ...DEFAULT_CONFIG, jumeauAvatar: true, brief: { duree: 15 } };
    const [post] = preparePosts({ config: cfg, topic: 'yoga', count: 1, now: PASSAGE, seeds: [1] });
    const r = await lancerJumeauMontage({ userId: 'u1', config: cfg, post, rang: 0, now: PASSAGE, jobId: 'j', slotKey: 's' });
    expect(r).toMatchObject({ ok: false, motif: 'duree_a_confirmer' });
    expect((r as { message: string }).message).toBe('Avec votre avatar, 15 s est trop court pour un message complet. Passez à 30 s pour lancer la génération.');
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(file()).toHaveLength(0);
  });
});
