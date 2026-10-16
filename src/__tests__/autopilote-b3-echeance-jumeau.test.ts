import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * B3 — LE JUMEAU EN RETARD NE BLOQUE PLUS LA PUBLICATION EN SILENCE.
 *
 * Échéance de décision = heure réelle de publication du créneau (date + heure
 * + fuseau de la configuration) − marge de montage. Tout est simulé : aucune
 * base, aucun fournisseur, aucun rendu.
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
const abandonnerGenerationJumeau = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/avatar/moteur-jumeau', () => ({
  genererVideoJumeau: (...a: unknown[]) => genererVideoJumeau(...a),
  reconcilierLancement: (...a: unknown[]) => reconcilierLancement(...a),
  abandonnerGenerationJumeau: (...a: unknown[]) => abandonnerGenerationJumeau(...a),
}));

const avancer = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/avatar/statut', () => ({
  avancerStatutGeneration: (...a: unknown[]) => avancer(...a),
}));

const produireUnMontage = vi.fn(async (a: Record<string, unknown>) => {
  // Le rendu DÉPOSE le post du créneau (comme `scheduled_posts`).
  creneauxAvecPost.add(String(a.slotKey));
  return { postId: 'post-1' };
});
/** Créneaux ayant DÉJÀ un post (simule `scheduled_posts`). */
let creneauxAvecPost: Set<string> = new Set();
vi.mock('@/lib/autopilot/produire', () => ({
  produireUnMontage: (...a: unknown[]) => produireUnMontage(...(a as [Record<string, unknown>])),
  creneauxExistants: async () => creneauxAvecPost,
}));

const notifyOnce = vi.fn(async (_a: Record<string, unknown>) => ({ created: true, persisted: true }));
vi.mock('@/lib/notifications/store', () => ({
  notifyOnce: (a: Record<string, unknown>) => notifyOnce(a),
}));

import { finaliserJumeauxPrets, PLAFOND_SUIVI_JUMEAU_MS, DELAI_ABANDON_EN_COURS_MS } from '@/lib/autopilot/jumeau-async';
import {
  MARGE_PRODUCTION_JUMEAU_MS, echeanceDecisionJumeau, instantLocal, instantPublicationCreneau,
} from '@/lib/autopilot/echeance-jumeau';

// Créneau publié le 17/10/2026 à 18:00, Paris (UTC+2 en octobre 2026) → 16:00Z.
const PUB = Date.parse('2026-10-17T16:00:00Z');
const ECHEANCE = PUB - MARGE_PRODUCTION_JUMEAU_MS; // 15:40Z
const SLOT = 'u1|2026-10-17|18:00';

function post(date = '2026-10-17', time = '18:00') {
  return {
    title: 'Routine', caption: '', scheduledDate: date, scheduledTime: time, platforms: ['instagram'],
    rushUrl: null, content: { subtitle: '', cards: [], tagLine: 'Go' },
  };
}

function enFile(over: { mode?: string; politiqueRepli?: string; createdAt?: string; tentatives?: number; date?: string; time?: string; slot?: string } = {}) {
  rows.push({
    id: 'att-1', user_id: 'u1', generation_id: 'gen-1', slot_key: over.slot ?? SLOT, job_id: 'job-1', statut: 'en_attente',
    snapshot: {
      config: { mode: over.mode ?? 'auto', runTimezone: 'Europe/Paris', platforms: ['instagram'] },
      post: post(over.date, over.time), rang: 0, now: 1,
      ...(over.politiqueRepli ? { politiqueRepli: over.politiqueRepli } : null),
    },
    tentatives: over.tentatives ?? 0,
    created_at: over.createdAt ?? '2026-10-17T06:00:00Z',
    updated_at: over.createdAt ?? '2026-10-17T06:00:00Z',
  });
}

const enCours = { status: 'processing', videoUrl: null };
const pret = { status: 'completed', videoUrl: 'https://minio/u1/avatar/gen-1.mp4' };
const arg = (i = 0) => produireUnMontage.mock.calls[i][0] as Record<string, any>;
const a = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  rows = []; creneauxAvecPost = new Set(); vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); });

describe('B3 — échéance calculée depuis l’heure réelle de publication', () => {
  it('date + heure + fuseau du créneau, moins la marge de montage', () => {
    expect(instantLocal('2026-10-17', '18:00', 'Europe/Paris')).toBe(PUB);
    expect(instantLocal('2026-12-17', '18:00:00', 'Europe/Paris')).toBe(Date.parse('2026-12-17T17:00:00Z')); // UTC+1
    expect(instantLocal('2026-10-17', '18:00', 'America/New_York')).toBe(Date.parse('2026-10-17T22:00:00Z'));
    expect(instantLocal('2026-10-17', '18:00', 'Pas/UnFuseau')).toBe(PUB); // repli Paris, comme le cron de publication
    const snap = { config: { mode: 'auto', runTimezone: 'Europe/Paris' }, post: post() };
    expect(echeanceDecisionJumeau(snap)).toBe(ECHEANCE);
    expect(MARGE_PRODUCTION_JUMEAU_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
    // Brouillon : rien ne part seul, aucune échéance.
    expect(instantPublicationCreneau({ ...snap, config: { mode: 'review', runTimezone: 'Europe/Paris' } })).toBeNull();
  });
});

describe('B3 — finalisation face à l’échéance', () => {
  it('jumeau prêt AVANT l’échéance → production normale avec avatar', async () => {
    enFile(); a('2026-10-17T15:00:00Z');
    avancer.mockResolvedValue(pret);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(arg().jumeauVideoUrl).toBe(pret.videoUrl);
    expect(arg().config.mode).toBe('auto');
    expect(notifyOnce).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('rendu');
  });

  it('en cours, AVANT l’échéance → on attend encore (rien produit, rien signalé)', async () => {
    enFile(); a('2026-10-17T15:39:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(notifyOnce).not.toHaveBeenCalled();
  });

  it('pas prêt à l’échéance + repli autorisé (défaut) → version sans avatar AVANT l’heure de publication, une notification, aucun remboursement', async () => {
    enFile(); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    expect(Date.now()).toBeLessThan(PUB);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(arg().jumeauVideoUrl).toBeUndefined();
    expect(arg().metadataSupplement).toMatchObject({ jumeauIgnore: true, jumeauIgnoreMotif: 'jumeau en retard' });
    // Calendrier inchangé : même créneau, même post, publication programmée.
    expect(arg().post).toMatchObject({ scheduledDate: '2026-10-17', scheduledTime: '18:00' });
    expect(arg().config).toMatchObject({ mode: 'auto', runTimezone: 'Europe/Paris' });
    expect(arg().jobId).toBe('job-1');
    expect(notifyOnce).toHaveBeenCalledTimes(1);
    expect(String(notifyOnce.mock.calls[0][0].body)).toContain('Votre avatar n’était pas prêt à temps : la vidéo du 17/10/2026 à 18:00 a été produite sans avatar');
    // Fournisseur encore « processing » : la génération N'EST PAS close ni remboursée, elle reste suivie.
    expect(abandonnerGenerationJumeau).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');

    // Passe suivante, toujours en cours : ni second rendu, ni seconde notification.
    a('2026-10-17T15:46:00Z');
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(notifyOnce).toHaveBeenCalledTimes(1);
    expect(abandonnerGenerationJumeau).not.toHaveBeenCalled();
  });

  it('jumeau livré APRÈS le repli → aucune seconde vidéo ni second post', async () => {
    enFile(); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    a('2026-10-17T16:30:00Z');
    avancer.mockResolvedValue(pret);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(rows[0].statut).toBe('rendu');
    expect(abandonnerGenerationJumeau).not.toHaveBeenCalled();
  });

  it('génération en échec APRÈS le repli → pas de second montage, ligne close', async () => {
    enFile(); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    avancer.mockResolvedValue({ status: 'failed', error: 'HeyGen échec', rembourse: true });
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(rows[0].statut).toBe('echec');
  });

  it('deux passes concurrentes à l’échéance → un seul repli, une seule notification', async () => {
    enFile(); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await Promise.all([finaliserJumeauxPrets(), finaliserJumeauxPrets()]);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(notifyOnce).toHaveBeenCalledTimes(1);
  });

  it('crash après le repli (ligne restée en cours) → reprise SANS clore : la génération reste suivie', async () => {
    enFile(); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    rows[0].statut = 'en_cours'; rows[0].updated_at = '2026-10-17T15:41:00Z';
    a(new Date(Date.parse('2026-10-17T15:41:00Z') + DELAI_ABANDON_EN_COURS_MS + 60_000).toISOString());
    await finaliserJumeauxPrets();
    expect(rows[0].statut).toBe('en_attente');
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
  });

  it('pas prêt + repli NON autorisé (`suspendre`) → aucune vidéo, créneau en attente signalé une fois, puis brouillon si livré en retard', async () => {
    enFile({ politiqueRepli: 'suspendre' }); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');
    expect(notifyOnce).toHaveBeenCalledTimes(1);
    expect(String(notifyOnce.mock.calls[0][0].body)).toContain('Avatar en retard chez le fournisseur : la publication du 17/10/2026 à 18:00 est suspendue');
    expect(abandonnerGenerationJumeau).not.toHaveBeenCalled();

    a('2026-10-17T16:10:00Z');
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(notifyOnce).toHaveBeenCalledTimes(1);

    // Livré APRÈS l'heure : jamais publié en retard en silence → brouillon, même créneau.
    avancer.mockResolvedValue(pret);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(arg().jumeauVideoUrl).toBe(pret.videoUrl);
    expect(arg().config.mode).toBe('review');
    expect(arg().post).toMatchObject({ scheduledDate: '2026-10-17', scheduledTime: '18:00' });
    expect(arg().metadataSupplement).toMatchObject({ publicationSuspendue: 'jumeau en retard', jumeau: true });
  });

  it('rendu tardif : la notification « prête en brouillon » part APRÈS le rendu réussi, jamais si le rendu échoue', async () => {
    enFile({ politiqueRepli: 'suspendre' }); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    expect(notifyOnce).toHaveBeenCalledTimes(1); // signalement de suspension

    a('2026-10-17T16:10:00Z');
    avancer.mockResolvedValue(pret);
    produireUnMontage.mockRejectedValueOnce(new Error('rendu impossible'));
    await finaliserJumeauxPrets().catch(() => undefined);
    expect(notifyOnce).toHaveBeenCalledTimes(1); // rendu raté : aucune annonce de brouillon

    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(2);
    expect(notifyOnce).toHaveBeenCalledTimes(2);
    expect(String(notifyOnce.mock.calls[1][0].body)).toContain('prête en brouillon');
  });

  it('`suspendre` + génération en échec → aucune version dégradée', async () => {
    enFile({ politiqueRepli: 'suspendre' }); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue({ status: 'failed', error: 'HeyGen échec', rembourse: true });
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('echec');
  });

  it('réglages par défaut (production 8 h, publication J+1 18 h) → attente longue inchangée', async () => {
    enFile({ date: '2026-10-18', slot: 'u1|2026-10-18|18:00' }); // créée le 17 à 08:00 Paris
    avancer.mockResolvedValue(enCours);
    a('2026-10-17T17:00:00Z'); // 11 h d'attente, bien avant l'échéance (18/10 15:40Z)
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(notifyOnce).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');
    // Au-delà du plafond B1 (12 h 10) et des 40 passes : l'issue d'avant (B2), inchangée.
    rows[0].tentatives = 39;
    a(new Date(Date.parse('2026-10-17T06:00:00Z') + PLAFOND_SUIVI_JUMEAU_MS + 60_000).toISOString());
    await finaliserJumeauxPrets();
    expect(abandonnerGenerationJumeau).toHaveBeenCalledTimes(1);
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(arg().metadataSupplement).toMatchObject({ jumeauIgnoreMotif: 'jumeau non abouti' });
    expect(arg().config.mode).toBe('auto'); // toujours avant l'heure de publication
  });

  it('mode review (brouillon) → aucune échéance, aucune publication : attente inchangée', async () => {
    enFile({ mode: 'review' }); a('2026-10-17T15:41:00Z');
    avancer.mockResolvedValue(enCours);
    await finaliserJumeauxPrets();
    a('2026-10-17T17:00:00Z');
    await finaliserJumeauxPrets();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(notifyOnce).not.toHaveBeenCalled();
    expect(rows[0].statut).toBe('en_attente');
    avancer.mockResolvedValue(pret);
    await finaliserJumeauxPrets();
    expect(produireUnMontage).toHaveBeenCalledTimes(1);
    expect(arg().config.mode).toBe('review');
    expect(arg().metadataSupplement.publicationSuspendue).toBeUndefined();
  });
});
