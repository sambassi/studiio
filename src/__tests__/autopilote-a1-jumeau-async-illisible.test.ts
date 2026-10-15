import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PR A1 — LA FILE JUMEAU face à un jumeau dont la DURÉE est illisible.
 *
 * `produireUnMontage` lève `JumeauIllisibleError` AVANT tout rendu et tout
 * débit. La file doit : réessayer quelques passes (stockage passager), puis
 * clore avec un message clair ; JAMAIS monter le créneau sans l'avatar
 * (`rendreSansJumeau`), jamais relancer de génération, jamais rendre deux fois.
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
  const avant: Record<string, string> = {};
  const avantOk = (r: Record<string, unknown>) => Object.entries(avant).every(([k, v]) => String(r[k] ?? '') < v);
  let dansStatut: string[] | undefined;
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (k: string, v: unknown) => { filtres[k] = v; return api; },
    in: (k: string, vals: string[]) => { if (k === 'statut') dansStatut = vals; return api; },
    order: () => api,
    lt: (k: string, v: string) => { avant[k] = v; return api; },
    limit: (n: number) => ({ data: rows.filter((r) => matches(r, filtres, dansStatut) && avantOk(r)).slice(0, n), error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter((r) => matches(r, filtres, dansStatut)), error: null }),
  };
  return api;
}

function updateQuery(patch: Record<string, unknown>) {
  const filtres: Record<string, unknown> = {};
  const avant: Record<string, string> = {};
  let dansStatut: string[] | undefined;
  const appliquer = () => {
    const hit = rows.filter((r) => matches(r, filtres, dansStatut) && Object.entries(avant).every(([k, v]) => String(r[k] ?? '') < v));
    hit.forEach((r) => Object.assign(r, patch));
    return hit;
  };
  const api: Record<string, unknown> = {
    eq: (k: string, v: unknown) => { filtres[k] = v; return api; },
    in: (k: string, vals: string[]) => { if (k === 'statut') dansStatut = vals; return api; },
    lt: (k: string, v: string) => { avant[k] = v; return api; },
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

function deleteQuery() {
  const filtres: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    eq: (k: string, v: unknown) => { filtres[k] = v; return api; },
    then: (resolve: (v: unknown) => void) => {
      rows = rows.filter((r) => !matches(r, filtres));
      resolve({ data: null, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => selectQuery(),
      update: (patch: Record<string, unknown>) => updateQuery(patch),
      insert: (data: Record<string, unknown>) => insertQuery(data),
      delete: () => deleteQuery(),
    }),
  },
  supabase: { from: () => ({}) },
}));

// ── Dépendances doublées ────────────────────────────────────────────────────
const genererVideoJumeau = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const reconcilierLancement = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/avatar/moteur-jumeau', () => ({
  genererVideoJumeau: (...a: unknown[]) => genererVideoJumeau(...a),
  reconcilierLancement: (...a: unknown[]) => reconcilierLancement(...a),
}));

const avancer = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/avatar/statut', () => ({
  avancerStatutGeneration: (...a: unknown[]) => avancer(...a),
}));

const notifyOnce = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/notifications/store', () => ({ notifyOnce: (...a: unknown[]) => notifyOnce(...a) }));

const produireUnMontage = vi.fn(async (_a: Record<string, unknown>) => ({ postId: 'post-1' }));
vi.mock('@/lib/autopilot/produire', () => ({
  produireUnMontage: (...a: unknown[]) => produireUnMontage(...(a as [Record<string, unknown>])),
  creneauxExistants: async () => new Set<string>(),
}));

import { finaliserJumeauxPrets, ESSAIS_MESURE_JUMEAU } from '@/lib/autopilot/jumeau-async';
import { JumeauIllisibleError, MESSAGE_JUMEAU_ILLISIBLE } from '@/lib/autopilot/duree-jumeau';

const VIDEO = 'https://studiio.pro/storage/v1/object/public/media/u1/avatar/c0ffee00-3333-4333-8333-333333333333.mp4';

function enFile(over: Partial<Record<string, unknown>> = {}) {
  rows.push({
    id: 'att-1', user_id: 'u1', generation_id: 'gen-1', slot_key: 'cron:u1|2026-08-05|09:00',
    job_id: 'job-1', statut: 'en_attente', snapshot: { config: { x: 1 }, post: { title: 't' }, rang: 0, now: 1 }, tentatives: 0,
    ...over,
  });
}

/** Tous les appels ont-ils monté l'avatar, sur le MÊME job (débit idempotent) ? */
function appelsAvecAvatar() {
  return produireUnMontage.mock.calls.map(([a]) => ({ jumeau: (a as Record<string, unknown>).jumeauVideoUrl, job: (a as Record<string, unknown>).jobId }));
}

describe('A1 — file jumeau : durée illisible', () => {
  beforeEach(() => {
    rows = [];
    vi.clearAllMocks();
    avancer.mockResolvedValue({ status: 'completed', videoUrl: VIDEO });
  });

  it('1er échec de mesure → ligne ROUVERTE (compteur 1), aucun montage sans avatar, aucune notification', async () => {
    enFile();
    produireUnMontage.mockRejectedValueOnce(new JumeauIllisibleError(VIDEO));
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res).toEqual({ examines: 1, rendus: 0, encore: 1, echecs: 0 });
    expect(rows[0].statut).toBe('en_attente');
    expect((rows[0].snapshot as Record<string, unknown>).echecsMesureJumeau).toBe(1);
    // Le reste du snapshot est intact.
    expect((rows[0].snapshot as Record<string, unknown>).config).toEqual({ x: 1 });
    expect(appelsAvecAvatar()).toEqual([{ jumeau: VIDEO, job: 'job-1' }]);
    expect(notifyOnce).not.toHaveBeenCalled();
    expect(genererVideoJumeau).not.toHaveBeenCalled();
  });

  it('REPRISE : la passe suivante mesure enfin → rendu AVEC l’avatar, même job (pas de double débit), ligne « rendu »', async () => {
    enFile();
    produireUnMontage.mockRejectedValueOnce(new JumeauIllisibleError(VIDEO));
    await finaliserJumeauxPrets({ max: 5 });
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.rendus).toBe(1);
    expect(rows[0].statut).toBe('rendu');
    expect(rows[0].post_id).toBe('post-1');
    expect(appelsAvecAvatar()).toEqual([{ jumeau: VIDEO, job: 'job-1' }, { jumeau: VIDEO, job: 'job-1' }]);
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    expect(notifyOnce).not.toHaveBeenCalled();
    // Ligne close : une passe de plus n'y touche plus.
    produireUnMontage.mockClear();
    expect((await finaliserJumeauxPrets({ max: 5 })).examines).toBe(0);
    expect(produireUnMontage).not.toHaveBeenCalled();
  });

  it(`${ESSAIS_MESURE_JUMEAU} échecs → « echec » avec le message clair, notification, JAMAIS de montage sans avatar`, async () => {
    enFile();
    produireUnMontage.mockRejectedValue(new JumeauIllisibleError(VIDEO));
    for (let i = 0; i < ESSAIS_MESURE_JUMEAU; i += 1) await finaliserJumeauxPrets({ max: 5 });
    expect(rows[0].statut).toBe('echec');
    expect(rows[0].motif).toBe(MESSAGE_JUMEAU_ILLISIBLE);
    expect(produireUnMontage).toHaveBeenCalledTimes(ESSAIS_MESURE_JUMEAU);
    expect(appelsAvecAvatar().every((a) => a.jumeau === VIDEO)).toBe(true); // aucun repli sans jumeau
    expect(notifyOnce).toHaveBeenCalledTimes(1);
    expect(String((notifyOnce.mock.calls[0][0] as Record<string, unknown>).body)).toContain(MESSAGE_JUMEAU_ILLISIBLE);
    expect(genererVideoJumeau).not.toHaveBeenCalled();
    // Close : plus jamais reprise.
    produireUnMontage.mockClear();
    expect((await finaliserJumeauxPrets({ max: 5 })).examines).toBe(0);
    expect(produireUnMontage).not.toHaveBeenCalled();
  });

  it('plafond général MAX_TENTATIVES atteint au 1er échec de mesure → close tout de suite', async () => {
    enFile({ tentatives: 39 });
    produireUnMontage.mockRejectedValueOnce(new JumeauIllisibleError(VIDEO));
    const res = await finaliserJumeauxPrets({ max: 5 });
    expect(res.echecs).toBe(1);
    expect(rows[0].statut).toBe('echec');
    expect(rows[0].motif).toBe(MESSAGE_JUMEAU_ILLISIBLE);
  });

  it('deux passes SIMULTANÉES sur le même créneau → un seul rendu (claim atomique)', async () => {
    enFile();
    produireUnMontage.mockRejectedValueOnce(new JumeauIllisibleError(VIDEO));
    const [a, b] = await Promise.all([finaliserJumeauxPrets({ max: 5 }), finaliserJumeauxPrets({ max: 5 })]);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(a.encore + b.encore).toBe(1);
    expect(rows).toHaveLength(1);
    expect((rows[0].snapshot as Record<string, unknown>).echecsMesureJumeau).toBe(1);
  });

  it('une autre erreur que la durée reste sur le chemin d’avant (transitoire, sans compteur)', async () => {
    enFile();
    produireUnMontage.mockRejectedValueOnce(new Error('ECONNRESET'));
    await finaliserJumeauxPrets({ max: 5 });
    expect(rows[0].statut).toBe('en_attente');
    expect((rows[0].snapshot as Record<string, unknown>).echecsMesureJumeau).toBeUndefined();
  });
});
