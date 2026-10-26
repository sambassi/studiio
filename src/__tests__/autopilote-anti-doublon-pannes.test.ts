import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';

/**
 * ANTI-DOUBLON ET PANNES POSTGRESQL — `produireUnMontage` complet (base, crédits, rendu doublés).
 *
 * Prouve : lecture des créneaux en échec → rien n'est lancé ni débité ; panne de la base des baux →
 * aucun contournement silencieux ; bail perdu/expiré → rien n'est publié ni débité ; index unique
 * (23505) → « déjà produit », sans débit ; débit unique pour un travail réalisé.
 * Ne prouve PAS : l'index unique lui-même (voir tests-pg/scheduled-posts-creneau.pg.test.ts).
 */


let insertions: Array<Record<string, unknown>>;
const bd = vi.hoisted(() => ({
  /** Créneaux déjà déposés (lus par `creneauxExistants`) ; `lectureErreur` simule une panne de lecture. */
  existants: [] as Array<Record<string, unknown>>,
  lectureErreur: null as null | { message: string },
  insertErreur: null as null | { code: string; message: string },
  rpc: null as null | ((fn: string, p: Record<string, unknown>) => Promise<unknown>),
}));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    rpc: (fn: string, p: Record<string, unknown>) => (bd.rpc ? bd.rpc(fn, p) : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })),
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {
          eq: () => q,
          then: (ok: (r: unknown) => unknown) => Promise.resolve(bd.lectureErreur ? { data: null, error: bd.lectureErreur } : { data: bd.existants, error: null }).then(ok),
        };
        return q;
      },
      insert(row: Record<string, unknown>) {
        insertions.push(row);
        return { async select() { return bd.insertErreur ? { data: null, error: bd.insertErreur } : { data: [{ id: `post-${insertions.length}` }], error: null }; } };
      },
    }),
  },
}));

const deductCredits = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/credits/system', () => ({
  deductCredits: (...a: unknown[]) => deductCredits(...a),
  getVideoRenderCost: () => 10,
}));

const renderAndUpload = vi.fn(async (_i: { design: Record<string, unknown> }) => ({
  videoUrl: 'https://minio.test/videos/u1/rendu.mp4', thumbnailUrl: 'https://minio.test/images/v.jpg', durationFrames: 900,
}));
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (i: { design: Record<string, unknown> }) => renderAndUpload(i),
}));

/** Adresses que la sonde déclare absentes (404/410). */
let absentes: Set<string>;
const sonde = vi.fn(async (url: string) => !absentes.has(url));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (u: string) => sonde(u),
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

import { produireUnMontage, creneauxExistants } from '@/lib/autopilot/produire';
import {
  RenduIndeterminError, RenduBailPerduError, RenduDoublonError, estErreurDeFile, rendusLocauxActifs,
} from '@/lib/autopilot/limite-rendus';

const config: AutopilotConfig = { ...DEFAULT_CONFIG, enabled: true, rushUrls: [], musicUrl: null, musicVolume: 0.4 };
const NOW = Date.parse('2026-09-23T06:00:00Z');
const [post] = preparePosts({ config, topic: 'yoga', count: 1, now: NOW });
const JETON = 'u1|' + post.scheduledDate + '|' + post.scheduledTime;

const produire = (opts: { sansAttente?: boolean } = {}) => produireUnMontage({
  userId: 'u1', config, post, rang: 0, now: NOW, jobId: 'autopilote-u1-job',
}, opts);

/** Base des baux simulée : on commande la réponse de chaque fonction. */
function baux(o: { prendre?: () => unknown; battre?: () => unknown } = {}) {
  const appels: string[] = [];
  bd.rpc = async (fn) => {
    appels.push(fn);
    if (fn === 'rendu_bail_prendre') return (o.prendre ?? (() => ({ data: [{ pris: true, motif: null, actifs: 1 }], error: null })))();
    if (fn === 'rendu_bail_battre') return (o.battre ?? (() => ({ data: [{ ok: true }], error: null })))();
    return { data: [{ ok: true }], error: null };
  };
  return appels;
}

beforeEach(() => {
  insertions = [];
  absentes = new Set();
  bd.existants = []; bd.lectureErreur = null; bd.insertErreur = null; bd.rpc = null;
  vi.clearAllMocks();
});

describe('lecture des créneaux impossible', () => {
  it('creneauxExistants lève (jamais un ensemble vide) : la base ne répond pas', async () => {
    bd.lectureErreur = { message: 'connection terminated' };
    await expect(creneauxExistants('u1')).rejects.toBeInstanceOf(RenduIndeterminError);
  });

  it('produireUnMontage : aucun rendu, aucun dépôt, aucun débit ; erreur de file (reportée, pas un échec)', async () => {
    baux();
    bd.lectureErreur = { message: 'connection terminated' };
    const err = await produire().catch((e) => e);
    expect(err).toBeInstanceOf(RenduIndeterminError);
    expect(estErreurDeFile(err)).toBe(true);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(insertions).toHaveLength(0);
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('la lecture revient : le montage se fait, UN dépôt, UN débit', async () => {
    baux();
    const r = await produire();
    expect(r.postId).toBe('post-1');
    expect(insertions).toHaveLength(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });
});

describe('créneau déjà produit', () => {
  it('relu après le bail : « déjà produit », aucun rendu ni débit', async () => {
    baux();
    bd.existants = [{ scheduled_date: post.scheduledDate, scheduled_time: post.scheduledTime, metadata: { source: 'autopilote', slotKey: JETON } }];
    const err = await produire().catch((e) => e);
    expect(err).toBeInstanceOf(RenduDoublonError);
    expect((err as RenduDoublonError).raison).toBe('deja_produit');
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('index unique (23505) au dépôt, ex. entre deux instances : « déjà produit », AUCUN débit', async () => {
    baux();
    bd.insertErreur = { code: '23505', message: 'duplicate key value violates unique constraint "scheduled_posts_autopilote_creneau_uniq"' };
    const err = await produire().catch((e) => e);
    expect(err).toBeInstanceOf(RenduDoublonError);
    expect((err as RenduDoublonError).raison).toBe('deja_produit');
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('une autre erreur d’insertion reste une vraie erreur (non masquée), sans débit', async () => {
    baux();
    bd.insertErreur = { code: '23502', message: 'null value in column' };
    const err = await produire().catch((e) => e);
    expect(err).not.toBeInstanceOf(RenduDoublonError);
    expect(String(err.message)).toContain('insertion du post');
    expect(deductCredits).not.toHaveBeenCalled();
  });
});

describe('panne de la base des baux : aucun contournement silencieux', () => {
  it('cron (sans attente) : base injoignable → RenduIndeterminError immédiat, RIEN lancé, pas de repli mémoire', async () => {
    bd.rpc = async () => { throw new Error('ECONNREFUSED'); };
    const err = await produire({ sansAttente: true }).catch((e) => e);
    expect(err).toBeInstanceOf(RenduIndeterminError);
    expect(renderAndUpload).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(rendusLocauxActifs()).toBe(0);
  });

  it('erreur HTTP 500 ou réponse vide : traitées comme une panne, jamais comme « fonctions absentes »', async () => {
    bd.rpc = async () => ({ data: null, error: { code: '500', message: 'internal error' } });
    expect(await produire({ sansAttente: true }).catch((e) => e)).toBeInstanceOf(RenduIndeterminError);
    bd.rpc = async () => ({ data: [], error: null });
    expect(await produire({ sansAttente: true }).catch((e) => e)).toBeInstanceOf(RenduIndeterminError);
    expect(renderAndUpload).not.toHaveBeenCalled();
  });

  it('fonctions ABSENTES (migration non appliquée) : repli mémoire journalisé, le montage se fait (état de déploiement)', async () => {
    bd.rpc = null; // PGRST202
    const r = await produire({ sansAttente: true });
    expect(r.postId).toBe('post-1');
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });
});

describe('bail perdu ou expiré : rien n’est publié sans autorisation', () => {
  it('bail repris par un autre (renouvellement refusé) avant le dépôt : aucun post, aucun débit', async () => {
    const appels = baux({ battre: () => ({ data: [{ ok: false }], error: null }) });
    const err = await produire().catch((e) => e);
    expect(err).toBeInstanceOf(RenduBailPerduError);
    expect(estErreurDeFile(err)).toBe(true);
    expect(renderAndUpload).toHaveBeenCalledTimes(1); // le rendu a eu lieu, le dépôt est refusé
    expect(insertions).toHaveLength(0);
    expect(deductCredits).not.toHaveBeenCalled();
    expect(appels).toContain('rendu_bail_liberer');
  });

  it('base injoignable au moment de prouver le bail : le dépôt est refusé (on ne SAIT pas), aucun débit', async () => {
    baux({ battre: () => { throw new Error('ECONNRESET'); } });
    const err = await produire().catch((e) => e);
    expect(err).toBeInstanceOf(RenduIndeterminError);
    expect(insertions).toHaveLength(0);
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('bail valide : dépôt puis UN débit, référence stable', async () => {
    baux();
    await produire();
    expect(insertions).toHaveLength(1);
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(deductCredits.mock.calls[0][3]).toBe('autopilote:autopilote-u1-job');
  });
});

describe('câblage', () => {
  it('le cron saute le compte quand les créneaux sont illisibles (jamais un cycle « par défaut »)', async () => {
    const { readFileSync } = await import('fs');
    const c = readFileSync('src/app/api/cron/autopilot/route.ts', 'utf8');
    const i = c.indexOf('dejaFaits = await creneauxExistants(userId);');
    expect(i).toBeGreaterThan(0);
    expect(c.slice(i, i + 400)).toContain('continue;');
    const m = readFileSync('src/app/api/autopilot/produire-maintenant/route.ts', 'utf8');
    expect(m).toContain("code: 'verification-impossible'");
  });
});
