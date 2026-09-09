/**
 * A_8c — UNE INSCRIPTION EXISTE AVANT TOUT FOURNISSEUR.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UN VRAI POSTGRESQL
 * ---------------------------------------------------------------------------
 *
 * Ce qui est mesuré ici est un COMPORTEMENT DU MOTEUR : qu'une contrainte
 * relâchée laisse vraiment passer un NULL, que les valeurs déjà écrites ne
 * bougent pas, et que la migration soit rejouable.
 *
 * ⚠️ AUCUN SQL N'EST RECOPIÉ : les fichiers de production sont joués tels
 * quels, dans l'ordre réel.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { connecter, RACINE } from './harness';

const MIGRATIONS = [
  'migrations/2026-07-28-user-avatars.sql',
  'migrations/2026-07-28-avatar-type.sql',
  'migrations/2026-09-09-avatar-source-securite-versioning.sql',
].map((f) => join(RACINE, f));
const MIGRATION_A8C = join(
  RACINE, 'migrations/2026-09-09-avatar-provider-id-nullable-enrollment.sql',
);

const PREALABLE = `
create table if not exists public.users (
  id uuid primary key, email varchar(255) unique not null,
  credits integer default 10, created_at timestamptz default now());`;

let db: Client;
const U = '11111111-1111-4111-8111-111111111111';

async function jouer(f: string): Promise<void> {
  if (!existsSync(f)) throw new Error(`Migration absente : ${f}`);
  await db.query(readFileSync(f, 'utf-8'));
}

const nullable = async (colonne: string): Promise<boolean> => {
  const { rows } = await db.query<{ n: string }>(
    `select is_nullable n from information_schema.columns
      where table_name = 'user_avatars' and column_name = $1`, [colonne],
  );
  return rows[0]?.n === 'YES';
};

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(PREALABLE);
  for (const f of MIGRATIONS) await jouer(f);
  await db.query('insert into public.users (id, email) values ($1, $2)', [U, 'a@test.local']);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Avant la migration, l’inscription est impossible', () => {
  it('1.1 ⚠️ LE SCHÉMA EXIGEAIT UN IDENTIFIANT FOURNISSEUR', async () => {
    /* Ce test décrit l'état ANTÉRIEUR et doit rester vert : sans lui, rien ne
       distinguerait « la migration débloque » de « ce n'était pas bloqué ». */
    expect(await nullable('provider_avatar_id')).toBe(false);
    await expect(db.query(
      `insert into public.user_avatars
         (user_id, status, source_object_key, subject_type, consent_at, consent_text)
       values ($1, 'source_ready', $2, 'self', now(), 'texte')`,
      [U, `${U}/avatar/source-1.mp4`],
    )).rejects.toThrow(/provider_avatar_id/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Après la migration', () => {
  beforeEach(async () => { await jouer(MIGRATION_A8C); });

  it('2.1 ⚠️ UNE SOURCE PRÊTE S’ENREGISTRE SANS FOURNISSEUR', async () => {
    expect(await nullable('provider_avatar_id')).toBe(true);
    const { rows } = await db.query<{ s: string; p: string | null; v: string | null }>(
      `insert into public.user_avatars
         (user_id, avatar_type, status, source_object_key, subject_type,
          consent_at, consent_text, consent_version)
       values ($1, 'video', 'source_ready', $2, 'self', now(), 'texte', 'a8c')
       returning status s, provider_avatar_id p, validated_at v`,
      [U, `${U}/avatar/source-1.mp4`],
    );
    expect(rows[0].s).toBe('source_ready');
    expect(rows[0].p).toBeNull();
    // ⚠️ La validation humaine n'a pas eu lieu, et rien ne doit le prétendre.
    expect(rows[0].v).toBeNull();
  });

  it('2.2 ⚠️ LES IDENTIFIANTS DÉJÀ ÉCRITS NE BOUGENT PAS', async () => {
    /* Relâcher une contrainte ne modifie pas les valeurs existantes — mais
       c'est le genre d'évidence qui mérite d'être vérifiée une fois. */
    await db.query(
      `insert into public.user_avatars
         (id, user_id, provider_avatar_id, status, consent_at, consent_text)
       values ('aaaaaaaa-1111-4111-8111-111111111111', $1, 'hg-REEL-42',
               'completed', now(), 'texte')`, [U],
    );
    await jouer(MIGRATION_A8C);
    const { rows } = await db.query<{ p: string }>(
      'select provider_avatar_id p from public.user_avatars');
    expect(rows[0].p).toBe('hg-REEL-42');
  });

  it('2.3 la migration est rejouable', async () => {
    await jouer(MIGRATION_A8C);
    await jouer(MIGRATION_A8C);
    expect(await nullable('provider_avatar_id')).toBe(true);
  });

  it('2.4 ⚠️ REFAIRE SA SOURCE N’EFFACE PAS LES VIDÉOS DÉJÀ PRODUITES', async () => {
    /* La route d'inscription remplace l'identité précédente par un `delete`.
       Sans le `set null` d'A_8b, ce geste emporterait tout l'historique. */
    const { rows: [a] } = await db.query<{ id: string }>(
      `insert into public.user_avatars
         (user_id, status, source_object_key, subject_type, consent_at, consent_text)
       values ($1, 'source_ready', $2, 'self', now(), 'texte') returning id`,
      [U, `${U}/avatar/source-1.mp4`],
    );
    await db.query(
      `insert into public.avatar_generations
         (user_id, user_avatar_id, script, aspect_ratio, status,
          credits_charged, credits_refunded, created_at, updated_at)
       select $1, $2, 'script ' || i, '9:16', 'completed', 40, false, now(), now()
         from generate_series(1, 2) i`, [U, a.id],
    );

    await db.query('delete from public.user_avatars where user_id = $1', [U]);

    const { rows } = await db.query<{ n: string }>(
      'select count(*)::int::text n from public.avatar_generations');
    expect(Number(rows[0].n)).toBe(2);
  });

  it('2.5 le compte reste obligatoire, lui', async () => {
    // Relâcher une contrainte n'en relâche pas d'autres au passage.
    await expect(db.query(
      `insert into public.user_avatars (status, consent_at, consent_text)
       values ('source_ready', now(), 'texte')`,
    )).rejects.toThrow(/user_id/);
  });
});
