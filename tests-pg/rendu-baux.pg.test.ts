/**
 * RENDUS AUTOPILOTE — baux globaux, sur un VRAI PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE SEULE LA BASE PEUT PROUVER
 * ─────────────────────────────────────────────────────────────────────────
 * « Au plus N rendus actifs, toutes instances confondues » est une propriété du
 * MOTEUR : un double en mémoire rejouerait ce qu'on lui programme. Ces tests jouent
 * le fichier de migration RÉEL (`migrations/2026-10-28-rendus-baux-globaux.sql`) et
 * lancent des demandes SIMULTANÉES sur des connexions distinctes.
 *
 * Le module applicatif (`limite-rendus.ts`) est aussi exécuté ici, contre cette base,
 * par l'adaptateur `supabase-sql` (une connexion du pool par appel, comme PostgREST).
 * Le transport est doublé ; les règles ne le sont pas.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { join } from 'path';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, RACINE, urlBase } from './harness';
import { clientSql, ouvrirPool, fermerPool } from './supabase-sql';

vi.mock('@/lib/db/supabase', async () => clientSql());
const { avecLimiteRendus, RenduDoublonError, RenduOccupeError } = await import('@/lib/autopilot/limite-rendus');

const MIGRATION_BAUX = join(RACINE, 'migrations/2026-10-28-rendus-baux-globaux.sql');
const ROLLBACK_BAUX = join(RACINE, 'migrations/rollback/2026-10-28-rendus-baux-globaux.rollback.sql');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPTES = [1, 2, 3, 4].map(uuid);

let db: Client;
let pool: Pool;

async function prendre(user: string, job: string, max: number, ttl = 120, instance = 'i') {
  const { rows } = await pool.query('select * from public.rendu_bail_prendre($1, $2, $3, $4, $5)', [user, job, instance, max, ttl]);
  return rows[0] as { pris: boolean; motif: string | null; actifs: number };
}
const nbBaux = async () => Number((await db.query('select count(*) from public.rendu_baux')).rows[0].count);

beforeAll(async () => {
  db = await connecter();
  await preparerBase(db);
  await appliquerMigration(db, MIGRATION_BAUX);
  pool = new Pool({ connectionString: urlBase(), max: 24 });
  ouvrirPool(16);
});
afterAll(async () => {
  await fermerPool();
  await pool.end();
  await db.end();
});
beforeEach(async () => {
  await db.query('delete from public.rendu_baux');
  await db.query('delete from public.users');
  for (const [i, id] of COMPTES.entries()) {
    await db.query('insert into public.users (id, email) values ($1, $2)', [id, `compte-${i}@test.invalid`]);
  }
});

describe('plafond global sous concurrence réelle', () => {
  it('40 demandes simultanées de 4 comptes, plafond 3 : exactement 3 obtiennent une place, les autres « occupe »', async () => {
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => prendre(COMPTES[i % 4], `job-${i}`, 3)));
    expect(res.filter((r) => r.pris)).toHaveLength(3);
    expect(res.filter((r) => !r.pris && r.motif === 'occupe')).toHaveLength(37);
    expect(await nbBaux()).toBe(3);
    // les compteurs rendus sont cohérents : 1, 2, 3 aux seuls gagnants
    expect(res.filter((r) => r.pris).map((r) => r.actifs).sort()).toEqual([1, 2, 3]);
  });

  it('une place libérée est reprise : la file avance, jamais plus de N', async () => {
    const a = await prendre(COMPTES[0], 'a', 1);
    expect(a.pris).toBe(true);
    expect((await prendre(COMPTES[1], 'b', 1)).motif).toBe('occupe');
    await pool.query('select * from public.rendu_bail_liberer($1, $2)', [COMPTES[0], 'a']);
    expect((await prendre(COMPTES[1], 'b', 1)).pris).toBe(true);
    expect(await nbBaux()).toBe(1);
  });

  it('le même travail ne tient jamais deux baux : « doublon », même sous 20 demandes simultanées', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => prendre(COMPTES[0], 'autopilote-u-2026-10-27-0900', 10)));
    expect(res.filter((r) => r.pris)).toHaveLength(1);
    expect(res.filter((r) => r.motif === 'doublon')).toHaveLength(19);
    expect(await nbBaux()).toBe(1);
  });
});

describe('expiration : un conteneur mort ne bloque pas la file', () => {
  it('un bail expiré est purgé à la demande suivante, et ne peut plus être renouvelé', async () => {
    expect((await prendre(COMPTES[0], 'mort', 1)).pris).toBe(true);
    expect((await prendre(COMPTES[1], 'vivant', 1)).motif).toBe('occupe');
    await db.query("update public.rendu_baux set expire_le = now() - interval '1 second' where job_id = 'mort'");
    const { rows } = await pool.query('select * from public.rendu_bail_battre($1, $2, 120)', [COMPTES[0], 'mort']);
    expect(rows[0].ok).toBe(false); // expiré : non renouvelable
    expect((await prendre(COMPTES[1], 'vivant', 1)).pris).toBe(true);
    expect(await nbBaux()).toBe(1);
  });

  it('le battement repousse l’expiration', async () => {
    await prendre(COMPTES[0], 'long', 2);
    await db.query("update public.rendu_baux set expire_le = now() + interval '5 seconds' where job_id = 'long'");
    const { rows } = await pool.query('select * from public.rendu_bail_battre($1, $2, 600)', [COMPTES[0], 'long']);
    expect(rows[0].ok).toBe(true);
    const r = await db.query("select extract(epoch from (expire_le - now())) as s from public.rendu_baux where job_id = 'long'");
    expect(Number(r.rows[0].s)).toBeGreaterThan(500);
  });
});

describe('isolation entre comptes', () => {
  it('un compte ne renouvelle ni ne libère le bail d’un autre', async () => {
    await prendre(COMPTES[0], 'travail-de-A', 2);
    const b1 = await pool.query('select * from public.rendu_bail_liberer($1, $2)', [COMPTES[1], 'travail-de-A']);
    expect(b1.rows[0].ok).toBe(false);
    const b2 = await pool.query('select * from public.rendu_bail_battre($1, $2, 600)', [COMPTES[1], 'travail-de-A']);
    expect(b2.rows[0].ok).toBe(false);
    expect(await nbBaux()).toBe(1);
    const a = await pool.query('select * from public.rendu_bail_liberer($1, $2)', [COMPTES[0], 'travail-de-A']);
    expect(a.rows[0].ok).toBe(true);
    expect(await nbBaux()).toBe(0);
  });

  it('un bail ne porte que qui / quel travail / quelle instance : aucune URL, aucun média', async () => {
    const { rows } = await db.query("select column_name from information_schema.columns where table_name = 'rendu_baux' order by 1");
    expect(rows.map((r) => r.column_name)).toEqual(['acquis_le', 'expire_le', 'instance', 'job_id', 'user_id']);
  });

  it('la suppression d’un compte supprime ses baux (aucune place orpheline)', async () => {
    await prendre(COMPTES[2], 'j', 4);
    await db.query('delete from public.users where id = $1', [COMPTES[2]]);
    expect(await nbBaux()).toBe(0);
  });

  it('un compte inconnu ne prend aucune place (clé étrangère)', async () => {
    await expect(prendre(uuid(999), 'fantome', 2)).rejects.toThrow(/foreign key|viol|clé étrangère/i);
    expect(await nbBaux()).toBe(0);
  });
});

describe('arguments et droits', () => {
  it('plafond, durée ou travail invalides : refusés par la base, aucune ligne écrite', async () => {
    for (const [job, max, ttl] of [['j', 0, 120], ['j', 17, 120], ['j', 1, 5], ['j', 1, 99999], ['', 1, 120]] as const) {
      await expect(prendre(COMPTES[0], job, max, ttl)).rejects.toThrow();
    }
    expect(await nbBaux()).toBe(0);
  });

  it('fonctions security definer à search_path figé, aucun droit pour PUBLIC', async () => {
    const f = await db.query("select proname, prosecdef, proconfig::text as conf from pg_proc where proname like 'rendu_bail_%' order by 1");
    expect(f.rows).toHaveLength(3);
    for (const r of f.rows) { expect(r.prosecdef).toBe(true); expect(r.conf).toContain('search_path'); }
    const p = await db.query("select count(*) from information_schema.routine_privileges where routine_name like 'rendu_bail_%' and grantee = 'PUBLIC'");
    expect(Number(p.rows[0].count)).toBe(0);
    const t = await db.query("select count(*) from information_schema.role_table_grants where table_name = 'rendu_baux' and grantee = 'PUBLIC'");
    expect(Number(t.rows[0].count)).toBe(0);
  });

  it('migration rejouable ; retour arrière propre puis réapplication', async () => {
    await appliquerMigration(db, MIGRATION_BAUX);
    await appliquerMigration(db, ROLLBACK_BAUX);
    expect((await db.query("select to_regclass('public.rendu_baux') as t")).rows[0].t).toBeNull();
    expect((await db.query("select count(*) from pg_proc where proname like 'rendu_bail_%'")).rows[0].count).toBe('0');
    await appliquerMigration(db, MIGRATION_BAUX);
    expect((await prendre(COMPTES[0], 'apres', 1)).pris).toBe(true);
  });
});

describe('module applicatif contre la vraie base, plusieurs comptes et instances', () => {
  const env = (max: number) => ({ STUDIIO_RENDUS_MAX_SIMULTANES: String(max), STUDIIO_RENDUS_ATTENTE_MAX_S: '60' });
  const court = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

  it('16 rendus de 4 comptes sur 4 instances fictives, plafond 2 : jamais plus de 2 à la fois, tous exécutés une fois, tout libéré', async () => {
    let actifs = 0; let pic = 0;
    const faits: string[] = [];
    await Promise.all(Array.from({ length: 16 }, (_, i) => avecLimiteRendus(COMPTES[i % 4], `job-${i}`, async () => {
      actifs += 1; pic = Math.max(pic, actifs);
      // à chaque instant, la BASE confirme le plafond
      expect(await nbBaux()).toBeLessThanOrEqual(2);
      await court(20);
      actifs -= 1; faits.push(`job-${i}`);
    }, { env: env(2), instance: `instance-${i % 4}`, dormir: () => court(15) })));
    expect(pic).toBe(2);
    expect(new Set(faits).size).toBe(16);
    expect(await nbBaux()).toBe(0);
  });

  it('même créneau lancé par deux instances : un seul rendu, l’autre reçoit « doublon » ; un serveur saturé reçoit « occupe » sans rien lancer', async () => {
    let liberer!: () => void;
    let rendus = 0;
    const premier = avecLimiteRendus(COMPTES[0], 'autopilote-créneau', () => { rendus += 1; return new Promise<void>((r) => { liberer = r; }); }, { env: env(1), instance: 'i1', dormir: () => court(5) });
    await vi.waitFor(async () => expect(await nbBaux()).toBe(1));
    await expect(avecLimiteRendus(COMPTES[0], 'autopilote-créneau', async () => { rendus += 1; }, { env: env(1), instance: 'i2', dormir: () => court(5) })).rejects.toBeInstanceOf(RenduDoublonError);
    const autre = vi.fn(async () => { rendus += 1; });
    await expect(avecLimiteRendus(COMPTES[1], 'autre-job', autre, { env: { ...env(1), STUDIIO_RENDUS_ATTENTE_MAX_S: '0' }, instance: 'i3' })).rejects.toBeInstanceOf(RenduOccupeError);
    expect(autre).not.toHaveBeenCalled();
    expect(rendus).toBe(1);
    liberer(); await premier;
    expect(await nbBaux()).toBe(0);
  });
});
