/**
 * USERS — contraintes d'identité, sur un VRAI PostgreSQL.
 *
 * Point de départ : `schema-production.sql` (la base telle qu'elle est :
 * `email varchar(255) unique not null`, SANS `stripe_customer_id`). Les
 * fichiers joués sont ceux destinés à la production — migration, rollback,
 * diagnostic — jamais recopiés ici.
 *
 * Ce que seule la base peut prouver :
 *   1. la migration s'applique au schéma réel et se rejoue ;
 *   2. un doublon de casse / d'espaces est REFUSÉ ;
 *   3. un `stripe_customer_id` dupliqué est REFUSÉ, plusieurs NULL passent ;
 *   4. s'il existe déjà des doublons, la migration ÉCHOUE explicitement et
 *      ne crée rien, ne modifie rien, ne supprime rien ;
 *   5. le diagnostic est en lecture seule et montre les doublons ;
 *   6. le rollback retire index et contrainte, garde la colonne et les données.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connecter, RACINE } from './harness';

const SCHEMA_PRODUCTION = join(RACINE, 'tests-pg/schema-production.sql');
const MIGRATION = join(RACINE, 'migrations/2026-09-29-users-contraintes.sql');
const ROLLBACK = join(RACINE, 'migrations/2026-09-29-users-contraintes.rollback.sql');
const DIAGNOSTIC = join(RACINE, 'migrations/2026-09-29-users-contraintes.diagnostic.sql');

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

async function baseProduction() {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(readFileSync(SCHEMA_PRODUCTION, 'utf-8'));
}
const jouer = (f: string) => db.query(readFileSync(f, 'utf-8'));

/** Joue un fichier censé échouer, puis referme la transaction laissée ouverte. */
async function jouerEchec(f: string): Promise<Error> {
  try {
    await jouer(f);
  } catch (e) {
    await db.query('rollback');
    return e as Error;
  }
  throw new Error(`${f} aurait dû échouer`);
}

let n = 0;
async function compte(email: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const cols = ['id', 'email', ...Object.keys(extra)];
  const vals = [`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, email, ...Object.values(extra)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(`insert into public.users (${cols.join(', ')}) values (${ph})`, vals);
  return vals[0] as string;
}

async function codeErreur(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (e: any) { return e.code; }
  return undefined;
}

const empreinte = async () =>
  (await db.query<{ h: string }>(
    "select md5(coalesce(string_agg(u::text, '|' order by u.id), '')) as h from public.users u",
  )).rows[0].h;

/** Les colonnes d'avant la migration seulement : insensible à l'ajout de colonne. */
const lignesAnciennes = async () =>
  (await db.query<{ h: string }>(
    "select md5(coalesce(string_agg((u.id, u.email, u.name, u.credits, u.plan, u.role, u.created_at)::text, '|' order by u.id), '')) as h from public.users u",
  )).rows[0].h;

const index = async () =>
  (await db.query<{ i: string }>(
    "select indexname as i from pg_indexes where schemaname = 'public' and tablename = 'users' order by 1",
  )).rows.map((r) => r.i);

const colonneStripe = async () =>
  (await db.query(
    "select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='stripe_customer_id'",
  )).rowCount === 1;

beforeEach(async () => { await baseProduction(); });

describe('Application sur le schéma réel de production', () => {
  it('ajoute la colonne, les deux index et la contrainte, sans toucher aux lignes', async () => {
    await compte('coach@x.com', { credits: 500 });
    await compte('autre@x.com');
    const avant = await lignesAnciennes();
    expect(await colonneStripe()).toBe(false);

    await jouer(MIGRATION);

    expect(await colonneStripe()).toBe(true);
    expect(await index()).toEqual(expect.arrayContaining([
      'users_email_key', 'users_email_lower_unique', 'users_stripe_customer_id_unique',
    ]));
    expect(await lignesAnciennes()).toBe(avant);
    const { rows } = await db.query('select count(*)::int as c from public.users where stripe_customer_id is null');
    expect(rows[0].c).toBe(2);
  });

  it('se rejoue sans erreur', async () => {
    await jouer(MIGRATION);
    await jouer(MIGRATION);
    expect((await index()).filter((i) => i === 'users_email_lower_unique')).toHaveLength(1);
  });

  it('ne change pas une colonne stripe_customer_id déjà présente', async () => {
    await db.query('alter table public.users add column stripe_customer_id varchar(255)');
    await compte('a@x.com', { stripe_customer_id: 'cus_A' });
    await jouer(MIGRATION);
    const { rows } = await db.query(
      "select data_type from information_schema.columns where table_name='users' and column_name='stripe_customer_id'",
    );
    expect(rows[0].data_type).toBe('character varying');
  });
});

describe('Unicité de l’e-mail, casse et espaces ignorés', () => {
  beforeEach(async () => { await jouer(MIGRATION); await compte('coach@x.com'); });

  it('refuse un doublon de casse', async () => {
    expect(await codeErreur(compte('Coach@X.COM'))).toBe('23505');
  });

  it('refuse un doublon aux espaces de bord près', async () => {
    expect(await codeErreur(compte('  coach@x.com '))).toBe('23505');
  });

  it('refuse un e-mail vide ou fait d’espaces', async () => {
    expect(await codeErreur(compte('   '))).toBe('23514');
  });

  it('accepte une adresse réellement différente', async () => {
    await compte('coach2@x.com');
    expect((await db.query('select count(*)::int as c from public.users')).rows[0].c).toBe(2);
  });

  it('refuse un UPDATE qui recréerait le doublon', async () => {
    const id = await compte('autre@x.com');
    expect(await codeErreur(db.query("update public.users set email = 'COACH@x.com' where id = $1", [id]))).toBe('23505');
  });
});

describe('Unicité partielle de stripe_customer_id', () => {
  beforeEach(async () => { await jouer(MIGRATION); });

  it('refuse le même client Stripe sur deux comptes', async () => {
    await compte('a@x.com', { stripe_customer_id: 'cus_123' });
    expect(await codeErreur(compte('b@x.com', { stripe_customer_id: 'cus_123' }))).toBe('23505');
  });

  it('accepte plusieurs comptes sans client Stripe (NULL)', async () => {
    await compte('a@x.com');
    await compte('b@x.com', { stripe_customer_id: null });
    await compte('c@x.com');
    const { rows } = await db.query('select count(*)::int as c from public.users where stripe_customer_id is null');
    expect(rows[0].c).toBe(3);
  });

  it('refuse un UPDATE qui attribuerait un client déjà pris', async () => {
    await compte('a@x.com', { stripe_customer_id: 'cus_1' });
    const id = await compte('b@x.com');
    expect(await codeErreur(db.query("update public.users set stripe_customer_id = 'cus_1' where id = $1", [id]))).toBe('23505');
  });
});

describe('Doublons déjà présents : refus explicite, aucune donnée touchée', () => {
  it('échoue sur un doublon de casse existant et ne crée rien', async () => {
    await compte('coach@x.com', { credits: 500 });
    await compte('Coach@x.com', { credits: 10 });
    const avant = await empreinte();

    const e = await jouerEchec(MIGRATION);
    expect(e.message).toMatch(/migration refusee — 1 groupe/);

    expect(await empreinte()).toBe(avant);
    expect((await db.query('select count(*)::int as c from public.users')).rows[0].c).toBe(2);
    expect(await index()).not.toContain('users_email_lower_unique');
    expect(await colonneStripe()).toBe(false); // transaction entière annulée
  });

  it('échoue sur un stripe_customer_id déjà partagé', async () => {
    await db.query('alter table public.users add column stripe_customer_id text');
    await compte('a@x.com', { stripe_customer_id: 'cus_X' });
    await compte('b@x.com', { stripe_customer_id: 'cus_X' });
    const avant = await empreinte();

    const e = await jouerEchec(MIGRATION);
    expect(e.message).toMatch(/1 stripe_customer_id en double/);
    expect(await empreinte()).toBe(avant);
    expect(await index()).not.toContain('users_stripe_customer_id_unique');
  });

  it('échoue sur un e-mail vide existant', async () => {
    await compte(' ');
    const e = await jouerEchec(MIGRATION);
    expect(e.message).toMatch(/1 e-mail\(s\) vide/);
  });
});

describe('Diagnostic en lecture seule', () => {
  it('montre les doublons sans rien écrire', async () => {
    await db.query('alter table public.users add column stripe_customer_id text');
    await compte('coach@x.com', { stripe_customer_id: 'cus_X' });
    await compte(' COACH@x.com', { stripe_customer_id: 'cus_X' });
    await compte('seul@x.com');
    const avant = await empreinte();

    const res = (await jouer(DIAGNOSTIC)) as unknown as Array<{ rows: any[] }>;
    expect(res).toHaveLength(7);
    expect(res[1].rows).toHaveLength(1);
    expect(res[1].rows[0].email_normalise).toBe('coach@x.com');
    expect(res[1].rows[0].nb_comptes).toBe('2');
    expect(res[3].rows).toHaveLength(1);
    expect(res[3].rows[0].stripe_customer_id).toBe('cus_X');

    expect(await empreinte()).toBe(avant);
  });

  it('renvoie zéro ligne bloquante sur une base saine', async () => {
    await db.query('alter table public.users add column stripe_customer_id text');
    await compte('a@x.com');
    const res = (await jouer(DIAGNOSTIC)) as unknown as Array<{ rows: any[] }>;
    for (const i of [1, 2, 3, 4, 6]) expect(res[i].rows).toHaveLength(0);
  });
});

describe('Rollback', () => {
  it('retire index et contrainte, garde la colonne et les données, se rejoue', async () => {
    await jouer(MIGRATION);
    await compte('a@x.com', { stripe_customer_id: 'cus_A' });
    const avant = await empreinte();

    await jouer(ROLLBACK);
    await jouer(ROLLBACK);

    const idx = await index();
    expect(idx).not.toContain('users_email_lower_unique');
    expect(idx).not.toContain('users_stripe_customer_id_unique');
    expect(idx).toContain('users_email_key');
    expect(await colonneStripe()).toBe(true);
    expect(await empreinte()).toBe(avant);

    // Retour à l'état d'avant : la casse n'est plus protégée…
    await compte('A@x.com');
    // …et la migration refuse alors de repasser tant que le doublon existe.
    const e = await jouerEchec(MIGRATION);
    expect(e.message).toMatch(/1 groupe/);
  });

  it('est sans effet sur une base où la migration n’a jamais été appliquée', async () => {
    await compte('a@x.com');
    const avant = await empreinte();
    await jouer(ROLLBACK);
    expect(await empreinte()).toBe(avant);
  });
});
