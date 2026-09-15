import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connecter, preparerBase, appliquerMigration, creerUtilisateur, enConcurrence, RACINE } from './harness';

/**
 * AVATAR-2A — `2026-09-15-avatar-one-active-per-user.sql` : UN SEUL avatar
 * vivant par compte, tenu par la base.
 *
 * - dépend de 1A (`deleted_at`) : sans elle, la migration refuse clairement ;
 * - s'applique, se rejoue ;
 * - un second avatar vivant du même compte → 23505 ; un avatar supprimé
 *   puis un vivant → autorisé ; deux comptes → autorisés ;
 * - deux premières inscriptions SIMULTANÉES (vraies connexions) → une seule ;
 * - des doublons vivants préexistants → la migration S'ARRÊTE sans rien
 *   supprimer, avec le nombre de comptes.
 */

const AVATAR_BASE = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
];
const MIGRATION_1A = join(RACINE, 'migrations/2026-09-15-avatar-schema-foundation.sql');
const MIGRATION = join(RACINE, 'migrations/2026-09-15-avatar-one-active-per-user.sql');
const INDEX = 'user_avatars_one_active_per_user_uidx';

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

async function baseAvec1A() {
  await preparerBase(db);
  for (const m of AVATAR_BASE) await appliquerMigration(db, m);
  await appliquerMigration(db, MIGRATION_1A);
}

const inserer = (client: Client, userId: string, extra: { deleted_at?: string | null; provider?: string | null } = {}) =>
  client.query<{ id: string }>(
    `insert into public.user_avatars (user_id, provider_avatar_id, status, consent_at, consent_text, deleted_at)
     values ($1, $2, 'source_ready', now(), 'Je certifie etre la personne visible', $3) returning id`,
    [userId, extra.provider ?? null, extra.deleted_at ?? null],
  );

const indexPresent = async () => {
  const { rows } = await db.query(`select 1 from pg_indexes where schemaname = 'public' and indexname = $1`, [INDEX]);
  return rows.length === 1;
};

describe('1. Dépendance, application, rejeu', () => {
  it('⚠️ sans la migration 1A (pas de deleted_at) : refus explicite, rien créé', async () => {
    await preparerBase(db);
    for (const m of AVATAR_BASE) await appliquerMigration(db, m);
    await expect(appliquerMigration(db, MIGRATION)).rejects.toThrow(/deleted_at absente/);
    expect(await indexPresent()).toBe(false);
  });

  it('s’applique sur 1A, se rejoue, l’index unique partiel est là', async () => {
    await baseAvec1A();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    const { rows } = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = $1`, [INDEX],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/\(user_id\)/);
    expect(rows[0].indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });
});

describe('2. La contrainte', () => {
  let u1: string; let u2: string;
  beforeEach(async () => {
    await baseAvec1A();
    await appliquerMigration(db, MIGRATION);
    u1 = await creerUtilisateur(db, 0);
    u2 = await creerUtilisateur(db, 0);
  });

  it('un avatar vivant → OK ; un second vivant du même compte → 23505 sur l’index nommé', async () => {
    await inserer(db, u1);
    await expect(inserer(db, u1)).rejects.toMatchObject({ code: '23505', constraint: INDEX });
    const { rows } = await db.query(`select count(*)::int as n from public.user_avatars where user_id = $1`, [u1]);
    expect(rows[0].n).toBe(1);
  });

  it('un avatar SUPPRIMÉ (deleted_at) puis un vivant → autorisé ; plusieurs supprimés → autorisés', async () => {
    await inserer(db, u1, { deleted_at: '2026-09-01T00:00:00Z' });
    await inserer(db, u1, { deleted_at: '2026-09-02T00:00:00Z' });
    await expect(inserer(db, u1)).resolves.toBeTruthy();
    const { rows } = await db.query(`select count(*)::int as n from public.user_avatars where user_id = $1`, [u1]);
    expect(rows[0].n).toBe(3);
  });

  it('soft-delete du vivant, puis un nouveau vivant → autorisé (le cycle 2C)', async () => {
    const { rows } = await inserer(db, u1);
    await db.query(`update public.user_avatars set deleted_at = now() where id = $1`, [rows[0].id]);
    await expect(inserer(db, u1)).resolves.toBeTruthy();
  });

  it('deux comptes différents → chacun le sien', async () => {
    await inserer(db, u1);
    await expect(inserer(db, u2)).resolves.toBeTruthy();
  });

  it('⚠️ deux premières inscriptions SIMULTANÉES du même compte → exactement une ligne vivante', async () => {
    const resultats = await enConcurrence(2, (client) => inserer(client, u1));
    const reussites = resultats.filter((r) => r.ok);
    const echecs = resultats.filter((r) => !r.ok);
    expect(reussites).toHaveLength(1);
    expect(echecs).toHaveLength(1);
    expect((echecs[0] as { erreur: string }).erreur).toMatch(/duplicate key|23505|one_active_per_user/);
    const { rows } = await db.query(
      `select count(*)::int as n from public.user_avatars where user_id = $1 and deleted_at is null`, [u1],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('3. Doublons préexistants : la migration s’arrête, ne supprime rien', () => {
  it('⚠️ deux vivants pour un compte avant l’index → exception avec le nombre de comptes, données intactes, index absent', async () => {
    await baseAvec1A();
    const u1 = await creerUtilisateur(db, 0);
    const u2 = await creerUtilisateur(db, 0);
    await inserer(db, u1); await inserer(db, u1);
    await inserer(db, u2);
    await expect(appliquerMigration(db, MIGRATION)).rejects.toThrow(/1 compte\(s\) ont plusieurs avatars vivants/);
    expect(await indexPresent()).toBe(false);
    const { rows } = await db.query(`select count(*)::int as n from public.user_avatars`);
    expect(rows[0].n).toBe(3);
    // Le prévol documenté dans la migration désigne bien le compte en cause.
    const { rows: prevol } = await db.query<{ user_id: string; vivants: number }>(
      `select user_id, count(*)::int as vivants from public.user_avatars where deleted_at is null group by user_id having count(*) > 1`,
    );
    expect(prevol).toEqual([{ user_id: u1, vivants: 2 }]);
    // Une fois le doublon résolu PAR L'OPÉRATEUR (ici : soft-delete), la migration passe.
    await db.query(
      `update public.user_avatars set deleted_at = now() where id = (select id from public.user_avatars where user_id = $1 order by created_at limit 1)`, [u1],
    );
    await expect(appliquerMigration(db, MIGRATION)).resolves.not.toThrow();
    expect(await indexPresent()).toBe(true);
  });
});
