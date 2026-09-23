import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * LE JUMEAU DANS L'AUTOPILOTE, SANS NAVIGATEUR — la file en deux temps.
 *
 * On ne rend pas de vraie vidéo ; on vérifie le CÂBLAGE que l'utilisateur
 * exige : quand la génération est prête, le montage est rendu AVEC la vidéo du
 * jumeau ; quand elle échoue, le créneau n'est pas vide — montage SANS jumeau,
 * dit explicitement (`jumeauIgnore`), et la ligne passe en échec.
 */

// ── File en mémoire (autopilot_jumeau_attente) ─────────────────────────────
let rows: Array<Record<string, unknown>>;

function matches(r: Record<string, unknown>, filtres: Record<string, unknown>, dansStatut?: string[]): boolean {
  for (const [k, v] of Object.entries(filtres)) if (r[k] !== v) return false;
  if (dansStatut && !dansStatut.includes(String(r.statut))) return false;
  return true;
}

function selectQuery() {
  const filtres: Record<string, unknown> = {};
  let dansStatut: string[] | undefined;
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (k: string, v: unknown) => { filtres[k] = v; return api; },
    in: (k: string, vals: string[]) => { if (k === 'statut') dansStatut = vals; return api; },
    order: () => api,
    limit: (n: number) => ({ data: rows.filter((r) => matches(r, filtres, dansStatut)).slice(0, n), error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter((r) => matches(r, filtres, dansStatut)), error: null }),
  };
  return api;
}

function updateQuery(patch: Record<string, unknown>) {
  const filtres: Record<string, unknown> = {};
  let dansStatut: string[] | undefined;
  const appliquer = () => {
    const hit = rows.filter((r) => matches(r, filtres, dansStatut));
    hit.forEach((r) => Object.assign(r, patch));
    return hit;
  };
  const api: Record<string, unknown> = {
    eq: (k: string, v: unknown) => { filtres[k] = v; return api; },
    in: (k: string, vals: string[]) => { if (k === 'statut') dansStatut = vals; return api; },
    select: () => ({ data: appliquer().map((r) => ({ id: r.id })), error: null }),
    then: (resolve: (v: unknown) => void) => { appliquer(); resolve({ data: null, error: null }); },
  };
  return api;
}

function insertQuery(data: Record<string, unknown>) {
  return {
    select: () => ({
      single: () => {
        // Unicité (user_id, slot_key).
        if (rows.some((r) => r.user_id === data.user_id && r.slot_key === data.slot_key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const row = { id: `att-${rows.length + 1}`, ...data };
        rows.push(row);
        return { data: { id: row.id }, error: null };
      },
    }),
  };
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => selectQuery(),
      update: (patch: Record<string, unknown>) => updateQuery(patch),
      insert: (data: Record<string, unknown>) => insertQuery(data),
    }),
  },
  supabase: { from: () => ({}) },
}));

// ── Dépendances doublées ────────────────────────────────────────────────────
const genererVideoJumeau = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/avatar/moteur-jumeau', () => ({
  genererVideoJumeau: (...a: unknown[]) => genererVideoJumeau(...a),
}));

const avancer = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/avatar/statut', () => ({
  avancerStatutGeneration: (...a: unknown[]) => avancer(...a),
}));

const produireUnMontage = vi.fn(async (_a: Record<string, unknown>) => ({ postId: 'post-1' }));
vi.mock('@/lib/autopilot/produire', () => ({
  produireUnMontage: (...a: unknown[]) => produireUnMontage(...(a as [Record<string, unknown>])),
}));

import {
  scriptJumeauMontage, lancerJumeauMontage, finaliserJumeauxPrets, estMediaIntrouvable,
} from '@/lib/autopilot/jumeau-async';

const post = {
  title: 'Routine du matin',
  content: { subtitle: 'Trois gestes', cards: [], tagLine: 'On commence ?' },
  brief: { message: 'Rejoins le cours' },
  rushUrl: null,
} as unknown as Parameters<typeof scriptJumeauMontage>[0];

function enFile(over: Partial<Record<string, unknown>> = {}) {
  rows.push({
    id: 'att-1', user_id: 'u1', generation_id: 'gen-1', slot_key: 'manuel:u1|2026-08-05|09:00',
    job_id: 'job-1', statut: 'en_attente', snapshot: { config: { x: 1 }, post, rang: 0, now: 1 }, tentatives: 0,
    ...over,
  });
}

describe('scriptJumeauMontage', () => {
  it('assemble un script concis, distinct, borné, dédoublonné', () => {
    const s = scriptJumeauMontage(post);
    expect(s).toContain('Rejoins le cours');
    expect(s).toContain('Routine du matin');
    expect(s).toContain('On commence ?');
    expect(s.length).toBeLessThanOrEqual(600);
  });
});

describe('lancerJumeauMontage', () => {
  beforeEach(() => { rows = []; vi.clearAllMocks(); });

  it('lance la génération et met le montage en file', async () => {
    genererVideoJumeau.mockResolvedValue({ ok: true, generationId: 'gen-9' });
    const r = await lancerJumeauMontage({
      userId: 'u1', config: { a: 1 } as never, post, rang: 0, now: 1,
      jobId: 'job-1', slotKey: 'slot-1',
    });
    expect(r.ok).toBe(true);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].generation_id).toBe('gen-9');
  });

  it('idempotent par créneau : déjà en file → ne relance pas', async () => {
    enFile({ slot_key: 'slot-1', generation_id: 'gen-x' });
    const r = await lancerJumeauMontage({
      userId: 'u1', config: {} as never, post, rang: 0, now: 1, jobId: 'job-1', slotKey: 'slot-1',
    });
    expect(r).toMatchObject({ ok: true, dejaEnFile: true, generationId: 'gen-x' });
    expect(genererVideoJumeau).not.toHaveBeenCalled();
  });

  it('moteur indisponible : pas de file, motif rendu', async () => {
    genererVideoJumeau.mockResolvedValue({ ok: false, motif: 'moteur_indisponible', message: 'Indispo.' });
    const r = await lancerJumeauMontage({
      userId: 'u1', config: {} as never, post, rang: 0, now: 1, jobId: 'job-1', slotKey: 'slot-1',
    });
    expect(r).toMatchObject({ ok: false, motif: 'moteur_indisponible' });
    expect(rows).toHaveLength(0);
  });
});

describe('finaliserJumeauxPrets', () => {
  beforeEach(() => { rows = []; vi.clearAllMocks(); });

  it('génération prête → monte la vidéo du jumeau et marque « rendu »', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio/u1/avatar/gen-1.mp4' });
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.rendus).toBe(1);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    const arg = produireUnMontage.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.jumeauVideoUrl).toBe('https://minio/u1/avatar/gen-1.mp4');
    expect((arg.metadataSupplement as Record<string, unknown>).jumeau).toBe(true);
    expect(rows[0].statut).toBe('rendu');
  });

  it('génération encore en cours → laisse en file (rien rendu)', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'processing', videoUrl: null });
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.encore).toBe(1);
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');
  });

  it('génération en échec → montage SANS jumeau, dit explicitement, et « echec »', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'failed', videoUrl: null, error: 'D-ID échec.', rembourse: true });
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.echecs).toBe(1);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    const arg = produireUnMontage.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.jumeauVideoUrl).toBeUndefined();
    expect((arg.metadataSupplement as Record<string, unknown>).jumeauIgnore).toBe(true);
    expect(rows[0].statut).toBe('echec');
  });

  it('erreur transitoire du poll → laisse en file pour réessai', async () => {
    enFile();
    avancer.mockRejectedValue(new Error('D-ID 503'));
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.encore).toBe(1);
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');
  });
});

describe('Média introuvable (404) : échec DÉFINITIF, jamais une boucle', () => {
  beforeEach(() => { rows = []; vi.clearAllMocks(); });

  /** Message observé en production, à l'identifiant près. */
  const ERREUR_404 = 'Error while downloading https://studiio.pro/storage/v1/object/public/audio/u1/music/'
    + '1785349032107-black_attacka.mp3: HTTP 404 {"error":"not found"}';

  it('jumeau prêt mais musique 404 : ligne close en « echec », une seule tentative', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio/u1/avatar/gen-1.mp4' });
    produireUnMontage.mockRejectedValueOnce(new Error(ERREUR_404));

    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res).toEqual({ examines: 1, rendus: 0, encore: 0, echecs: 1 });
    expect(rows[0].statut).toBe('echec');
    expect(String(rows[0].motif)).toContain('404');
    expect(rows[0].tentatives).toBe(1);
    // Le jumeau prêt a été RÉUTILISÉ : aucune nouvelle génération.
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect((produireUnMontage.mock.calls[0][0] as Record<string, unknown>).jumeauVideoUrl)
      .toBe('https://minio/u1/avatar/gen-1.mp4');
  });

  it('la passe suivante ne reprend PAS la ligne : ni poll, ni rendu, ni post', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio/u1/avatar/gen-1.mp4' });
    produireUnMontage.mockRejectedValueOnce(new Error(ERREUR_404));
    await finaliserJumeauxPrets({ max: 5 });
    vi.clearAllMocks();

    for (let i = 0; i < 3; i += 1) {
      const res = await finaliserJumeauxPrets({ max: 5 });
      expect(res.examines).toBe(0);
    }
    expect(avancer).not.toHaveBeenCalled();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(rows[0].tentatives).toBe(1);
  });

  it('une panne réseau du rendu reste transitoire : la ligne est rouverte', async () => {
    enFile();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: 'https://minio/u1/avatar/gen-1.mp4' });
    produireUnMontage.mockRejectedValueOnce(new Error('Error while downloading https://x/a.mp3: ECONNRESET'));
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.encore).toBe(1);
    expect(rows[0].statut).toBe('en_attente');
  });

  it('classement : 404/410 au téléchargement seulement', () => {
    expect(estMediaIntrouvable(ERREUR_404)).toBe(true);
    expect(estMediaIntrouvable('Error while downloading https://x/v.mp4: Received a status code of 410')).toBe(true);
    // Pas un téléchargement.
    expect(estMediaIntrouvable('D-ID 404')).toBe(false);
    // Téléchargement, mais « 404 » fondu dans un identifiant.
    expect(estMediaIntrouvable('Error while downloading https://x/u/music/1404-a.mp3: ETIMEDOUT')).toBe(false);
    expect(estMediaIntrouvable('Error while downloading https://x/a.mp3: HTTP 503')).toBe(false);
  });
});
