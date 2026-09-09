/**
 * A_8b — L'HISTORIQUE D'UN AVATAR SURVIT À SA SUPPRESSION.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CES TESTS EXIGENT UN VRAI POSTGRESQL
 * ---------------------------------------------------------------------------
 *
 * Ce qui est mesuré ici n'est pas une décision — les décisions se lisent dans
 * le SQL. C'est un COMPORTEMENT DU MOTEUR : qu'une clé étrangère `on delete
 * set null` laisse VRAIMENT les lignes filles en place, qu'un `add column if
 * not exists` soit rejouable, et qu'un report conditionnel n'écrive que là où
 * sa condition est vraie.
 *
 * Un faux client rejoue ce qu'on lui programme ; il « prouverait » aussi bien
 * une migration cassée.
 *
 * ⚠️ AUCUN SQL N'EST RECOPIÉ. Les fichiers destinés à la production sont joués
 * tels quels — celui d'origine, puis A_8b par-dessus, dans l'ordre réel.
 *
 * ---------------------------------------------------------------------------
 * LE DÉFAUT QUE LA MIGRATION CORRIGE
 * ---------------------------------------------------------------------------
 *
 * `avatar_generations.user_avatar_id` était `on delete cascade`. Supprimer un
 * avatar — ou simplement le RECRÉER, ce que la route de création fait par un
 * `delete` préalable — emportait toutes les vidéos déjà produites. Des rendus
 * payés, disparus sans un mot.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { connecter, RACINE } from './harness';

const MIGRATIONS_AVATAR = [
  join(RACINE, 'migrations/2026-07-28-user-avatars.sql'),
  join(RACINE, 'migrations/2026-07-28-avatar-type.sql'),
];
const MIGRATION_A8B = join(
  RACINE, 'migrations/2026-09-09-avatar-source-securite-versioning.sql',
);

/** Le strict minimum sur lequel les migrations avatar s'appliquent. */
const PREALABLE = `
create table if not exists public.users (
  id uuid primary key,
  email varchar(255) unique not null,
  name varchar(255),
  credits integer default 10,
  plan varchar(50) default 'free',
  created_at timestamptz default now()
);`;

const CONSENTEMENT_HISTORIQUE =
  "Je certifie etre la personne visible sur l'image et j'autorise Studiio a en creer un avatar anime.";

let db: Client;
const U = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-1111-4111-8111-111111111111';

async function jouer(fichier: string): Promise<void> {
  if (!existsSync(fichier)) throw new Error(`Migration absente : ${fichier}`);
  await db.query(readFileSync(fichier, 'utf-8'));
}

/** La base au socle avatar HISTORIQUE — avant A_8b. */
async function preparerAvantA8b(): Promise<void> {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(PREALABLE);
  for (const f of MIGRATIONS_AVATAR) await jouer(f);
  await db.query('insert into public.users (id, email) values ($1, $2)', [U, 'a@test.local']);
}

/** Un avatar et `n` générations, tels que le produit les écrivait. */
async function poserHistorique(n: number, consentement = CONSENTEMENT_HISTORIQUE): Promise<void> {
  await db.query(
    `insert into public.user_avatars
       (id, user_id, provider_avatar_id, status, source_url, consent_at, consent_text)
     values ($1, $2, 'hg-1', 'completed', 'http://public/visage.jpg', now(), $3)`,
    [A, U, consentement],
  );
  await db.query(
    `insert into public.avatar_generations
       (id, user_id, user_avatar_id, script, aspect_ratio, status,
        credits_charged, credits_refunded, created_at, updated_at)
     select gen_random_uuid(), $1, $2, 'script ' || i, '9:16', 'completed',
            40, false, now(), now()
       from generate_series(1, $3) i`,
    [U, A, n],
  );
}

const colonnes = async (table: string): Promise<Record<string, { type: string; nullable: boolean }>> => {
  const { rows } = await db.query<{ c: string; t: string; n: string }>(
    `select column_name c, data_type t, is_nullable n
       from information_schema.columns where table_name = $1`, [table],
  );
  return Object.fromEntries(rows.map((r) => [r.c, { type: r.t, nullable: r.n === 'YES' }]));
};

const contrainte = async (nom: string): Promise<string | null> => {
  const { rows } = await db.query<{ d: string }>(
    'select pg_get_constraintdef(oid) d from pg_constraint where conname = $1', [nom],
  );
  return rows[0]?.d ?? null;
};

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { await db.end(); });
beforeEach(preparerAvantA8b);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le défaut d’origine, constaté avant correction', () => {
  it('1.1 ⚠️ SANS A_8b, SUPPRIMER UN AVATAR EFFACE SES VIDÉOS', async () => {
    /* Ce test décrit l'ANCIEN comportement et doit rester vert : sans lui,
       rien ne distinguerait « la migration corrige » de « le problème n'a
       jamais existé ». */
    await poserHistorique(3);
    expect(await contrainte('avatar_generations_user_avatar_id_fkey'))
      .toContain('ON DELETE CASCADE');

    await db.query('delete from public.user_avatars where id = $1', [A]);
    const { rows } = await db.query<{ n: string }>(
      'select count(*)::int::text n from public.avatar_generations',
    );
    expect(Number(rows[0].n), 'les 3 générations ont été emportées').toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La migration est additive', () => {
  beforeEach(async () => { await jouer(MIGRATION_A8B); });

  it('2.1 les colonnes historiques sont TOUTES conservées', async () => {
    const c = await colonnes('user_avatars');
    for (const nom of [
      'id', 'user_id', 'provider', 'provider_avatar_id', 'provider_asset_id',
      'name', 'status', 'source_url', 'consent_at', 'consent_text',
      'created_at', 'avatar_type', 'training_error',
    ]) {
      expect(c[nom], `colonne ${nom} perdue`).toBeDefined();
    }
  });

  it('2.2 ⚠️ `source_url` N’EST PAS SUPPRIMÉE', () => {
    /* Les lignes déjà créées n'ont qu'elle pour retrouver leur source : la
       supprimer maintenant rendrait ces avatars aveugles. Elle reste, en
       lecture historique seulement. */
    expect(existsSync(MIGRATION_A8B)).toBe(true);
    const sql = readFileSync(MIGRATION_A8B, 'utf-8');
    expect(sql).not.toMatch(/drop\s+column/i);
    expect(sql).not.toMatch(/drop\s+table/i);
  });

  it('2.3 les nouvelles colonnes sont là, et nullables sauf `version`', async () => {
    const c = await colonnes('user_avatars');
    expect(c.source_object_key?.nullable).toBe(true);
    expect(c.subject_type?.nullable).toBe(true);
    expect(c.consent_version?.nullable).toBe(true);
    expect(c.validated_at?.nullable).toBe(true);
    expect(c.deleted_at?.nullable).toBe(true);
    expect(c.version?.nullable).toBe(false);
    expect((await colonnes('avatar_generations')).avatar_version?.nullable).toBe(true);
  });

  it('2.4 la migration est rejouable', async () => {
    await poserHistorique(2);
    await jouer(MIGRATION_A8B);
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ n: string }>(
      'select count(*)::int::text n from public.avatar_generations',
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le report ne dit que ce qu’il sait', () => {
  it('3.1 ⚠️ `subject_type` VAUT `self` QUAND LE CONSENTEMENT LE PROUVE', async () => {
    /* Le texte historique certifie « être la personne visible » : la ligne
       porte donc DÉJÀ la preuve. Le report ne l'invente pas, il la lit. */
    await poserHistorique(1);
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ s: string | null }>(
      'select subject_type s from public.user_avatars where id = $1', [A],
    );
    expect(rows[0].s).toBe('self');
  });

  it('3.2 ⚠️ UN CONSENTEMENT INCONNU RESTE NULL', async () => {
    /* C'est la moitié qui compte. Si un texte qu'on ne reconnaît pas
       apparaissait, l'affirmer « self » serait une invention — et sur une
       donnée biométrique, une invention est une faute. */
    await poserHistorique(1, 'Consentement d’une autre nature, inconnu du produit.');
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ s: string | null }>(
      'select subject_type s from public.user_avatars where id = $1', [A],
    );
    expect(rows[0].s).toBeNull();
  });

  it('3.3 `version` vaut 1 : une ligne existante EST sa première version', async () => {
    await poserHistorique(1);
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ v: number }>(
      'select version v from public.user_avatars where id = $1', [A],
    );
    expect(rows[0].v).toBe(1);
  });

  it('3.4 ⚠️ `avatar_version` DES GÉNÉRATIONS RESTE NULL', async () => {
    /* Rien en base ne dit quelle version a produit une vidéo passée. Écrire
       « 1 » partout attribuerait les anciennes vidéos au modèle actuel si
       l'avatar avait déjà été refait. NULL dit la vérité : on ne sait pas. */
    await poserHistorique(3);
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::int::text n from public.avatar_generations
        where avatar_version is not null`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('3.5 rien n’est validé d’office', async () => {
    // Un avatar « prêt » chez le fournisseur n'est pas un avatar que son
    // propriétaire accepte de voir parler à sa place.
    await poserHistorique(1);
    await jouer(MIGRATION_A8B);
    const { rows } = await db.query<{ v: string | null; d: string | null }>(
      'select validated_at v, deleted_at d from public.user_avatars where id = $1', [A],
    );
    expect(rows[0].v).toBeNull();
    expect(rows[0].d).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’historique survit', () => {
  beforeEach(async () => { await jouer(MIGRATION_A8B); });

  it('4.1 ⚠️ TROIS GÉNÉRATIONS SURVIVENT À LA SUPPRESSION DE LEUR AVATAR', async () => {
    await poserHistorique(3);
    await db.query('delete from public.user_avatars where id = $1', [A]);

    const { rows } = await db.query<{ n: string; nuls: string }>(
      `select count(*)::int::text n,
              count(*) filter (where user_avatar_id is null)::int::text nuls
         from public.avatar_generations`,
    );
    expect(Number(rows[0].n)).toBe(3);
    expect(Number(rows[0].nuls)).toBe(3);
  });

  it('4.2 la clé étrangère est bien `set null`', async () => {
    expect(await contrainte('avatar_generations_user_avatar_id_fkey'))
      .toContain('ON DELETE SET NULL');
  });

  it('4.3 ⚠️ `user_avatar_id` DEVIENT NULLABLE, ET RIEN D’AUTRE NE CHANGE', async () => {
    /* C'est la contrepartie exacte et minimale de `set null` : sans elle, la
       règle ne peut pas s'appliquer. Le type, lui, est intact. */
    const c = await colonnes('avatar_generations');
    expect(c.user_avatar_id.nullable).toBe(true);
    expect(c.user_avatar_id.type).toBe('uuid');
    // `user_id` garde sa contrainte : une génération appartient toujours à
    // quelqu'un, même quand l'avatar qui l'a faite a disparu.
    expect(c.user_id.nullable).toBe(false);
  });

  it('4.4 les vidéos gardent leur contenu, pas seulement leur ligne', async () => {
    await poserHistorique(2);
    await db.query('delete from public.user_avatars where id = $1', [A]);
    const { rows } = await db.query<{ script: string; credits: number }>(
      'select script, credits_charged credits from public.avatar_generations order by script',
    );
    expect(rows.map((r) => r.script)).toEqual(['script 1', 'script 2']);
    expect(rows.every((r) => r.credits === 40)).toBe(true);
  });

  it('4.5 supprimer le COMPTE emporte bien tout, comme avant', async () => {
    // La cascade sur `users` n'est pas touchée : un compte supprimé ne laisse
    // pas de vidéos orphelines derrière lui.
    await poserHistorique(2);
    await db.query('delete from public.users where id = $1', [U]);
    const { rows } = await db.query<{ n: string }>(
      'select count(*)::int::text n from public.avatar_generations',
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
