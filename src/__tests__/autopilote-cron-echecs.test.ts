import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ÉCHECS DU CRON AUTOPILOTE — rotation, banque de rushes, message visible.
 *
 * Mêmes doublures que `autopilote-cron-jumeau.test.ts` (base en mémoire,
 * rendu et fournisseurs simulés) ; ici le jumeau est DÉSACTIVÉ et c'est le
 * montage ordinaire — rush → rendu → post — qui échoue.
 *
 * Trois défauts confirmés :
 *   1. Un rush qui fait échouer le rendu bloquait l'Autopilote POUR TOUJOURS :
 *      `last_rush_url` n'avançait qu'en cas de succès, donc `pickRush`
 *      reprenait le même rush à chaque passage.
 *   2. Le retrait des rushes morts réécrivait `rush_urls` à partir de la
 *      banque lue AU DÉBUT du cycle (plusieurs minutes de rendu plus tôt) :
 *      un rush ajouté entre-temps par l'utilisateur était effacé.
 *   3. Un montage raté n'était dit qu'aux journaux du serveur.
 * *
 * AUCUN appel réel — ni rendu, ni fournisseur, ni publication.
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
const notifyOnce = vi.fn(async (..._a: unknown[]) => ({ created: true }));
vi.mock('@/lib/notifications/store', () => ({
  notifyOnce: (...a: unknown[]) => notifyOnce(...a),
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
/** Rushes dont le rendu échoue (fichier corrompu, codec refusé par Chromium…). */
let rushesIllisibles = new Set<string>();
/** Action exécutée PENDANT le rendu — simule l'utilisateur qui agit en parallèle. */
let pendantLeRendu: (() => void) | null = null;
const renderAndUpload = vi.fn(async (i: { jobId: string; design: Ligne }) => {
  pendantLeRendu?.();
  if (rushesIllisibles.has(String(i.design.videoUrl))) {
    throw new Error('Error while rendering: le décodeur a refusé le rush');
  }
  return {
    videoUrl: 'https://minio.test/videos/u1/rendu.mp4', thumbnailUrl: 'https://minio.test/images/v.jpg', durationFrames: 900,
  };
});
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
const JOUR = 24 * 60 * 60 * 1000;
const A = 'https://minio.test/rushes/u1/a.mp4';
const B = 'https://minio.test/rushes/u1/b.mp4';
const C = 'https://minio.test/rushes/u1/c.mp4';

const config = (p: Ligne = {}): Ligne => ({
  user_id: 'u1', enabled: true, mode: 'review', cadence: 'daily', count_per_cycle: 1,
  platforms: ['instagram'], credit_floor: 0, rush_urls: [A, B],
  topics: ['yoga'], run_hour: 8, run_timezone: 'Europe/Paris', publish_time: '18:00',
  last_run_at: null, last_rush_url: null, voice_enabled: false, jumeau_avatar: false, ...p,
});

async function passage(now = PASSAGE) {
  vi.setSystemTime(now);
  const { GET } = await import('@/app/api/cron/autopilot/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('http://localhost/api/cron/autopilot', { headers: { authorization: 'Bearer s' } }));
  return res.json();
}
const ligne = () => tables.autopilot_config[0];
const posts = () => tables.scheduled_posts ?? [];
const rushRendus = () => renderAndUpload.mock.calls.map((c) => c[0].design.videoUrl);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.resetModules();
  process.env.CRON_SECRET = 's';
  tables = { autopilot_config: [config()], scheduled_posts: [], users: [{ id: 'u1', email: null }] };
  solde = 1000;
  absentes = new Set();
  rushesIllisibles = new Set();
  pendantLeRendu = null;
  vi.clearAllMocks();
  avancer.mockImplementation(async () => ({ status: 'processing', videoUrl: null }));
});

describe('1. Un rush qui fait échouer le rendu ne bloque plus la rotation', () => {
  it('échec sur A → le passage suivant prend B (et non A à nouveau)', async () => {
    rushesIllisibles.add(A);
    const r1 = await passage();
    expect(r1.echecs).toBe(1);
    expect(rushRendus()).toEqual([A]);
    // Rien produit : la cadence n'avance pas (le créneau sera retenté)…
    expect(ligne().last_run_at).toBeNull();
    // …mais la rotation, elle, passe le rush qui vient d'échouer.
    expect(ligne().last_rush_url).toBe(A);

    const r2 = await passage(PASSAGE + JOUR);
    expect(rushRendus()).toEqual([A, B]);
    expect(r2.rendus).toBe(1);
    expect(posts()).toHaveLength(1);
  });

  it('succès → comportement inchangé : last_run_at et last_rush_url avancent', async () => {
    await passage();
    expect(rushRendus()).toEqual([A]);
    expect(ligne().last_rush_url).toBe(A);
    expect(ligne().last_run_at).toBe(new Date(PASSAGE).toISOString());
  });

  it('échec → aucun post déposé, rien débité', async () => {
    rushesIllisibles.add(A);
    await passage();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });
});

describe('2. Le retrait des rushes morts n efface pas un rush ajouté pendant le cycle', () => {
  it('A disparu du stockage, C ajouté pendant le rendu → banque = [B, C]', async () => {
    absentes.add(A);
    pendantLeRendu = () => {
      const banque = ligne().rush_urls as string[];
      if (!banque.includes(C)) ligne().rush_urls = [...banque, C];
    };
    await passage();
    expect(ligne().rush_urls).toEqual([B, C]);
  });

  it('sans ajout concurrent → même résultat qu avant : A retiré', async () => {
    absentes.add(A);
    await passage();
    expect(ligne().rush_urls).toEqual([B]);
  });
});

describe('3. Un montage raté est DIT à l utilisateur', () => {
  it('échec → une notification « autopilote-echec », sans promettre de débit', async () => {
    rushesIllisibles.add(A);
    await passage();
    const appels = notifyOnce.mock.calls.map((c) => c[0] as Record<string, string>);
    const echec = appels.find((n) => n.kind === 'autopilote-echec');
    expect(echec).toBeDefined();
    expect(echec!.userId).toBe('u1');
    expect(echec!.body).toMatch(/aucun crédit/i);
    expect(echec!.href).toBe('/dashboard/creer?panneau=autopilote');
  });

  it('succès → aucune notification d échec', async () => {
    await passage();
    const kinds = notifyOnce.mock.calls.map((c) => (c[0] as Record<string, string>).kind);
    expect(kinds).not.toContain('autopilote-echec');
  });
});

describe('4. Un montage-jumeau abandonné est DIT à l utilisateur', () => {
  it('génération en échec → notification « autopilote-jumeau-echec »', async () => {
    tables.autopilot_config = [config({ jumeau_avatar: true })];
    await passage();
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    avancer.mockImplementation(async () => ({ status: 'failed', error: 'Le fournisseur a refusé la vidéo.' }));
    await passage(PASSAGE + 5 * 60_000);
    const echec = notifyOnce.mock.calls
      .map((c) => c[0] as Record<string, string>)
      .find((n) => n.kind === 'autopilote-jumeau-echec');
    expect(echec).toBeDefined();
    expect(echec!.body).toContain('Le fournisseur a refusé la vidéo.');
    // Le créneau ne reste pas vide : montage de repli SANS jumeau, dit en métadonnées.
    expect(posts()).toHaveLength(1);
    expect((posts()[0].metadata as Ligne).jumeauIgnore).toBe(true);
  });
});
