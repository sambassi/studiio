/**
 * PLAFOND COMMUN DES RENDUS LOURDS — Autopilote + Créer, un seul pool de baux PostgreSQL.
 *
 * Prouve : plafond d'ensemble sous charge mixte, priorité aux actions interactives (réserve),
 * refus propres sans attente, libération dans tous les cas, reprise. Les conversions faites dans
 * le NAVIGATEUR ne passent par aucun de ces modules.
 * Ne prouve PAS : la base réelle (voir tests-pg/rendu-baux.pg.test.ts) ni un rendu complet.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  avecLimiteRendus, prendrePlaceInteractive, reserverBail, lierBailALaPlace,
  rendusMaxSimultanes, rendusMaxInteractifs, RenduOccupeError, RenduDoublonError,
  cleBail, CLE_BAIL_MAX,
} from '@/lib/autopilot/limite-rendus';

function rpcSimule() {
  const baux = new Map<string, string>();
  let pic = 0;
  const rpc = async (fn: string, p: Record<string, unknown>) => {
    const job = String(p.p_job);
    if (fn === 'rendu_bail_prendre') {
      if (baux.has(job)) return { data: [{ pris: false, motif: 'doublon', actifs: baux.size }], error: null };
      if (baux.size >= Number(p.p_max)) return { data: [{ pris: false, motif: 'occupe', actifs: baux.size }], error: null };
      baux.set(job, String(p.p_user)); pic = Math.max(pic, baux.size);
      return { data: [{ pris: true, motif: null, actifs: baux.size }], error: null };
    }
    if (fn === 'rendu_bail_liberer') { const ok = baux.get(job) === p.p_user; if (ok) baux.delete(job); return { data: [{ ok }], error: null }; }
    return { data: [{ ok: baux.has(job) }], error: null };
  };
  return { baux, rpc, pic: () => pic };
}
const env = (max: number, reserve?: number) => ({
  STUDIIO_RENDUS_MAX_SIMULTANES: String(max), STUDIIO_RENDUS_ATTENTE_MAX_S: '600',
  ...(reserve === undefined ? {} : { STUDIIO_RENDUS_RESERVE_INTERACTIF: String(reserve) }),
});
const vite = () => new Promise<void>((r) => { setTimeout(r, 1); });

describe('réglages', () => {
  it('plafond interactif = Autopilote + réserve (défaut 1 + 1) ; réserve 0 accepté ; invalide → défaut ; jamais plus de 16', () => {
    expect(rendusMaxSimultanes({})).toBe(1);
    expect(rendusMaxInteractifs({})).toBe(2);
    expect(rendusMaxInteractifs(env(2, 0))).toBe(2);
    expect(rendusMaxInteractifs(env(3, 2))).toBe(5);
    expect(rendusMaxInteractifs({ STUDIIO_RENDUS_RESERVE_INTERACTIF: 'beaucoup' })).toBe(2);
    expect(rendusMaxInteractifs({ STUDIIO_RENDUS_RESERVE_INTERACTIF: '99' })).toBe(2);
    expect(rendusMaxInteractifs(env(16, 8))).toBe(16);
  });
});

describe('pool commun sous charge mixte', () => {
  it('Autopilote (plafond 1) + actions Créer (plafond 2) : jamais plus de 2 rendus lourds en même temps, tous aboutissent ou sont refusés proprement', async () => {
    const bd = rpcSimule();
    let actifs = 0; let pic = 0; let faits = 0; let refus = 0;
    const travail = async () => { actifs += 1; pic = Math.max(pic, actifs); await vite(); await vite(); actifs -= 1; faits += 1; };
    const lots: Array<Promise<void>> = [];
    for (let i = 0; i < 24; i += 1) {
      if (i % 2 === 0) {
        lots.push(avecLimiteRendus(`a${i}`, `autopilote-${i}`, travail, { rpc: bd.rpc, env: env(1), dormir: vite }));
      } else {
        lots.push((async () => {
          const place = await prendrePlaceInteractive(`c${i}`, `creer-${i}`, { rpc: bd.rpc, env: env(1) });
          if (!place.ok) { refus += 1; return; }
          try { await travail(); } finally { await place.bail.liberer(); }
        })());
      }
    }
    await Promise.all(lots);
    expect(pic).toBeLessThanOrEqual(2);
    expect(bd.pic()).toBeLessThanOrEqual(2);
    expect(faits + refus).toBe(24);
    expect(faits).toBeGreaterThanOrEqual(12); // tous les Autopilote (ils attendent) aboutissent
    expect(bd.baux.size).toBe(0);
  });

  it('priorité interactive : un rendu Autopilote en cours ne bloque pas UNE action Créer ; un second rendu Autopilote attend', async () => {
    const bd = rpcSimule();
    let finAuto!: () => void;
    const auto = avecLimiteRendus('a', 'autopilote-1', () => new Promise<void>((r) => { finAuto = r; }), { rpc: bd.rpc, env: env(1), dormir: vite });
    await vi_attendre(() => bd.baux.size === 1 && !!finAuto);
    const creer = await prendrePlaceInteractive('c', 'creer-1', { rpc: bd.rpc, env: env(1) });
    expect(creer.ok).toBe(true);
    // pool à 2 : plus de place pour une 2e action Créer, ni pour un autre Autopilote (qui, lui, ATTEND)
    const creer2 = await prendrePlaceInteractive('d', 'creer-2', { rpc: bd.rpc, env: env(1) });
    expect(creer2).toMatchObject({ ok: false, motif: 'occupe' });
    const dormis: number[] = [];
    const auto2 = avecLimiteRendus('b', 'autopilote-2', async () => 'ok', { rpc: bd.rpc, env: env(1), dormir: async (ms) => { dormis.push(ms); await vite(); } });
    await vi_attendre(() => dormis.length > 0);
    if (creer.ok) await creer.bail.liberer();
    finAuto();
    await auto;
    expect(await auto2).toBe('ok');
    expect(bd.baux.size).toBe(0);
  });

  it('seule une action Créer, sans Autopilote : deux passent (plafond 2), la troisième est refusée sans attente', async () => {
    const bd = rpcSimule();
    const a = await prendrePlaceInteractive('a', 'c1', { rpc: bd.rpc, env: env(1) });
    const b = await prendrePlaceInteractive('b', 'c2', { rpc: bd.rpc, env: env(1) });
    const t0 = Date.now();
    const c = await prendrePlaceInteractive('c', 'c3', { rpc: bd.rpc, env: env(1) });
    expect(Date.now() - t0).toBeLessThan(500);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
  });
});

describe('refus propres, libération, reprise', () => {
  it('le même travail Créer lancé deux fois en même temps : « doublon » (jamais deux conversions du même fichier)', async () => {
    const bd = rpcSimule();
    const a = await prendrePlaceInteractive('u', 'convertir:u/rendus/x.webm', { rpc: bd.rpc, env: env(1) });
    const b = await prendrePlaceInteractive('u', 'convertir:u/rendus/x.webm', { rpc: bd.rpc, env: env(1) });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, motif: 'doublon' });
    if (a.ok) await a.bail.liberer();
    const c = await prendrePlaceInteractive('u', 'convertir:u/rendus/x.webm', { rpc: bd.rpc, env: env(1) });
    expect(c.ok).toBe(true); // reprise après libération
  });

  it('base des baux injoignable : l’action ABOUTIT en mode dégradé (la limite locale de la route protège seule), et c’est journalisé', async () => {
    const avertir = vi.fn();
    const r = await prendrePlaceInteractive('u', 'j', { rpc: async () => { throw new Error('ECONNREFUSED'); }, env: env(1), avertir });
    expect(r).toMatchObject({ ok: true, degrade: true });
    expect(avertir.mock.calls.some((c) => String(c[0]).includes('SEULE limite locale'))).toBe(true);
    if (r.ok) await r.bail.liberer(); // sans effet, et sans erreur
  });

  it('migration non appliquée (fonctions absentes) : même repli dégradé, l’export de Créer n’est pas bloqué', async () => {
    const r = await prendrePlaceInteractive('u', 'j', {
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
      env: env(1), avertir: () => {},
    });
    expect(r.ok).toBe(true);
  });

  it('« occupe » et « doublon » restent des REFUS : ce sont les réponses d’une base qui fonctionne', async () => {
    const bd = rpcSimule();
    const a = await prendrePlaceInteractive('u', 'j1', { rpc: bd.rpc, env: env(1) });
    const b = await prendrePlaceInteractive('v', 'j2', { rpc: bd.rpc, env: env(1) });
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await prendrePlaceInteractive('w', 'j3', { rpc: bd.rpc, env: env(1) })).toMatchObject({ ok: false, motif: 'occupe' });
    expect(await prendrePlaceInteractive('u', 'j1', { rpc: bd.rpc, env: env(1) })).toMatchObject({ ok: false, motif: 'doublon' });
  });

  it('lierBailALaPlace : libérer la place d’origine rend aussi le bail, une seule fois, même si on libère deux fois', async () => {
    const bd = rpcSimule();
    const bail = await reserverBail('u', 'j', { rpc: bd.rpc, env: env(2), dormir: vite });
    expect(bd.baux.size).toBe(1);
    let liberees = 0;
    const place = lierBailALaPlace({ liberer: () => { liberees += 1; } }, bail);
    place.liberer();
    place.liberer();
    await vi_attendre(() => bd.baux.size === 0);
    expect(liberees).toBe(2); // la place d'origine reste idempotente de son côté
    expect(bd.baux.size).toBe(0);
  });

  it('une erreur du travail libère le bail : la place n’est jamais perdue', async () => {
    const bd = rpcSimule();
    const place = await prendrePlaceInteractive('u', 'j', { rpc: bd.rpc, env: env(1) });
    expect(place.ok).toBe(true);
    await expect((async () => { try { throw new Error('ffmpeg a échoué'); } finally { if (place.ok) await place.bail.liberer(); } })()).rejects.toThrow('ffmpeg');
    expect(bd.baux.size).toBe(0);
    expect((await prendrePlaceInteractive('v', 'j2', { rpc: bd.rpc, env: env(1) })).ok).toBe(true);
  });

  it('les erreurs de file restent des RenduOccupe/Doublon (statuts 429/409 côté routes)', () => {
    expect(new RenduOccupeError()).toBeInstanceOf(Error);
    expect(new RenduDoublonError('x')).toBeInstanceOf(Error);
  });
});

describe('clé de bail bornée : un chemin de fichier très long ne fait pas échouer la conversion', () => {
  /** Le refus de la base, tel qu'il est écrit dans la migration réelle. */
  const LIMITE_SQL = Number(/length\(p_job\) > (\d+)/.exec(readFileSync('migrations/2026-10-28-rendus-baux-globaux.sql', 'utf8'))![1]);
  const cheminLong = `${'0'.repeat(36)}/rendus/${'dossier-tres-long-de-l-utilisateur/'.repeat(40)}montage-final.webm`;
  const jobLong = `convertir:${cheminLong}`;

  it('la marge du code est SOUS la limite écrite dans la migration', () => {
    expect(LIMITE_SQL).toBe(200);
    expect(CLE_BAIL_MAX).toBeLessThan(LIMITE_SQL);
  });

  it('un identifiant très long est raccourci sous la limite, reste stable et lisible', () => {
    expect(jobLong.length).toBeGreaterThan(LIMITE_SQL);
    const c = cleBail(jobLong);
    expect(c.length).toBeLessThanOrEqual(CLE_BAIL_MAX);
    expect(c).toBe(cleBail(jobLong)); // stable : deux appels, même clé
    expect(c.startsWith('convertir:')).toBe(true); // lisible dans les journaux
  });

  it('un identifiant court n’est pas touché (les clés existantes ne changent pas)', () => {
    expect(cleBail('autopilote-u1-2026-10-27-0900')).toBe('autopilote-u1-2026-10-27-0900');
    expect(cleBail('convertir:u1/rendus/abc.webm')).toBe('convertir:u1/rendus/abc.webm');
  });

  it('deux chemins longs qui ne diffèrent QUE par la fin donnent deux clés différentes (pas de collision)', () => {
    const a = cleBail(`${jobLong}#a`);
    const b = cleBail(`${jobLong}#b`);
    expect(a).not.toBe(b);
    expect(new Set([a, b, cleBail(jobLong)]).size).toBe(3);
  });

  it('la base ne reçoit JAMAIS plus que la limite, et la conversion aboutit', async () => {
    const bd = rpcSimule();
    const recues: string[] = [];
    const rpc = async (fn: string, p: Record<string, unknown>) => {
      recues.push(String(p.p_job));
      if (String(p.p_job).length > LIMITE_SQL) return { data: null, error: { code: '22023', message: 'bail invalide' } };
      return bd.rpc(fn, p);
    };
    const place = await prendrePlaceInteractive('u', jobLong, { rpc, env: env(1) });
    expect(place.ok).toBe(true);
    if (place.ok) { await place.bail.verifierBail(); await place.bail.liberer(); }
    expect(recues.length).toBeGreaterThanOrEqual(3); // prendre + battre + liberer
    expect(recues.every((j) => j.length <= LIMITE_SQL)).toBe(true);
    expect(bd.baux.size).toBe(0);
  });

  it('le même chemin long lancé deux fois est bien vu comme un doublon (une seule conversion)', async () => {
    const bd = rpcSimule();
    const a = await prendrePlaceInteractive('u', jobLong, { rpc: bd.rpc, env: env(1) });
    const b = await prendrePlaceInteractive('u', jobLong, { rpc: bd.rpc, env: env(1) });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, motif: 'doublon' });
    if (a.ok) await a.bail.liberer();
  });
});

describe('les routes traduisent un refus en 429, jamais en panne', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('aucune route ne répond 503 pour une place refusée (plus de motif « indetermine »)', () => {
    for (const f of [
      'src/app/api/convert/to-mp4/route.ts',
      'src/app/api/render/jobs/[id]/serveur/route.ts',
      'src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts',
    ]) {
      expect(src(f)).not.toContain("motif === 'indetermine'");
    }
  });
});

describe('câblage : quelles opérations passent par le pool commun', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('Créer : conversion MP4 du serveur, MP4 durable, export serveur A2.3 ; Autopilote : rendu de plan', () => {
    expect(src('src/app/api/convert/to-mp4/route.ts')).toContain('prendrePlaceInteractive(userId, `convertir:${cle}`)');
    expect(src('src/lib/rendus/mp4-durable-serveur.ts')).toContain('prendrePlaceInteractive(userId, `mp4-durable:${cleMp4}`)');
    expect(src('src/app/api/render/jobs/[id]/serveur/route.ts')).toContain('prendrePlaceInteractive(userId, `export-serveur:${rendu.id}`)');
    expect(src('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts')).toContain('prendrePlaceInteractive(userId, `plan-rendu:${plan.id}`)');
  });
  it('le bail est pris AVANT tout téléchargement, rendu, ligne ou débit', () => {
    const t = src('src/app/api/convert/to-mp4/route.ts');
    expect(t.indexOf('prendrePlaceInteractive(userId')).toBeLessThan(t.indexOf('downloadMediaToFile(videoUrl'));
    const a = src('src/app/api/render/jobs/[id]/serveur/route.ts');
    expect(a.indexOf('prendrePlaceInteractive(userId')).toBeLessThan(a.indexOf('prendreExecution(rendu.id'));
    const p = src('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
    expect(p.indexOf('prendrePlaceInteractive(userId')).toBeLessThan(p.indexOf('creerRendu(userId, identite)'));
  });
  it('aucun crédit ni paiement dans ces routes du fait du pool (aucun import de crédits ajouté)', () => {
    expect(src('src/lib/autopilot/limite-rendus.ts')).not.toMatch(/debiter|deductCredits|credit_transactions|stripe/i);
  });
  it('les conversions faites dans le NAVIGATEUR ne dépendent pas du pool : aucun module client ne l’importe', () => {
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const n of readdirSync(d)) {
        const c = join(d, n);
        if (statSync(c).isDirectory()) parcourir(c);
        else if (/\.(ts|tsx)$/.test(n)) fichiers.push(c);
      }
    };
    parcourir('src');
    const clients = fichiers.filter((f) => /^'use client'|^"use client"/m.test(readFileSync(f, 'utf8').slice(0, 200)) || f.endsWith('client-conversion.ts') || f.endsWith('mp4-durable-client.ts'));
    expect(clients.length).toBeGreaterThan(10);
    const fautifs = clients.filter((f) => readFileSync(f, 'utf8').includes('autopilot/limite-rendus'));
    expect(fautifs).toEqual([]);
  });
});

async function vi_attendre(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i += 1) { if (cond()) return; await vite(); }
  throw new Error('condition jamais atteinte');
}
