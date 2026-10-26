/**
 * LIMITE GLOBALE DE RENDUS AUTOPILOTE — orchestration (`limite-rendus.ts`), plusieurs comptes
 * et plusieurs « instances » fictifs partageant une même base simulée.
 *
 * Ce fichier prouve ce que FAIT le module (attente, libération, doublon, repli, battement).
 * Ce que la BASE garantit (atomicité sous concurrence, expiration, propriété du bail) est prouvé
 * sur un vrai PostgreSQL : `tests-pg/rendu-baux.pg.test.ts`. La base simulée ci-dessous n'est
 * qu'un double de ces règles — elle ne prouve pas la migration.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  avecLimiteRendus, rendusMaxSimultanes, attenteMaxMs, estErreurDeFile, rendusLocauxActifs,
  RenduOccupeError, RenduDoublonError, BAIL_BATTEMENT_MS, BAIL_TTL_S,
  RENDUS_MAX_PAR_DEFAUT, ATTENTE_MAX_PAR_DEFAUT_S,
} from '@/lib/autopilot/limite-rendus';

// ── Base simulée : mêmes règles que `rendu_bail_*` ────────────────────────
function baseSimulee(horloge: { t: number }) {
  const baux = new Map<string, { user: string; expire: number }>();
  const appels: Array<{ fn: string; p: Record<string, unknown> }> = [];
  const rpc = async (fn: string, p: Record<string, unknown>) => {
    appels.push({ fn, p });
    for (const [j, b] of baux) if (b.expire < horloge.t) baux.delete(j);
    if (fn === 'rendu_bail_prendre') {
      const job = String(p.p_job);
      if (baux.has(job)) return { data: [{ pris: false, motif: 'doublon', actifs: baux.size }], error: null };
      if (baux.size >= Number(p.p_max)) return { data: [{ pris: false, motif: 'occupe', actifs: baux.size }], error: null };
      baux.set(job, { user: String(p.p_user), expire: horloge.t + Number(p.p_ttl_s) * 1000 });
      return { data: [{ pris: true, motif: null, actifs: baux.size }], error: null };
    }
    if (fn === 'rendu_bail_battre') {
      const b = baux.get(String(p.p_job));
      const ok = !!b && b.user === p.p_user;
      if (ok) b!.expire = horloge.t + Number(p.p_ttl_s) * 1000;
      return { data: [{ ok }], error: null };
    }
    if (fn === 'rendu_bail_liberer') {
      const b = baux.get(String(p.p_job));
      const ok = !!b && b.user === p.p_user;
      if (ok) baux.delete(String(p.p_job));
      return { data: [{ ok }], error: null };
    }
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  };
  return { baux, appels, rpc };
}

const court = (ms = 1) => new Promise<void>((r) => { setTimeout(r, ms); });
const dormirVite = () => court(1);
const env = (max: number, attenteS = 600) => ({ STUDIIO_RENDUS_MAX_SIMULTANES: String(max), STUDIIO_RENDUS_ATTENTE_MAX_S: String(attenteS) });

afterEach(() => { vi.useRealTimers(); });

describe('réglages', () => {
  it('valeurs par défaut prudentes ; invalide ou hors bornes : défaut, jamais illimité', () => {
    expect(rendusMaxSimultanes({})).toBe(RENDUS_MAX_PAR_DEFAUT);
    expect(RENDUS_MAX_PAR_DEFAUT).toBe(1);
    for (const v of ['0', '-1', '17', '1.5', 'abc', '', ' ', '1e3']) expect(rendusMaxSimultanes({ STUDIIO_RENDUS_MAX_SIMULTANES: v })).toBe(1);
    expect(rendusMaxSimultanes({ STUDIIO_RENDUS_MAX_SIMULTANES: '3' })).toBe(3);
    expect(rendusMaxSimultanes({ STUDIIO_RENDUS_MAX_SIMULTANES: ' 4 ' })).toBe(4);
    expect(attenteMaxMs({})).toBe(ATTENTE_MAX_PAR_DEFAUT_S * 1000);
    expect(attenteMaxMs({ STUDIIO_RENDUS_ATTENTE_MAX_S: '0' })).toBe(0);
    expect(attenteMaxMs({ STUDIIO_RENDUS_ATTENTE_MAX_S: '99999' })).toBe(ATTENTE_MAX_PAR_DEFAUT_S * 1000);
  });
});

describe('limite globale : plusieurs comptes, plusieurs instances', () => {
  async function essaim(n: number, max: number, instances: number) {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    let actifs = 0; let pic = 0;
    const ordre: string[] = [];
    const jobs = Array.from({ length: n }, (_, i) => ({ user: `compte-${i % 4}`, job: `job-${i}`, instance: `instance-${i % instances}` }));
    const res = await Promise.all(jobs.map((j) => avecLimiteRendus(j.user, j.job, async () => {
      actifs += 1; pic = Math.max(pic, actifs);
      ordre.push(j.job);
      await court(3);
      actifs -= 1;
      return j.job;
    }, { rpc: bd.rpc, env: env(max), instance: j.instance, dormir: dormirVite, maintenant: () => h.t })));
    return { res, pic, ordre, bd };
  }

  it('12 demandes de 4 comptes sur 3 instances, plafond 2 : jamais plus de 2 rendus à la fois, tous rendus une fois', async () => {
    const { res, pic, bd } = await essaim(12, 2, 3);
    expect(pic).toBeLessThanOrEqual(2);
    expect(pic).toBe(2);
    expect(new Set(res).size).toBe(12);
    expect(bd.baux.size).toBe(0); // tout est libéré
  });

  it('plafond 1 : sérialisation stricte', async () => {
    const { pic, res } = await essaim(6, 1, 2);
    expect(pic).toBe(1);
    expect(res).toHaveLength(6);
  });

  it('le plafond se relève par variable, sans changer le code', async () => {
    const { pic } = await essaim(8, 4, 2);
    expect(pic).toBe(4);
  });
});

describe('attente, doublon, erreurs', () => {
  it('un rendu attend sa place, signale « en file d’attente », puis s’exécute quand la place se libère', async () => {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    let liberer!: () => void;
    const premier = avecLimiteRendus('a', 'j1', () => new Promise<string>((r) => { liberer = () => r('un'); }), { rpc: bd.rpc, env: env(1), dormir: dormirVite, maintenant: () => h.t });
    await vi.waitFor(() => expect(bd.baux.has('j1')).toBe(true));
    const attentes = vi.fn();
    const deuxieme = avecLimiteRendus('b', 'j2', async () => 'deux', { rpc: bd.rpc, env: env(1), dormir: dormirVite, maintenant: () => h.t, onAttente: attentes });
    await vi.waitFor(() => expect(attentes).toHaveBeenCalled());
    expect(bd.baux.has('j2')).toBe(false);
    liberer();
    expect(await premier).toBe('un');
    expect(await deuxieme).toBe('deux');
  });

  it('attente épuisée : RenduOccupeError AVANT tout travail (donc avant tout débit)', async () => {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    bd.baux.set('occupant', { user: 'x', expire: h.t + 3_600_000 });
    const travail = vi.fn(async () => 'jamais');
    const dormir = async (ms: number) => { h.t += ms; };
    await expect(avecLimiteRendus('a', 'j1', travail, { rpc: bd.rpc, env: env(1, 30), dormir, maintenant: () => h.t })).rejects.toBeInstanceOf(RenduOccupeError);
    expect(travail).not.toHaveBeenCalled();
    expect(bd.baux.has('j1')).toBe(false);
    // attente 0 : refus immédiat
    await expect(avecLimiteRendus('a', 'j2', travail, { rpc: bd.rpc, env: env(1, 0), dormir, maintenant: () => h.t })).rejects.toBeInstanceOf(RenduOccupeError);
    expect(travail).not.toHaveBeenCalled();
  });

  it('même travail lancé deux fois (créneau rejoué, deux instances) : le second reçoit « doublon », rien n’est exécuté deux fois', async () => {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    let liberer!: () => void;
    let executions = 0;
    const premier = avecLimiteRendus('a', 'autopilote-a-2026-10-27-0900', () => { executions += 1; return new Promise<void>((r) => { liberer = r; }); }, { rpc: bd.rpc, env: env(4), instance: 'i1', dormir: dormirVite, maintenant: () => h.t });
    await vi.waitFor(() => expect(bd.baux.size).toBe(1));
    const second = avecLimiteRendus('a', 'autopilote-a-2026-10-27-0900', async () => { executions += 1; }, { rpc: bd.rpc, env: env(4), instance: 'i2', dormir: dormirVite, maintenant: () => h.t });
    await expect(second).rejects.toBeInstanceOf(RenduDoublonError);
    expect(executions).toBe(1);
    liberer(); await premier;
    // le créneau reste rejouable une fois le premier fini (le débit, lui, est idempotent par référence)
    await avecLimiteRendus('a', 'autopilote-a-2026-10-27-0900', async () => { executions += 1; }, { rpc: bd.rpc, env: env(4), dormir: dormirVite, maintenant: () => h.t });
    expect(executions).toBe(2);
  });

  it('erreur du travail : le bail est libéré, l’erreur est rendue telle quelle, le suivant passe', async () => {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    await expect(avecLimiteRendus('a', 'j1', async () => { throw new Error('Chromium a planté'); }, { rpc: bd.rpc, env: env(1), dormir: dormirVite, maintenant: () => h.t })).rejects.toThrow('Chromium a planté');
    expect(bd.baux.size).toBe(0);
    expect(await avecLimiteRendus('b', 'j2', async () => 'ok', { rpc: bd.rpc, env: env(1), dormir: dormirVite, maintenant: () => h.t })).toBe('ok');
  });

  it('conteneur mort (bail jamais libéré, jamais renouvelé) : la place revient à l’expiration, la file ne reste pas bloquée', async () => {
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    await bd.rpc('rendu_bail_prendre', { p_user: 'mort', p_job: 'j-mort', p_instance: 'i-morte', p_max: 1, p_ttl_s: BAIL_TTL_S });
    const dormir = async (ms: number) => { h.t += ms * 40; }; // le temps passe vite
    expect(await avecLimiteRendus('b', 'j2', async () => 'repris', { rpc: bd.rpc, env: env(1, 3600), dormir, maintenant: () => h.t })).toBe('repris');
  });

  it('les erreurs de file ne sont reconnues que pour ce qu’elles sont', () => {
    expect(estErreurDeFile(new RenduOccupeError())).toBe(true);
    expect(estErreurDeFile(new RenduDoublonError('j'))).toBe(true);
    expect(estErreurDeFile(new Error('Chromium'))).toBe(false);
    expect(estErreurDeFile(null)).toBe(false);
    expect(new RenduOccupeError().message).toContain('Rien n’a été débité');
  });
});

describe('battement du bail', () => {
  it('le bail d’un rendu long est renouvelé sous le bon compte, puis le battement s’arrête', async () => {
    vi.useFakeTimers();
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    let fin!: () => void;
    const p = avecLimiteRendus('compte-x', 'job-long', () => new Promise<void>((r) => { fin = r; }), { rpc: bd.rpc, env: env(1), maintenant: () => h.t });
    await vi.advanceTimersByTimeAsync(0);
    expect(bd.baux.has('job-long')).toBe(true);
    await vi.advanceTimersByTimeAsync(BAIL_BATTEMENT_MS * 3 + 10);
    const battements = bd.appels.filter((a) => a.fn === 'rendu_bail_battre');
    expect(battements.length).toBe(3);
    expect(battements.every((a) => a.p.p_user === 'compte-x' && a.p.p_job === 'job-long' && a.p.p_ttl_s === BAIL_TTL_S)).toBe(true);
    fin(); await p;
    const avant = bd.appels.length;
    await vi.advanceTimersByTimeAsync(BAIL_BATTEMENT_MS * 3);
    expect(bd.appels.length).toBe(avant); // plus de battement, bail libéré
    expect(bd.baux.size).toBe(0);
  });

  it('bail perdu : le rendu continue et le dit, sans rien casser', async () => {
    vi.useFakeTimers();
    const h = { t: Date.now() };
    const bd = baseSimulee(h);
    const avertir = vi.fn();
    let fin!: () => void;
    const p = avecLimiteRendus('a', 'j', () => new Promise<void>((r) => { fin = r; }), { rpc: bd.rpc, env: env(1), maintenant: () => h.t, avertir });
    await vi.advanceTimersByTimeAsync(0);
    bd.baux.delete('j'); // repris / expiré ailleurs
    await vi.advanceTimersByTimeAsync(BAIL_BATTEMENT_MS + 10);
    expect(avertir).toHaveBeenCalledWith(expect.stringContaining('bail perdu'));
    fin(); await expect(p).resolves.toBeUndefined();
  });
});

describe('base sans les fonctions (migration non appliquée) ou en panne : repli par instance, journalisé', () => {
  it('PGRST202 : une alerte, la limite tient quand même dans l’instance, les rendus passent', async () => {
    const avertir = vi.fn();
    const rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rendu_bail_prendre' } });
    let actifs = 0; let pic = 0;
    const lancer = (i: number) => avecLimiteRendus(`c${i}`, `job-${i}`, async () => { actifs += 1; pic = Math.max(pic, actifs); await court(3); actifs -= 1; return i; }, { rpc, env: env(1), dormir: dormirVite, avertir });
    const res = await Promise.all([0, 1, 2, 3].map(lancer));
    expect(res).toEqual([0, 1, 2, 3]);
    expect(pic).toBe(1);
    expect(avertir.mock.calls.filter((c) => String(c[0]).includes('baux globaux indisponibles')).length).toBeGreaterThanOrEqual(1);
    expect(avertir.mock.calls.length).toBeLessThanOrEqual(4); // une alerte par appel, jamais une par tour d'attente
    expect(rendusLocauxActifs()).toBe(0);
  });

  it('exception réseau : même repli ; le repli refuse aussi un doublon local', async () => {
    const rpc = async () => { throw new Error('ECONNREFUSED'); };
    let liberer!: () => void;
    const p1 = avecLimiteRendus('a', 'jx', () => new Promise<void>((r) => { liberer = r; }), { rpc, env: env(2), dormir: dormirVite, avertir: () => {} });
    await vi.waitFor(() => expect(rendusLocauxActifs()).toBe(1));
    await expect(avecLimiteRendus('a', 'jx', async () => {}, { rpc, env: env(2), dormir: dormirVite, avertir: () => {} })).rejects.toBeInstanceOf(RenduDoublonError);
    liberer(); await p1;
    expect(rendusLocauxActifs()).toBe(0);
  });
});

describe('redémarrage du processus (repli en mémoire)', () => {
  it('un rendu mort avec son processus ne bloque ni le même créneau ni la file : la mémoire repart à neuf', async () => {
    const rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const g = globalThis as { __studiioInstanceAutopilote?: string };
    void avecLimiteRendus('a', 'job-mort', () => new Promise<void>(() => { /* ne finit jamais */ }), { rpc, env: env(1), dormir: dormirVite, avertir: () => {} });
    await vi.waitFor(() => expect(rendusLocauxActifs()).toBe(1));
    delete g.__studiioInstanceAutopilote; // redémarrage : nouvel identifiant d'instance
    expect(rendusLocauxActifs()).toBe(0);
    expect(await avecLimiteRendus('a', 'job-mort', async () => 'relance', { rpc, env: env(1), dormir: dormirVite, avertir: () => {} })).toBe('relance');
  });
});

describe('câblage', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('tous les montages Autopilote (cron, manuel, finaliseur jumeau) passent par la limite : un seul export public', () => {
    const p = src('src/lib/autopilot/produire.ts');
    expect(p).toContain('async function produireUnMontageInterne(input: {');
    expect(p).not.toContain('export async function produireUnMontage(');
    expect(p).toContain('export function produireUnMontage(');
    expect(p).toContain('avecLimiteRendus(input.userId, input.jobId, () => produireUnMontageInterne(input)');
    expect(p).toContain("input.onProgression?.('attente', 0)");
  });
  it('cron : serveur occupé ou doublon ne comptent ni comme échec, ni pour la rotation des rushs', () => {
    const c = src('src/app/api/cron/autopilot/route.ts');
    const i = c.indexOf('if (estErreurDeFile(err))');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(c.indexOf('echecs += 1;', i));
    expect(i).toBeLessThan(c.indexOf('doitPasserLeRush({ userId, rushUrl: post.rushUrl, message })'));
  });
  it('finaliseur jumeau : un avatar livré n’est jamais abandonné pour un serveur saturé (aucune tentative consommée)', () => {
    const j = src('src/lib/autopilot/jumeau-async.ts');
    expect(j).toContain('if (estErreurDeFile(e)) {');
    expect(j).toContain('await rouvrir(ligne.id, { tentatives: ligne.tentatives });');
  });
  it('production manuelle : le message de file est dit à l’utilisateur', () => {
    expect(src('src/app/api/autopilot/produire-maintenant/route.ts')).toContain('estErreurDeFile(err)');
  });
  it('aucun crédit, paiement ni fournisseur dans la file', () => {
    expect(src('src/lib/autopilot/limite-rendus.ts')).not.toMatch(/debiter|credit_transactions|stripe|anthropic|groq|heygen/i);
  });
});
