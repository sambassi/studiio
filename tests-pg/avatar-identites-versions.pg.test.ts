/**
 * MULTI-AVATARS (#532) DANS LE MODÈLE DE MOINDRE PRIVILÈGE (#533), sur un
 * VRAI PostgreSQL.
 *
 * Ordre de production : chaîne des migrations avatar, puis
 * `2026-09-29-postgrest-moindre-privilege.sql` (#533, appliquée le
 * 2026-10-09), puis `2026-10-10-avatar-identites-versions.sql` (#532).
 *
 * Ce que seule la base prouve :
 *   1. la migration s'applique après #533 et se rejoue ;
 *   2. les fonctions SECURITY DEFINER ont un search_path figé, ne sont
 *      exécutables NI par PUBLIC NI par web_anon, et le sont par
 *      service_role (le backend) ;
 *   3. web_anon ne voit rien de avatar_versions ; service_role y a le DML ;
 *   4. service_role, comme PostgREST le fait (SET LOCAL ROLE), bascule une
 *      version ; une version d'un autre compte est refusée ;
 *   5. la vérification de #533 conclut toujours OK partout ;
 *   6. le rollback de #532 laisse le modèle #533 intact.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, RACINE } from './harness';

const m = (f: string) => join(RACINE, 'migrations', f);
const CHAINE_AVATAR = [
  '2026-07-28-user-avatars.sql', '2026-07-28-avatar-type.sql', '2026-09-15-avatar-schema-foundation.sql',
  '2026-09-15-avatar-one-active-per-user.sql', '2026-09-15-avatar-fournisseur-did.sql',
  '2026-09-15-avatar-jumeau-en-vol.sql', '2026-09-16-avatar-consent-name.sql',
  '2026-10-06-avatar-couts.sql', '2026-10-06-avatar-groupe-consentement.sql',
].map(m);
const CHAINE_AUTOPILOTE = [
  '2026-08-04-autopilot-config.sql', '2026-08-05-autopilot-voice-enabled.sql', '2026-08-06-autopilot-topics.sql',
  '2026-08-06-autopilot-run-hour.sql', '2026-08-07-autopilot-posters.sql', '2026-09-23-autopilot-jumeau.sql',
].map(m);
const MOINDRE = m('2026-09-29-postgrest-moindre-privilege.sql');
const MOINDRE_ROLLBACK = m('2026-09-29-postgrest-moindre-privilege.rollback.sql');
const VERIF = m('2026-09-29-postgrest-moindre-privilege.verif.sql');
const MULTI = m('2026-10-10-avatar-identites-versions.sql');
const MULTI_ROLLBACK = m('rollback/2026-10-10-avatar-identites-versions.rollback.sql');

const REFUS = /permission denied|not allowed/i;
let db: Client;

async function commeRole<T>(role: string, travail: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    return await travail();
  } finally {
    await db.query('rollback');
  }
}

async function baseProduction(): Promise<void> {
  await preparerBase(db);
  await db.query('grant usage on schema public to public');
  for (const f of [...CHAINE_AVATAR, ...CHAINE_AUTOPILOTE]) await appliquerMigration(db, f);
  await appliquerMigration(db, MOINDRE);
  await appliquerMigration(db, MULTI);
}

beforeAll(async () => {
  db = await connecter();
  await db.query('drop schema if exists public cascade; create schema public;');
  await appliquerMigration(db, MOINDRE_ROLLBACK);
  await baseProduction();
}, 60_000);

afterAll(async () => {
  if (!db) return;
  await appliquerMigration(db, MOINDRE_ROLLBACK).catch(() => undefined);
  await db.query('drop schema if exists public cascade; create schema public; grant usage on schema public to public;');
  await db.end();
});

describe('#532 dans le modèle #533', () => {
  it('la migration multi-avatars se rejoue après #533', async () => {
    await expect(appliquerMigration(db, MULTI)).resolves.not.toThrow();
  });

  it('⚠️ fonctions SECURITY DEFINER : search_path figé, fermées à PUBLIC et web_anon, ouvertes à service_role', async () => {
    const { rows } = await db.query(`
      select p.proname, p.prosecdef as secdef,
        exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as sp,
        has_function_privilege('web_anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('activer_version_avatar', 'definir_avatar_par_defaut')
      order by 1`);
    expect(rows).toEqual([
      { proname: 'activer_version_avatar', secdef: true, sp: true, anon: false, svc: true, public: false },
      { proname: 'definir_avatar_par_defaut', secdef: true, sp: true, anon: false, svc: true, public: false },
    ]);
  });

  it('⚠️ web_anon ne lit ni n’écrit avatar_versions ni user_avatars ; service_role a le DML', async () => {
    await expect(commeRole('web_anon', () => db.query('select * from public.avatar_versions'))).rejects.toThrow(REFUS);
    await expect(commeRole('web_anon', () => db.query('select * from public.user_avatars'))).rejects.toThrow(REFUS);
    const { rows } = await db.query(`select
      has_table_privilege('service_role', 'public.avatar_versions', 'SELECT,INSERT,UPDATE,DELETE') as v,
      has_table_privilege('service_role', 'public.user_avatars', 'SELECT,INSERT,UPDATE,DELETE') as a`);
    expect(rows[0]).toEqual({ v: true, a: true });
  });

  it('⚠️ service_role bascule une version (comme PostgREST) ; la version d’un autre compte est refusée', async () => {
    const u = await creerUtilisateur(db, 0);
    const autre = await creerUtilisateur(db, 0);
    const a = (await db.query(`insert into public.user_avatars (user_id, status, provider_avatar_id, validated_at, version,
        consent_at, consent_text, is_default) values ($1, 'completed', 'look-v3', now(), 3, now(), 'x', true) returning id`, [u])).rows[0].id;
    const v3 = (await db.query(`insert into public.avatar_versions (user_avatar_id, user_id, version, status, provider_avatar_id,
        validated_at) values ($1, $2, 3, 'completed', 'look-v3', now()) returning id`, [a, u])).rows[0].id;
    await db.query('update public.user_avatars set active_version_id = $1 where id = $2', [v3, a]);
    const v4 = (await db.query(`insert into public.avatar_versions (user_avatar_id, user_id, version, status, provider_avatar_id,
        validated_at) values ($1, $2, 4, 'completed', 'look-v4', now()) returning id`, [a, u])).rows[0].id;

    // Un autre compte ne peut pas activer la version de u.
    const refus = await commeRole('service_role', async () =>
      (await db.query('select * from public.activer_version_avatar($1, $2, $3, $4)', [autre, a, v4, v3])).rows[0]);
    expect(refus).toEqual({ ok: false, motif: 'introuvable' });

    await db.query('begin');
    await db.query('set local role service_role');
    const ok = (await db.query('select * from public.activer_version_avatar($1, $2, $3, $4)', [u, a, v4, v3])).rows[0];
    await db.query('commit');
    expect(ok).toEqual({ ok: true, motif: null });
    const { rows } = await db.query('select version, provider_avatar_id from public.user_avatars where id = $1', [a]);
    expect(rows[0]).toEqual({ version: 4, provider_avatar_id: 'look-v4' });

    // web_anon ne peut pas l'appeler du tout.
    await expect(commeRole('web_anon', () =>
      db.query('select * from public.activer_version_avatar($1, $2, $3, $4)', [u, a, v3, v4]))).rejects.toThrow(REFUS);
  });

  it('⚠️ la vérification de #533 conclut toujours OK partout', async () => {
    const sql = readFileSync(VERIF, 'utf-8');
    const verdict = sql.slice(sql.indexOf('select controle'), sql.lastIndexOf('rollback;'));
    const { rows } = await db.query(verdict);
    expect(rows.filter((r) => r.verdict !== 'OK')).toEqual([]);
  });

  it('le rollback de #532 laisse le modèle #533 intact', async () => {
    await appliquerMigration(db, MULTI_ROLLBACK);
    const sql = readFileSync(VERIF, 'utf-8');
    const { rows } = await db.query(sql.slice(sql.indexOf('select controle'), sql.lastIndexOf('rollback;')));
    expect(rows.filter((r) => r.verdict !== 'OK')).toEqual([]);
    await appliquerMigration(db, MULTI);
  });
});
