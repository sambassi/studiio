/**
 * `subscriptions.status` sur un VRAI PostgreSQL.
 *
 * Ce que ces tests prouvent, sur les fichiers de migration de production
 * (jamais recopies) :
 *
 * 1. Avant la migration, les statuts Stripe `trialing`, `unpaid`… sont
 *    rejetes — c'est le bug.
 * 2. Apres : chacun des 9 statuts retenus s'insere, un statut inconnu (et la
 *    graphie britannique `cancelled`) est rejete.
 * 3. La migration est rejouable, et remplace une contrainte quel que soit son
 *    nom — le schema reel de production n'a pas ete releve.
 * 4. Le rollback restaure la liste etroite, et REFUSE sans rien changer si
 *    une ligne porte un nouveau statut.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connecter, creerUtilisateur, RACINE } from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-09-29-subscriptions-status.sql');
const ROLLBACK = join(RACINE, 'migrations/2026-09-29-subscriptions-status.rollback.sql');

const ANCIENS = ['active', 'canceled', 'expired', 'past_due'];
const STRIPE = [
  'active', 'canceled', 'incomplete', 'incomplete_expired',
  'past_due', 'paused', 'trialing', 'unpaid',
];
const RETENUS = [...new Set([...ANCIENS, ...STRIPE])];

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

async function preparer(): Promise<void> {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(readFileSync(join(RACINE, 'tests-pg/schema-prealable.sql'), 'utf-8'));
  await db.query(readFileSync(join(RACINE, 'tests-pg/schema-subscriptions.sql'), 'utf-8'));
}

const jouer = (fichier: string) => db.query(readFileSync(fichier, 'utf-8'));

let n = 0;
async function inserer(status: string) {
  n += 1;
  const u = await creerUtilisateur(db, 0);
  return db.query(
    `insert into public.subscriptions (user_id, plan, status, stripe_subscription_id)
     values ($1, 'pro', $2, $3)`,
    [u, status, `sub_test_${n}`],
  );
}

async function contraintesStatus() {
  const { rows } = await db.query<{ conname: string; def: string; valide: boolean }>(
    `select c.conname, pg_get_constraintdef(c.oid) as def, c.convalidated as valide
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'public.subscriptions'::regclass
        and c.contype = 'c' and a.attname = 'status'`,
  );
  return rows;
}

beforeEach(async () => { await preparer(); });

describe('0. Le bug, avant migration', () => {
  it('le schema recopie porte bien subscriptions_status_check', async () => {
    const cs = await contraintesStatus();
    expect(cs.map((c) => c.conname)).toEqual(['subscriptions_status_check']);
  });

  it.each(['trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'])(
    '%s est rejete par l\'ancienne contrainte', async (s) => {
      await expect(inserer(s)).rejects.toThrow(/subscriptions_status_check/);
    },
  );
});

describe('1. Apres migration', () => {
  beforeEach(async () => { await jouer(MIGRATION); });

  it.each(RETENUS)('accepte %s', async (s) => {
    await expect(inserer(s)).resolves.toBeTruthy();
  });

  it.each(['cancelled', 'inconnu', 'ACTIVE', ''])('rejette %j', async (s) => {
    await expect(inserer(s)).rejects.toThrow(/subscriptions_status_check/);
  });

  it('une seule contrainte, nommee subscriptions_status_check, validee', async () => {
    const cs = await contraintesStatus();
    expect(cs).toHaveLength(1);
    expect(cs[0].conname).toBe('subscriptions_status_check');
    expect(cs[0].valide).toBe(true);
  });

  it('le type de la colonne ne change pas (varchar(20))', async () => {
    const { rows } = await db.query(
      `select data_type, character_maximum_length as l from information_schema.columns
        where table_schema='public' and table_name='subscriptions' and column_name='status'`,
    );
    expect(rows[0]).toEqual({ data_type: 'character varying', l: 20 });
  });

  it('la contrainte sur plan n\'est pas touchee', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(db.query(
      `insert into public.subscriptions (user_id, plan, status) values ($1, 'gold', 'active')`, [u],
    )).rejects.toThrow(/subscriptions_plan_check/);
  });
});

describe('2. Rejouabilite et nom de contrainte inconnu', () => {
  it('se joue deux fois sans erreur, les donnees restent', async () => {
    await inserer('past_due');
    await jouer(MIGRATION);
    await inserer('trialing');
    await expect(jouer(MIGRATION)).resolves.toBeTruthy();
    const cs = await contraintesStatus();
    expect(cs).toHaveLength(1);
    const { rows } = await db.query('select status from public.subscriptions order by status');
    expect(rows.map((r) => r.status)).toEqual(['past_due', 'trialing']);
  });

  it('remplace une contrainte d\'un autre nom', async () => {
    await db.query(`alter table public.subscriptions drop constraint subscriptions_status_check;
      alter table public.subscriptions add constraint statut_autorise
        check (status in ('active', 'canceled', 'expired', 'past_due'));`);
    await jouer(MIGRATION);
    const cs = await contraintesStatus();
    expect(cs.map((c) => c.conname)).toEqual(['subscriptions_status_check']);
    await expect(inserer('unpaid')).resolves.toBeTruthy();
  });

  it('pose la contrainte si la table n\'en avait aucune', async () => {
    await db.query('alter table public.subscriptions drop constraint subscriptions_status_check');
    await jouer(MIGRATION);
    await expect(inserer('paused')).resolves.toBeTruthy();
    await expect(inserer('inconnu')).rejects.toThrow(/subscriptions_status_check/);
  });

  it('echoue SANS RIEN CHANGER si une ligne existante porte un statut hors liste', async () => {
    await db.query('alter table public.subscriptions drop constraint subscriptions_status_check');
    await inserer('bizarre');
    await expect(jouer(MIGRATION)).rejects.toThrow(/subscriptions_status_check/);
    // Le bloc est atomique : pas de contrainte a moitie posee.
    expect(await contraintesStatus()).toHaveLength(0);
  });
});

describe('3. Rollback', () => {
  it('restaure la liste etroite quand aucune ligne n\'utilise les nouveaux statuts', async () => {
    await jouer(MIGRATION);
    await inserer('active');
    await jouer(ROLLBACK);
    await expect(inserer('trialing')).rejects.toThrow(/subscriptions_status_check/);
    await expect(inserer('expired')).resolves.toBeTruthy();
    await expect(jouer(ROLLBACK)).resolves.toBeTruthy();
    expect(await contraintesStatus()).toHaveLength(1);
  });

  it('REFUSE et ne change rien si une ligne porte un nouveau statut', async () => {
    await jouer(MIGRATION);
    await inserer('trialing');
    await expect(jouer(ROLLBACK)).rejects.toThrow(/Rollback refuse.*trialing=1/);
    // La contrainte large est toujours la.
    await expect(inserer('unpaid')).resolves.toBeTruthy();
  });

  it('migration -> rollback -> migration', async () => {
    await jouer(MIGRATION);
    await jouer(ROLLBACK);
    await jouer(MIGRATION);
    await expect(inserer('incomplete_expired')).resolves.toBeTruthy();
  });
});
