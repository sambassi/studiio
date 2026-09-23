import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/autopilot/rules';

/**
 * Le JUMEAU dans le cron Autopilote — de la configuration au post.
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
vi.mock('@/lib/notifications/store', () => ({
  notifyOnce: async () => ({ created: false }),
  NOTIFICATION_KINDS: { autopiloteCredits: 'c', autopiloteSansRush: 's', autopiloteRushIntrouvable: 'r' },
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
const MUSIQUE = 'https://minio.test/audio/u1/music/a.mp3';

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
  genererVideoJumeau.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, generationId: 'gen-1' };
  });
  avancer.mockImplementation(async () => ({ status: 'processing', videoUrl: null }));
});

describe('1-2. Consentement : le cron suit le choix EXPLICITE du compte', () => {
  it('jumeau désactivé → aucun appel au moteur, montage ordinaire', async () => {
    tables.autopilot_config = [config({ jumeau_avatar: false })];
    const r = await passage();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(r.rendus).toBe(1);
  });

  it('colonne absente (ancienne base) → traité comme désactivé', async () => {
    const c = config(); delete c.jumeau_avatar;
    tables.autopilot_config = [c];
    await passage();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
  });

  it('jumeau activé → UN lancement, mis en file, aucun rendu dans la passe', async () => {
    const r = await passage();
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(file()).toHaveLength(1);
    expect(file()[0]).toMatchObject({ statut: 'en_attente', generation_id: 'gen-1', job_id: 'autopilote-u1-2026-09-24-1800' });
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(r.rendus).toBe(1);
  });

  it('jumeau activé SANS rush : le jumeau tient la séquence vidéo, on lance', async () => {
    tables.autopilot_config = [config({ rush_urls: [] })];
    await passage();
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
  });
});

describe('3-4, 8. Un créneau = une génération, quoi qu il arrive', () => {
  it('même créneau rejoué → aucun second lancement', async () => {
    await passage();
    rejouer();
    await passage(PASSAGE + 60_000);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(file()).toHaveLength(1);
  });

  it('génération en cours → on suit, on ne relance pas', async () => {
    await passage();
    rejouer();
    await passage(PASSAGE + 5 * 60_000);
    expect(avancer).toHaveBeenCalledTimes(1);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(file()[0].statut).toBe('en_attente');
  });

  it('deux crons SIMULTANÉS → un seul job fournisseur', async () => {
    vi.setSystemTime(PASSAGE);
    const { GET } = await import('@/app/api/cron/autopilot/route');
    const { NextRequest } = await import('next/server');
    const req = () => new NextRequest('http://localhost/api/cron/autopilot', { headers: { authorization: 'Bearer s' } });
    await Promise.all([GET(req()), GET(req())]);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(file()).toHaveLength(1);
  });
});

describe('5-7, 12. Suivi par le finaliseur', () => {
  it('génération terminée → réutilisée : un rendu, UN post, un débit ; plus rien ensuite', async () => {
    await passage();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio.test/media/u1/avatar/gen-1.mp4' });
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(renderAndUpload.mock.calls[0][0].design.videoUrl).toBe('https://minio.test/media/u1/avatar/gen-1.mp4');
    expect(posts()).toHaveLength(1);
    expect(file()[0].statut).toBe('rendu');
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits.mock.calls[0][3]).toBe('autopilote:autopilote-u1-2026-09-24-1800');

    // Passes suivantes : rien — ni poll, ni lancement, ni post, ni débit.
    vi.clearAllMocks();
    rejouer();
    await passage(PASSAGE + 2 * 60 * 60_000);
    expect(avancer).not.toHaveBeenCalled();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('échec définitif du fournisseur → ligne close, jamais relancée', async () => {
    await passage();
    avancer.mockResolvedValue({ status: 'failed', videoUrl: null, error: 'D-ID échec', rembourse: true });
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    expect(file()[0].statut).toBe('echec');
    vi.clearAllMocks();
    rejouer();
    await passage(PASSAGE + 2 * 60 * 60_000);
    expect(avancer).not.toHaveBeenCalled();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
  });

  it('erreur passagère → réessai BORNÉ : la ligne est close au plafond de tentatives', async () => {
    await passage();
    avancer.mockRejectedValue(new Error('D-ID 503'));
    file()[0].tentatives = 39;
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    expect(file()[0].statut).toBe('echec');
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
  });

  it('une ligne déjà en file (production manuelle) est finalisée comme avant', async () => {
    tables.autopilot_config = [config({ enabled: false })];
    tables.autopilot_jumeau_attente = [{
      id: 'm1', user_id: 'u1', generation_id: 'gen-m', slot_key: 'manuel:u1|2026-09-22|14:45', job_id: 'job-m',
      statut: 'en_attente', tentatives: 15,
      snapshot: { config: { ...DEFAULT_CONFIG, mode: 'review', platforms: [] }, post: { title: 'yoga', caption: '', scheduledDate: '2026-09-22', scheduledTime: '14:45', platforms: [], rushUrl: null, content: { subtitle: 's', tagLine: 't', cards: [] } }, rang: 0, now: PASSAGE },
    }];
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio.test/media/u1/avatar/gen-m.mp4' });
    await passage();
    expect(file()[0].statut).toBe('rendu');
    expect(posts()).toHaveLength(1);
    expect(genererVideoJumeau).not.toHaveBeenCalled();
  });
});

describe('9. Crédits', () => {
  it('le cycle est borné au coût RÉEL avec jumeau (avatar + rendu), lu dans les constantes', async () => {
    const { AVATAR_VIDEO_COST } = await import('@/lib/stripe/constants');
    solde = AVATAR_VIDEO_COST + 10 - 1;
    const r = await passage();
    expect(r.rapport[0].saute).toBe('credits');
    expect(genererVideoJumeau).not.toHaveBeenCalled();

    solde = AVATAR_VIDEO_COST + 10;
    vi.resetModules();
    await passage();
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
  });

  it('le cron lui-même ne débite rien au lancement (le moteur débite l avatar, une fois)', async () => {
    await passage();
    expect(deductCredits).not.toHaveBeenCalled();
  });
});

describe('10-11. Mode review / auto — aucune publication réelle', () => {
  const finaliser = async (mode: string) => {
    tables.autopilot_config = [config({ mode })];
    await passage();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio.test/media/u1/avatar/gen-1.mp4' });
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    return posts()[0];
  };

  it('review → brouillon', async () => {
    const p = await finaliser('review');
    expect(p.status).toBe('draft');
    expect(publication).not.toHaveBeenCalled();
  });

  it('auto → programmé sur les réseaux choisis, publié plus tard par le cron de publication seulement', async () => {
    const p = await finaliser('auto');
    expect(p.status).toBe('scheduled');
    expect(p.platforms).toEqual(['instagram']);
    expect(publication).not.toHaveBeenCalled();
  });
});

describe('13-14. Non-régression', () => {
  it('musique 404 : le montage du jumeau sort sans musique, et le dit (#432)', async () => {
    tables.autopilot_config = [config({ music_url: MUSIQUE })];
    absentes.add(MUSIQUE);
    await passage();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio.test/media/u1/avatar/gen-1.mp4' });
    rejouer();
    await passage(PASSAGE + 60 * 60_000);
    expect(renderAndUpload.mock.calls[0][0].design.musicUrl ?? null).toBeNull();
    expect((posts()[0].metadata as Ligne).musiqueIgnoree).toBe(true);
  });

  it('BATCH_RENDER_DESACTIVE reste vrai', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('aucun fournisseur d affiche IA appelé', async () => {
    await passage();
    expect(genererAfficheReference).not.toHaveBeenCalled();
  });
});
