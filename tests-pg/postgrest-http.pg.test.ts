/**
 * POSTGREST EN HTTP — la configuration de PRODUCTION d'aujourd'hui, puis la
 * CIBLE, avec un VRAI PostgREST devant un VRAI PostgreSQL.
 *
 * Constat de production (diagnostic en lecture seule du 2026-10-09) :
 *   PGRST_DB_URI       → utilisateur `studiio` (SUPERUSER, BYPASSRLS)
 *   PGRST_DB_ANON_ROLE → `studiio`
 *   claim `role` de SUPABASE_SERVICE_ROLE_KEY → `studiio`
 *   GET /users SANS jeton, en interne → 200
 *
 * Ici, le superutilisateur de la base de test (`current_user`) joue `studiio`.
 *
 *   AVANT  : on PROUVE la faille (lecture et écriture sans jeton, débit du
 *            compte d'un autre, jeton `role=studiio` accepté, rôle hérité
 *            `anon` membre du superutilisateur).
 *   APRÈS  : migration `2026-09-29-postgrest-moindre-privilege.sql`, puis
 *            PostgREST connecté en `authenticator`, anonyme = `web_anon` :
 *            les 14 contrôles exigés, dont le client `@supabase/postgrest-js`
 *            (celui de `supabaseAdmin`) qui fait ce que fait l'application.
 *   ROLLBACK : l'ancienne configuration refonctionne.
 *
 * Sauté si le binaire `postgrest` est absent (POSTGREST_BIN ou PATH).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { PostgrestClient } from '@supabase/postgrest-js';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, solde, urlBase, RACINE } from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-09-29-postgrest-moindre-privilege.sql');
const ROLLBACK = join(RACINE, 'migrations/2026-09-29-postgrest-moindre-privilege.rollback.sql');

const BIN = process.env.POSTGREST_BIN || 'postgrest';
const BINAIRE_PRESENT = spawnSync(BIN, ['--version']).status === 0;

const SECRET = 'secret-jwt-de-test-seulement-32-caracteres-min';
const MDP_AUTHENTICATOR = 'authenticator-http-test-seulement';
const PORT = 3990 + Math.floor(Math.random() * 5) * 2;

function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corps = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role })}`;
  return `${corps}.${createHmac('sha256', SECRET).update(corps).digest('base64url')}`;
}

let serveur: ChildProcess | null = null;

async function demarrer(uri: string, anon: string): Promise<void> {
  await arreter();
  serveur = spawn(BIN, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: uri,
      PGRST_DB_ANON_ROLE: anon,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_JWT_SECRET: SECRET,
      PGRST_SERVER_PORT: String(PORT),
      PGRST_ADMIN_SERVER_PORT: String(PORT + 1),
      PGRST_DB_POOL: '2',
      PGRST_LOG_LEVEL: 'crit',
    },
    stdio: 'ignore',
  });
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT + 1}/ready`);
      if (r.status === 200) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('PostgREST ne démarre pas');
}

async function arreter(): Promise<void> {
  if (!serveur) return;
  const s = serveur;
  serveur = null;
  await new Promise<void>((resolve) => { s.once('exit', () => resolve()); s.kill('SIGTERM'); setTimeout(resolve, 3000); });
}

const URL_API = `http://127.0.0.1:${PORT}`;
const appel = (chemin: string, init: RequestInit & { role?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.role) headers.set('Authorization', `Bearer ${jwt(init.role)}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${URL_API}${chemin}`, { ...init, headers });
};
/** Le client de `supabaseAdmin` (postgrest-js), avec la clé serveur CIBLE. */
const clientServeur = (role: string) => new PostgrestClient(URL_API, {
  headers: { apikey: jwt(role), Authorization: `Bearer ${jwt(role)}` },
});

let db: Client;
let superuser: string;
let A: string;
let B: string;

/** La base « comme la production » : socle + grants historiques à PUBLIC + tables de Créer, Autopilote, avatar. */
async function baseProduction(): Promise<void> {
  await preparerBase(db);
  await db.query(`
    grant usage on schema public to public;
    create table public.scheduled_posts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), title text, status text default 'draft');
    create table public.autopilot_config (user_id uuid primary key references public.users(id), enabled boolean default false, avatar_id uuid);
    create table public.user_avatars (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), version int not null, status text, provider_avatar_id text, validated_at timestamptz, deleted_at timestamptz);
    create table public.avatar_generations (id uuid primary key default gen_random_uuid(), user_id uuid, user_avatar_id uuid references public.user_avatars(id), avatar_version int, status text);
    grant all on table public.scheduled_posts, public.autopilot_config, public.user_avatars, public.avatar_generations to public;
  `);
  // Rôle hérité de Supabase, comme une restauration de dump peut le laisser :
  // membre du superutilisateur, BYPASSRLS.
  await db.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$`);
  await db.query(`alter role anon bypassrls; grant "${superuser}" to anon`);
  A = await creerUtilisateur(db, 100);
  B = await creerUtilisateur(db, 100);
  await db.query("insert into public.user_avatars (user_id, version, status, provider_avatar_id, validated_at) values ($1, 3, 'completed', 'look-v3', now())", [A]);
}

// En CI, le binaire est installé par le workflow : son absence est une erreur, jamais un saut silencieux.
if (process.env.CI && !BINAIRE_PRESENT) throw new Error(`PostgREST introuvable (${BIN}) : l'étape d'installation de la CI a échoué.`);
const describeSiBinaire = BINAIRE_PRESENT ? describe : describe.skip;

describeSiBinaire('PostgREST en HTTP — production actuelle, puis cible', () => {
  beforeAll(async () => {
    db = await connecter();
    superuser = (await db.query('select current_user as u')).rows[0].u;
    await db.query('drop schema if exists public cascade; create schema public;');
    await appliquerMigration(db, ROLLBACK);
    await baseProduction();
  }, 60_000);

  afterAll(async () => {
    await arreter();
    if (!db) return;
    await db.query("do $$ begin if exists (select 1 from pg_roles where rolname = 'authenticator') then alter role authenticator nologin password null; end if; end $$");
    await appliquerMigration(db, ROLLBACK).catch(() => undefined);
    await db.query(`do $$ declare r text; begin
      foreach r in array array['anon','authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then execute format('drop owned by %I', r); execute format('drop role %I', r); end if;
      end loop; end $$`).catch(() => undefined);
    await db.query('drop schema if exists public cascade; create schema public; grant usage on schema public to public;');
    await db.end();
  }, 60_000);

  describe('AVANT — configuration de production d’aujourd’hui (connexion et anonyme = superutilisateur)', () => {
    beforeAll(async () => { await demarrer(urlBase(), superuser); }, 30_000);

    it('⚠️ GET /users SANS jeton → 200, emails et crédits lisibles', async () => {
      const r = await appel('/users?select=id,email,credits');
      expect(r.status).toBe(200);
      expect((await r.json() as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it('⚠️ PATCH /users SANS jeton → les crédits de B sont réécrits', async () => {
      const r = await appel(`/users?id=eq.${B}`, { method: 'PATCH', body: JSON.stringify({ credits: 999999 }) });
      expect(r.status).toBe(204);
      expect(await solde(db, B)).toBe(999999);
      await db.query('update public.users set credits = 100 where id = $1', [B]);
    });

    it('⚠️ cross-account : un appel SANS jeton débite le compte de B (RPC SECURITY DEFINER, p_user_id libre)', async () => {
      const r = await appel('/rpc/debiter_credits_operation', { method: 'POST', body: JSON.stringify({ p_user_id: B, p_montant: 7, p_type: 'render', p_reference: 'attaque-1' }) });
      expect(r.status).toBe(200);
      expect(await solde(db, B)).toBe(93);
    });

    it('⚠️ un jeton `role=studiio` (la clé serveur actuelle) donne le superutilisateur', async () => {
      const r = await appel('/rpc/debiter_credits', { method: 'POST', role: superuser, body: JSON.stringify({ p_user_id: A, p_format: 'reel', p_reference: 'r-avant' }) });
      expect(r.status).toBe(200);
    });

    it('⚠️ le rôle hérité `anon` hérite des privilèges du superutilisateur (membre)', async () => {
      const { rows } = await db.query("select pg_has_role('anon', $1, 'USAGE') as herite", [superuser]);
      expect(rows[0].herite).toBe(true);
    });
  });

  describe('APRÈS — migration + PostgREST en `authenticator`, anonyme `web_anon`', () => {
    let soldeA: number;
    beforeAll(async () => {
      await arreter();
      await appliquerMigration(db, MIGRATION);
      await db.query(`alter role authenticator login password '${MDP_AUTHENTICATOR}'`);
      const u = new URL(urlBase());
      u.username = 'authenticator';
      u.password = MDP_AUTHENTICATOR;
      await demarrer(u.toString(), 'web_anon');
      soldeA = await solde(db, A);
    }, 60_000);

    it('1. GET /users sans jeton → refusé (401)', async () => {
      expect((await appel('/users?select=id,email,credits')).status).toBe(401);
    });

    it('2. anon ne lit pas et n’écrit pas users ; les soldes sont intacts', async () => {
      expect((await appel(`/users?id=eq.${B}`, { method: 'PATCH', body: JSON.stringify({ credits: 999999 }) })).status).toBe(401);
      expect((await appel('/users', { method: 'POST', body: JSON.stringify({ id: A, email: 'x@x' }) })).status).toBe(401);
      expect(await solde(db, B)).toBe(93);
    });

    it('3. anon n’exécute aucune fonction sensible (débit, rendu, LUT)', async () => {
      for (const [f, corps] of [
        ['debiter_credits_operation', { p_user_id: B, p_montant: 7, p_type: 'render', p_reference: 'attaque-2' }],
        ['debiter_credits', { p_user_id: B, p_format: 'reel', p_reference: 'attaque-3' }],
      ] as const) {
        expect((await appel(`/rpc/${f}`, { method: 'POST', body: JSON.stringify(corps) })).status, f).toBe(401);
      }
      expect(await solde(db, B)).toBe(93);
    });

    it('4-5. un jeton `role=authenticated` (navigateur connecté) est refusé : ni lecture/écriture de B, ni RPC pour B', async () => {
      expect((await appel(`/users?id=eq.${B}`, { role: 'authenticated' })).status).toBe(403);
      expect((await appel('/rpc/debiter_credits_operation', { method: 'POST', role: 'authenticated', body: JSON.stringify({ p_user_id: B, p_montant: 7, p_type: 'render', p_reference: 'attaque-4' }) })).status).toBe(403);
      expect((await appel('/users', { role: 'anon' })).status).toBe(403);
      expect(await solde(db, B)).toBe(93);
    });

    it('6. aucun jeton ne devient superutilisateur : `role=studiio` et `role=postgres` refusés', async () => {
      expect((await appel('/users', { role: superuser })).status).toBe(403);
      expect((await appel('/users', { role: 'postgres' })).status).toBe(403);
    });

    it('7. service_role n’est jamais studiio : ni superuser, ni membre d’un rôle ; le rôle hérité `anon` n’hérite plus de rien', async () => {
      const { rows } = await db.query(`select
        (select rolsuper from pg_roles where rolname = 'service_role') as svc_super,
        (select count(*)::int from pg_auth_members m join pg_roles u on u.oid = m.member where u.rolname = 'service_role') as svc_membre,
        pg_has_role('anon', $1, 'USAGE') as anon_herite,
        (select rolbypassrls from pg_roles where rolname = 'anon') as anon_bypass`, [superuser]);
      expect(rows[0]).toEqual({ svc_super: false, svc_membre: 0, anon_herite: false, anon_bypass: false });
    });

    it('8-9. backend (postgrest-js, clé `role=service_role`) : authentification — lire par email, inscrire, mettre à jour', async () => {
      const c = clientServeur('service_role');
      const lu = await c.from('users').select('id, email, credits').eq('id', A).single();
      expect(lu.error).toBeNull();
      const nouveau = '99999999-9999-4999-8999-999999999999';
      const ins = await c.from('users').insert({ id: nouveau, email: 'inscription@test.local' }).select('id').single();
      expect(ins.error).toBeNull();
      const maj = await c.from('users').update({ name: 'Nouveau' }).eq('id', nouveau);
      expect(maj.error).toBeNull();
      expect((await c.from('users').delete().eq('id', nouveau)).error).toBeNull();
    });

    it('10. crédits : le débit atomique passe par la RPC, une seule fois', async () => {
      const c = clientServeur('service_role');
      const r = await c.rpc('debiter_credits_operation', { p_user_id: A, p_montant: 10, p_type: 'render', p_reference: 'cible-1' });
      expect(r.error).toBeNull();
      expect((r.data as Array<{ ok: boolean }>)[0].ok).toBe(true);
      const rejeu = await c.rpc('debiter_credits_operation', { p_user_id: A, p_montant: 10, p_type: 'render', p_reference: 'cible-1' });
      expect((rejeu.data as Array<{ deja_debite: boolean }>)[0].deja_debite).toBe(true);
      expect(await solde(db, A)).toBe(soldeA - 10);
    });

    it('11-12. Créer (scheduled_posts) et Autopilote (autopilot_config) écrivent et relisent', async () => {
      const c = clientServeur('service_role');
      expect((await c.from('scheduled_posts').insert({ user_id: A, title: 'Mon post' })).error).toBeNull();
      expect((await c.from('autopilot_config').upsert({ user_id: A, enabled: true }, { onConflict: 'user_id' })).error).toBeNull();
      const lu = await c.from('autopilot_config').select('enabled').eq('user_id', A).single();
      expect(lu.data).toEqual({ enabled: true });
    });

    it('13. avatar v3 : lu tel quel, une génération s’y rattache', async () => {
      const c = clientServeur('service_role');
      const a = await c.from('user_avatars').select('id, version, status, provider_avatar_id').eq('user_id', A).is('deleted_at', null).single();
      expect(a.data).toMatchObject({ version: 3, status: 'completed', provider_avatar_id: 'look-v3' });
      const g = await c.from('avatar_generations').insert({ user_id: A, user_avatar_id: a.data!.id, avatar_version: 3, status: 'pending' }).select('id').single();
      expect(g.error).toBeNull();
    });
  });

  describe('14. ROLLBACK — l’ancienne configuration refonctionne', () => {
    it('rollback SQL, puis PostgREST en superutilisateur : la clé `role=studiio` lit à nouveau', async () => {
      await arreter();
      await db.query('alter role authenticator nologin password null');
      await appliquerMigration(db, ROLLBACK);
      await demarrer(urlBase(), superuser);
      const r = await appel('/users?select=id', { role: superuser });
      expect(r.status).toBe(200);
      const { rows } = await db.query("select count(*)::int as n from pg_roles where rolname in ('authenticator','web_anon','service_role')");
      expect(rows[0].n).toBe(0);
    }, 60_000);
  });
});
