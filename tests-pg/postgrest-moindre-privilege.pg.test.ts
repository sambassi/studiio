/**
 * POSTGREST — MOINDRE PRIVILEGE, sur un VRAI PostgreSQL.
 *
 * Ce que seule la base peut prouver :
 *   1. la migration s'applique sur une base qui porte les `grant ... to
 *      public` historiques, se rejoue, et refuse d'etre jouee hors superuser ;
 *   2. `web_anon` (le role anonyme de PostgREST) ne lit NI n'ecrit rien :
 *      users, credits, subscriptions, transactions, fonctions de debit —
 *      y compris si une future migration refait `grant all ... to public` ;
 *   3. `service_role` (le claim du JWT serveur) fait tout ce que l'app fait :
 *      CRUD users / subscriptions, debit atomique, idempotent et concurrent ;
 *      et rien de ce qu'un superuser fait (DDL, TRUNCATE, SET ROLE, COPY
 *      PROGRAM, creation de role) ;
 *   4. `authenticator`, connecte pour de vrai, ne peut basculer QUE vers ces
 *      deux roles — un jeton `role=studiio` (superuser) est refuse ;
 *   5. les tables et fonctions FUTURES (stripe_events, pawapay_deposits…)
 *      sont ouvertes a service_role et fermees a l'anonyme sans aucun grant ;
 *   6. le rollback s'applique, et la migration se rejoue ensuite.
 *
 * Chaque acces « comme PostgREST » se fait dans une transaction avec
 * `set local role`, exactement ce que PostgREST execute pour chaque requete.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  connecter, preparerBase, appliquerMigration, creerUtilisateur, solde,
  transactions, enConcurrence, urlBase, RACINE, type Debit,
} from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-09-29-postgrest-moindre-privilege.sql');
const ROLLBACK = join(RACINE, 'migrations/2026-09-29-postgrest-moindre-privilege.rollback.sql');
const VERIF = join(RACINE, 'migrations/2026-09-29-postgrest-moindre-privilege.verif.sql');

let db: Client;

/**
 * Une base « comme la production » : le socle du harnais (qui pose deja
 * `grant all on users/credit_transactions/rendus to public`) + une table
 * `subscriptions` ouverte a PUBLIC comme le faisaient les migrations
 * historiques (regle de l'ancien CLAUDE.md).
 */
async function baseHistorique(): Promise<void> {
  await preparerBase(db);
  await db.query(`
    grant usage on schema public to public;
    create table public.subscriptions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      plan text not null,
      status text not null,
      stripe_subscription_id text,
      current_period_end timestamptz
    );
    grant all on table public.subscriptions to public;
    create sequence public.compteur_historique;
    grant all on sequence public.compteur_historique to public;
  `);
}

/** Execute `travail` sous `role`, comme PostgREST : transaction + SET LOCAL ROLE, puis ROLLBACK. */
async function commeRole<T>(role: string, travail: (c: Client) => Promise<T>, client: Client = db): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    return await travail(client);
  } finally {
    await client.query('rollback');
  }
}

/** Idem mais valide la transaction (pour observer l'effet d'une ecriture). */
async function commeRoleCommit<T>(role: string, travail: (c: Client) => Promise<T>, client: Client = db): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    const r = await travail(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const REFUS = /permission denied|must be (superuser|owner)|not allowed/i;

beforeAll(async () => {
  db = await connecter();
  // Point de depart deterministe : aucun des trois roles (le cluster de test
  // est partage, un passage precedent a pu les laisser).
  await db.query('drop schema if exists public cascade; create schema public;');
  await appliquerMigration(db, ROLLBACK);
});
afterAll(async () => {
  // Le cluster de test est partage entre fichiers : on rend les roles et les
  // privileges par defaut globaux dans l'etat d'origine.
  if (db) {
    await db.query("do $$ begin if exists (select 1 from pg_roles where rolname = 'authenticator') then alter role authenticator nologin password null; end if; end $$");
    await appliquerMigration(db, ROLLBACK).catch(() => undefined);
    await db.query('drop schema if exists public cascade; create schema public; grant usage on schema public to public;');
    await db.end();
  }
});

describe('1. La migration', () => {
  beforeEach(baseHistorique);

  it('⚠️ AVANT : les grants historiques ouvrent bien users/subscriptions a PUBLIC (le constat)', async () => {
    const { rows } = await db.query(`select
      has_table_privilege('public', 'public.users', 'UPDATE') as users,
      has_table_privilege('public', 'public.subscriptions', 'SELECT') as subs,
      has_table_privilege('public', 'public.credit_transactions', 'INSERT') as tx`);
    expect(rows[0]).toEqual({ users: true, subs: true, tx: true });
  });

  it('s applique, puis se rejoue sans erreur', async () => {
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
  });

  it('refuse d etre jouee par un role non superuser, sans rien laisser derriere', async () => {
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'migrateur_ordinaire') then
        create role migrateur_ordinaire nologin; end if; end $$`);
    await db.query('set role migrateur_ordinaire');
    try {
      await expect(appliquerMigration(db, MIGRATION)).rejects.toThrow(/superuser/);
    } finally {
      await db.query('rollback').catch(() => undefined);
      await db.query('reset role');
    }
  });

  it('les roles ont exactement les attributs attendus', async () => {
    await appliquerMigration(db, MIGRATION);
    const { rows } = await db.query(`select rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls, rolcreaterole, rolcreatedb
      from pg_roles where rolname in ('authenticator','web_anon','service_role') order by rolname`);
    expect(rows).toEqual([
      { rolname: 'authenticator', rolsuper: false, rolcanlogin: false, rolinherit: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
      { rolname: 'service_role', rolsuper: false, rolcanlogin: false, rolinherit: true, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false },
      { rolname: 'web_anon', rolsuper: false, rolcanlogin: false, rolinherit: true, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
    ]);
    const { rows: m } = await db.query(`select g.rolname from pg_auth_members am
      join pg_roles g on g.oid = am.roleid join pg_roles u on u.oid = am.member
      where u.rolname = 'authenticator' order by 1`);
    expect(m.map((r) => r.rolname)).toEqual(['service_role', 'web_anon']);
  });

  it('un role preexistant du meme nom est remis a plat (ex. superuser herite)', async () => {
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'web_anon') then create role web_anon; end if; end $$;
      alter role web_anon superuser createrole`);
    await appliquerMigration(db, MIGRATION);
    const { rows } = await db.query("select rolsuper, rolcreaterole from pg_roles where rolname = 'web_anon'");
    expect(rows[0]).toEqual({ rolsuper: false, rolcreaterole: false });
  });

  it('authenticator perd toute appartenance a un role privilegie posee a la main', async () => {
    await appliquerMigration(db, MIGRATION);
    const { rows: [{ moi }] } = await db.query('select current_user as moi');
    await db.query(`grant ${moi} to authenticator`);
    await appliquerMigration(db, MIGRATION);
    const { rows } = await db.query(`select count(*)::int as n from pg_auth_members am
      join pg_roles g on g.oid = am.roleid join pg_roles u on u.oid = am.member
      where u.rolname = 'authenticator' and g.rolname not in ('web_anon','service_role')`);
    expect(rows[0].n).toBe(0);
  });

  it('le script de verification (lecture seule) conclut OK partout', async () => {
    await appliquerMigration(db, MIGRATION);
    const { readFileSync } = await import('node:fs');
    // Le fichier est ecrit pour psql : on retire les meta-commandes `\echo`
    // et on joue la derniere requete (le verdict) telle quelle.
    const sql = readFileSync(VERIF, 'utf-8');
    const verdict = sql.slice(sql.indexOf('select controle'), sql.lastIndexOf('rollback;'));
    const { rows } = await db.query(verdict);
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(rows.filter((r) => r.verdict !== 'OK')).toEqual([]);
  });
});

describe('2. ⚠️ web_anon (requete SANS jeton) : RIEN', () => {
  let u: string;
  beforeAll(async () => { await baseHistorique(); await appliquerMigration(db, MIGRATION); });
  beforeEach(async () => { u = await creerUtilisateur(db, 100); });

  const refuse = (sql: string, params: unknown[] = []) =>
    expect(commeRole('web_anon', (c) => c.query(sql, params))).rejects.toThrow(REFUS);

  it('ne lit pas users (emails, credits, role)', () => refuse('select id, email, credits, role from public.users'));
  it('ne modifie pas ses credits', () => refuse('update public.users set credits = 999999 where id = $1', [u]));
  it('ne se promeut pas admin', () => refuse("update public.users set role = 'admin' where id = $1", [u]));
  it('ne cree pas de compte', () => refuse("insert into public.users (id, email) values (gen_random_uuid(), 'x@x')"));
  it('ne supprime pas de compte', () => refuse('delete from public.users where id = $1', [u]));
  it('ne lit ni n ecrit subscriptions', async () => {
    await refuse('select * from public.subscriptions');
    await refuse("insert into public.subscriptions (user_id, plan, status) values ($1, 'pro', 'active')", [u]);
  });
  it('ne lit ni n ecrit credit_transactions', async () => {
    await refuse('select * from public.credit_transactions');
    await refuse("insert into public.credit_transactions (user_id, amount, type) values ($1, 1000, 'bonus')", [u]);
  });
  it('n appelle aucune fonction de credits (SECURITY DEFINER)', async () => {
    await refuse("select * from public.debiter_credits_operation($1, 5, 'render', 'x', null)", [u]);
    await refuse("select * from public.debiter_credits($1, 'reel', 'x')", [u]);
  });
  it('n utilise aucune sequence', () => refuse("select nextval('public.compteur_historique')"));

  it('⚠️ AUCUNE table de public n est lisible, quelle qu elle soit', async () => {
    const { rows } = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m')`);
    expect(rows.length).toBeGreaterThan(3);
    for (const { relname } of rows) {
      await expect(commeRole('web_anon', (c) => c.query(`select 1 from public.${relname} limit 1`)), relname)
        .rejects.toThrow(REFUS);
    }
  });

  it('⚠️ une FUTURE migration qui referait `grant all ... to public` ne rouvre rien', async () => {
    await db.query('grant all on table public.users to public; grant all on table public.subscriptions to public;');
    try {
      await refuse('select * from public.users');
      await refuse('update public.users set credits = 1 where id = $1', [u]);
      await refuse('select * from public.subscriptions');
    } finally {
      await db.query('revoke all on table public.users from public; revoke all on table public.subscriptions from public;');
    }
  });

  it('les soldes sont intacts apres toutes ces tentatives', async () => {
    expect(await solde(db, u)).toBe(100);
  });
});

describe('3. service_role (JWT serveur) : ce que fait l app, rien de plus', () => {
  beforeAll(async () => { await baseHistorique(); await appliquerMigration(db, MIGRATION); });

  it('CRUD users', async () => {
    const id = await commeRoleCommit('service_role', async (c) => (await c.query(
      "insert into public.users (id, email, credits) values (gen_random_uuid(), 'svc@test.local', 50) returning id")).rows[0].id as string);
    await commeRoleCommit('service_role', (c) => c.query('update public.users set credits = credits + 10, plan = $2 where id = $1', [id, 'pro']));
    const lu = await commeRole('service_role', async (c) => (await c.query('select credits, plan from public.users where id = $1', [id])).rows[0]);
    expect(lu).toEqual({ credits: 60, plan: 'pro' });
    await commeRoleCommit('service_role', (c) => c.query('delete from public.users where id = $1', [id]));
    expect(await solde(db, id)).toBe(-1);
  });

  it('CRUD subscriptions', async () => {
    const u = await creerUtilisateur(db, 0);
    await commeRoleCommit('service_role', (c) => c.query(
      "insert into public.subscriptions (user_id, plan, status, stripe_subscription_id) values ($1, 'pro', 'active', 'sub_test')", [u]));
    await commeRoleCommit('service_role', (c) => c.query("update public.subscriptions set status = 'canceled' where user_id = $1", [u]));
    const s = await commeRole('service_role', async (c) => (await c.query('select status from public.subscriptions where user_id = $1', [u])).rows);
    expect(s).toEqual([{ status: 'canceled' }]);
    await commeRoleCommit('service_role', (c) => c.query('delete from public.subscriptions where user_id = $1', [u]));
  });

  it('⚠️ debit atomique : solde decremente ET transaction journalisee, idempotent', async () => {
    const u = await creerUtilisateur(db, 100);
    const appel = () => commeRoleCommit('service_role', async (c) => (await c.query<Debit>(
      "select * from public.debiter_credits_operation($1, 30, 'render', 'svc-ref-1', 'test')", [u])).rows[0]);
    expect(await appel()).toMatchObject({ ok: true, solde: 70, deja_debite: false });
    expect(await appel()).toMatchObject({ ok: true, deja_debite: true });
    expect(await solde(db, u)).toBe(70);
    expect(await transactions(db, u)).toEqual([{ amount: -30, type: 'render', reference_id: 'svc-ref-1' }]);
  });

  it('⚠️ debit atomique SOUS service_role et en concurrence : 5 debits de 30 sur 100 → 3 passent, jamais de solde negatif', async () => {
    const u = await creerUtilisateur(db, 100);
    const res = await enConcurrence(5, (c, i) => commeRoleCommit('service_role', async (cc) => (await cc.query<Debit>(
      "select * from public.debiter_credits_operation($1, 30, 'render', $2, null)", [u, `conc-${i}`])).rows[0], c));
    const ok = res.filter((r) => r.ok && r.valeur.ok);
    expect(ok).toHaveLength(3);
    expect(await solde(db, u)).toBe(10);
    expect(await transactions(db, u)).toHaveLength(3);
  });

  it('debiter_credits (tarif par format) passe aussi', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await commeRoleCommit('service_role', async (c) => (await c.query<Debit>(
      "select * from public.debiter_credits($1, 'reel', 'svc-fmt-1')", [u])).rows[0]);
    expect(r.ok).toBe(true);
    expect(await solde(db, u)).toBeLessThan(100);
  });

  it('EXECUTE nomme sur les fonctions de credits et de rendus', async () => {
    const { rows } = await db.query(`select p.oid::regprocedure::text as f,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
      has_function_privilege('web_anon', p.oid, 'EXECUTE') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
        ('debiter_credits','debiter_credits_operation','confirmer_rendu','clore_rendu','confirmer_rendu_sans_debit','lut_assets_ajouter')`);
    expect(rows).toHaveLength(6);
    for (const r of rows) expect({ f: r.f, svc: r.svc, anon: r.anon }).toEqual({ f: r.f, svc: true, anon: false });
  });

  it('⚠️ pas de DDL, pas de TRUNCATE, pas de creation de role, pas de COPY PROGRAM', async () => {
    const refuseSvc = (sql: string) => expect(commeRole('service_role', (c) => c.query(sql))).rejects.toThrow(REFUS);
    await refuseSvc('create table public.pirate (x int)');
    await refuseSvc('drop table public.subscriptions');
    await refuseSvc('alter table public.users add column pirate int');
    await refuseSvc('truncate public.credit_transactions');
    await refuseSvc('create role pirate');
    await refuseSvc("copy (select 1) to program 'true'");
    await refuseSvc('alter role service_role superuser');
  });

});

describe('4. authenticator, connecte pour de vrai (comme PGRST_DB_URI)', () => {
  let auth: Client;
  let moi: string;
  const MOT_DE_PASSE_DE_TEST = 'authenticator-test-seulement';

  beforeAll(async () => {
    await baseHistorique();
    await appliquerMigration(db, MIGRATION);
    moi = (await db.query('select current_user as moi')).rows[0].moi;
    // Mot de passe de TEST, pose comme le runbook le fait en production
    // (`\password authenticator`), jamais dans la migration.
    await db.query(`alter role authenticator login password '${MOT_DE_PASSE_DE_TEST}'`);
    const url = new URL(urlBase());
    url.username = 'authenticator';
    url.password = MOT_DE_PASSE_DE_TEST;
    auth = new Client({ connectionString: url.toString() });
    await auth.connect();
  });
  afterAll(async () => {
    if (auth) await auth.end();
    await db.query('alter role authenticator nologin password null');
  });

  it('sans bascule, il ne voit rien lui-meme (NOINHERIT)', async () => {
    await expect(auth.query('select * from public.users')).rejects.toThrow(REFUS);
  });

  it('bascule vers web_anon → toujours rien', async () => {
    await expect(commeRole('web_anon', (c) => c.query('select * from public.users'), auth)).rejects.toThrow(REFUS);
  });

  it('bascule vers service_role → l app fonctionne', async () => {
    const u = await creerUtilisateur(db, 40);
    const r = await commeRoleCommit('service_role', async (c) => (await c.query<Debit>(
      "select * from public.debiter_credits_operation($1, 15, 'render', 'auth-ref', null)", [u])).rows[0], auth);
    expect(r).toMatchObject({ ok: true, solde: 25 });
  });

  it('⚠️ un jeton `role=studiio` (superuser, proprietaire) est REFUSE', async () => {
    await expect(commeRole(moi, (c) => c.query('select 1'), auth)).rejects.toThrow(REFUS);
  });

  it('⚠️ depuis service_role, impossible de remonter vers le superuser (SET ROLE)', async () => {
    // SET ROLE se juge sur l'utilisateur de CONNEXION : seul ce test-ci,
    // connecte en authenticator, prouve quelque chose.
    await expect(commeRole('service_role', (c) => c.query(`set role ${moi}`), auth)).rejects.toThrow(REFUS);
  });

  it('⚠️ un jeton `role=anon` / `authenticated` (heritage Supabase) est REFUSE', async () => {
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$`);
    await expect(commeRole('anon', (c) => c.query('select 1'), auth)).rejects.toThrow(REFUS);
  });
});

describe('5. Les tables et fonctions FUTURES (stripe_events, pawapay_deposits…)', () => {
  beforeAll(async () => { await baseHistorique(); await appliquerMigration(db, MIGRATION); });

  it('⚠️ une table creee APRES, sans aucun grant, est ouverte a service_role et fermee a web_anon', async () => {
    // Ce que fera une migration future, jouee par le meme role (`studiio`).
    await db.query(`
      create table public.stripe_events (id text primary key, type text not null, recu_le timestamptz default now());
      alter table public.stripe_events enable row level security;
      create table public.pawapay_deposits (id bigserial primary key, user_id uuid references public.users(id), montant numeric not null);
    `);
    await commeRoleCommit('service_role', (c) => c.query("insert into public.stripe_events (id, type) values ('evt_1', 'checkout.session.completed')"));
    const n = await commeRole('service_role', async (c) => (await c.query('select count(*)::int as n from public.stripe_events')).rows[0].n);
    expect(n).toBe(1); // BYPASSRLS : la RLS sans politique ne masque rien au serveur
    const u = await creerUtilisateur(db, 0);
    await commeRoleCommit('service_role', (c) => c.query('insert into public.pawapay_deposits (user_id, montant) values ($1, 10)', [u]));
    await expect(commeRole('web_anon', (c) => c.query('select * from public.stripe_events'))).rejects.toThrow(REFUS);
    await expect(commeRole('web_anon', (c) => c.query('select * from public.pawapay_deposits'))).rejects.toThrow(REFUS);
  });

  it('⚠️ une fonction SECURITY DEFINER creee APRES, fermee a PUBLIC comme le font nos migrations, reste ouverte a service_role', async () => {
    await db.query(`
      create or replace function public.stripe_event_claim(p_id text) returns boolean
        language sql security definer set search_path = pg_catalog, public as $$ select true $$;
      revoke all on function public.stripe_event_claim(text) from public;
      create or replace function public.fonction_oubliee() returns int language sql as $$ select 1 $$;
    `);
    const { rows } = await db.query(`select
      has_function_privilege('service_role', 'public.stripe_event_claim(text)', 'EXECUTE') as svc,
      has_function_privilege('web_anon', 'public.stripe_event_claim(text)', 'EXECUTE') as anon,
      has_function_privilege('web_anon', 'public.fonction_oubliee()', 'EXECUTE') as anon_oubliee`);
    // Meme sans `revoke ... from public`, une nouvelle fonction n'est plus
    // executable par PUBLIC : le defaut global a ete retire.
    expect(rows[0]).toEqual({ svc: true, anon: false, anon_oubliee: false });
  });
});

describe('6. Le rollback', () => {
  beforeAll(async () => { await baseHistorique(); await appliquerMigration(db, MIGRATION); });

  it('supprime les roles, rend le schema a PUBLIC, et la migration se rejoue ensuite', async () => {
    await expect(appliquerMigration(db, ROLLBACK)).resolves.not.toThrow();
    const { rows } = await db.query(`select
      (select count(*)::int from pg_roles where rolname in ('authenticator','web_anon','service_role')) as roles,
      has_schema_privilege('public', 'public', 'USAGE') as usage_public`);
    expect(rows[0]).toEqual({ roles: 0, usage_public: true });
    // Rejouable a vide.
    await expect(appliquerMigration(db, ROLLBACK)).resolves.not.toThrow();
    // Et l'aller refonctionne.
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(commeRole('web_anon', (c) => c.query('select * from public.users'))).rejects.toThrow(REFUS);
  });
});
