/**
 * La migration s'applique-t-elle au schéma RÉEL de production ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER RATTRAPE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tous les autres tests PostgreSQL partaient de `schema-prealable.sql`, qui
 * reconstitue `credit_transactions` d'après ce que le DÉPÔT décrit —
 * `reference_id` et `description` comprises. Ils passaient donc au vert sur
 * une base qui n'existe pas.
 *
 * La production n'a jamais reçu ces deux colonnes : `002_complete_schema.sql`
 * les déclare mais contient aussi `create policy if not exists`, une syntaxe
 * qui n'existe dans aucune version de PostgreSQL — toute exécution s'arrête
 * avant la fin. Le précontrôle l'a établi en une ligne :
 *
 *     ERROR: column "reference_id" does not exist
 *
 * Ce fichier part donc de `schema-production.sql`, qui reconstitue la base
 * TELLE QU'ELLE EST, et vérifie que la migration réelle sait s'y appliquer
 * sans toucher à une seule ligne existante.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { connecter, RACINE, MIGRATIONS } from './harness';

let db: Client;

const SCHEMA_PRODUCTION = join(RACINE, 'tests-pg/schema-production.sql');
const SCHEMA_DEPOT = join(RACINE, 'tests-pg/schema-prealable.sql');

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

/** Repose la base sur un schéma donné, sans appliquer de migration. */
async function poserSchema(fichier: string) {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(readFileSync(fichier, 'utf-8'));
}

/** Applique LA migration de production. Jamais recopiée ici. */
async function appliquerMigration(index = 0) {
  const fichier = MIGRATIONS[index];
  if (!existsSync(fichier)) throw new Error(`Migration absente : ${fichier}`);
  await db.query(readFileSync(fichier, 'utf-8'));
}

/** Peuple la base comme une production vivante : des soldes, des écritures. */
async function peupler() {
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.users (id, email, credits)
       values (gen_random_uuid(), $1, $2) returning id`,
      [`ancien${i}@studiio.test`, 100 + i * 10],
    );
    ids.push(rows[0].id);
  }
  for (const id of ids) {
    for (const montant of [-10, -15, 50]) {
      await db.query(
        `insert into public.credit_transactions (user_id, amount, type)
         values ($1, $2, $3)`,
        [id, montant, montant > 0 ? 'purchase' : 'render'],
      );
    }
  }
  return ids;
}

async function colonne(nom: string) {
  const { rows } = await db.query<{
    data_type: string; character_maximum_length: number | null;
    is_nullable: string; column_default: string | null;
  }>(
    `select data_type, character_maximum_length, is_nullable, column_default
       from information_schema.columns
      where table_schema='public' and table_name='credit_transactions'
        and column_name=$1`, [nom],
  );
  return rows[0] ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1 à 3 — la migration s'applique sur le schéma réel
// ════════════════════════════════════════════════════════════════════════════

describe('Le schéma de production, tel qu il est', () => {
  it("1. credit_transactions existe SANS reference_id ni description", async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    expect(await colonne('reference_id')).toBeNull();
    expect(await colonne('description')).toBeNull();
    // Mais la table, elle, existe bien.
    expect(await db.query('select 1 from public.credit_transactions limit 1')).toBeTruthy();
  });

  it('2. et elle contient déjà des transactions', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    const { rows } = await db.query<{ n: string }>('select count(*) as n from public.credit_transactions');
    expect(Number(rows[0].n)).toBe(12);
  });

  it("3. la migration s'applique sans erreur sur ce schéma", async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    // C'est exactement l'étape qui échouait :
    //   ERROR: column "reference_id" does not exist
    await expect(appliquerMigration()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4 — la colonne créée est conforme
// ════════════════════════════════════════════════════════════════════════════

describe('4. La colonne créée', () => {
  beforeAll(async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    await appliquerMigration();
  });

  it('reference_id est varchar(255), nullable, sans défaut', async () => {
    const c = await colonne('reference_id');
    expect(c).not.toBeNull();
    expect(c!.data_type).toBe('character varying');
    expect(c!.character_maximum_length).toBe(255);
    expect(c!.is_nullable).toBe('YES');
    expect(c!.column_default).toBeNull();
  });

  it('description est du texte, nullable, sans défaut', async () => {
    // Elle n'aurait pas fait échouer la migration — elle aurait fait échouer
    // le PREMIER débit réel, après déploiement.
    const c = await colonne('description');
    expect(c).not.toBeNull();
    expect(c!.data_type).toBe('text');
    expect(c!.is_nullable).toBe('YES');
    expect(c!.column_default).toBeNull();
  });

  it("l'index unique partiel a bien été créé", async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'credit_transactions_reference_unique'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef).toMatch(/reference_id IS NOT NULL/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5 & 6 — aucune donnée n'a bougé
// ════════════════════════════════════════════════════════════════════════════

describe('5 & 6. Les données existantes sont intactes', () => {
  it('les anciennes lignes sont toutes là, avec reference_id IS NULL', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    await appliquerMigration();

    const { rows } = await db.query<{ total: string; nulles: string }>(
      `select count(*) as total,
              count(*) filter (where reference_id is null) as nulles
         from public.credit_transactions`,
    );
    expect(Number(rows[0].total)).toBe(12);
    expect(Number(rows[0].nulles)).toBe(12);
  });

  it('aucun remplissage rétroactif : description reste nulle partout', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    await appliquerMigration();
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.credit_transactions where description is not null',
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('comptes, soldes et transactions sont inchangés', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();

    const avant = await db.query<{ users: string; credits: string; tx: string; montants: string }>(
      `select (select count(*) from public.users)                as users,
              (select sum(credits) from public.users)            as credits,
              (select count(*) from public.credit_transactions)  as tx,
              (select sum(amount) from public.credit_transactions) as montants`,
    );

    await appliquerMigration();

    const apres = await db.query<{ users: string; credits: string; tx: string; montants: string }>(
      `select (select count(*) from public.users)                as users,
              (select sum(credits) from public.users)            as credits,
              (select count(*) from public.credit_transactions)  as tx,
              (select sum(amount) from public.credit_transactions) as montants`,
    );

    expect(apres.rows[0]).toEqual(avant.rows[0]);
  });

  it("les identifiants des lignes existantes n'ont pas changé", async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    const avant = await db.query<{ id: string }>(
      'select id from public.credit_transactions order by id',
    );
    await appliquerMigration();
    const apres = await db.query<{ id: string }>(
      'select id from public.credit_transactions order by id',
    );
    expect(apres.rows).toEqual(avant.rows);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7 à 9 — l'index se comporte comme prévu sur ce schéma
// ════════════════════════════════════════════════════════════════════════════

describe("7, 8 & 9. L'index unique partiel, sur le schéma réel", () => {
  let utilisateurs: string[] = [];

  beforeAll(async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    utilisateurs = await peupler();
    await appliquerMigration();
  });

  it('7. plusieurs valeurs NULL restent autorisées pour un même utilisateur', async () => {
    const u = utilisateurs[0];
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `insert into public.credit_transactions (user_id, amount, type)
         values ($1, -10, 'render')`, [u],
      );
    }
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.credit_transactions where user_id = $1 and reference_id is null',
      [u],
    );
    // Les 3 de `peupler` plus les 3 qu'on vient d'ajouter.
    expect(Number(rows[0].n)).toBe(6);
  });

  it('8. un doublon (user_id, reference_id) non NULL est refusé', async () => {
    const u = utilisateurs[1];
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, -10, 'render', 'rendu:abc')`, [u],
    );
    await expect(db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, -10, 'render', 'rendu:abc')`, [u],
    )).rejects.toThrow(/unique|duplicate/i);
  });

  it('9. la même référence reste autorisée pour deux utilisateurs différents', async () => {
    const [a, b] = [utilisateurs[2], utilisateurs[3]];
    for (const u of [a, b]) {
      await db.query(
        `insert into public.credit_transactions (user_id, amount, type, reference_id)
         values ($1, -10, 'render', 'rendu:partage')`, [u],
      );
    }
    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from public.credit_transactions where reference_id = 'rendu:partage'",
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 10 — le chemin où la colonne existe déjà
// ════════════════════════════════════════════════════════════════════════════

describe('10. Quand la colonne existe déjà', () => {
  it("la migration passe sans erreur et ne redéfinit rien", async () => {
    await poserSchema(SCHEMA_DEPOT);   // ce schéma-là PORTE reference_id
    await peupler();
    await expect(appliquerMigration()).resolves.not.toThrow();

    const c = await colonne('reference_id');
    expect(c!.data_type).toBe('character varying');
    expect(c!.character_maximum_length).toBe(255);
    expect(c!.is_nullable).toBe('YES');
  });

  it('les données restent intactes sur ce chemin aussi', async () => {
    await poserSchema(SCHEMA_DEPOT);
    await peupler();
    await appliquerMigration();
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.credit_transactions',
    );
    expect(Number(rows[0].n)).toBe(12);
  });

  it('appliquer deux fois de suite reste sans effet', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    await peupler();
    await appliquerMigration();
    await appliquerMigration();
    const c = await colonne('reference_id');
    expect(c!.character_maximum_length).toBe(255);
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.credit_transactions',
    );
    expect(Number(rows[0].n)).toBe(12);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// La suite complète tient sur le schéma réel
// ════════════════════════════════════════════════════════════════════════════

describe('Les deux migrations, enchaînées sur le schéma réel', () => {
  it('la seconde s applique aussi, et le débit fonctionne de bout en bout', async () => {
    await poserSchema(SCHEMA_PRODUCTION);
    const [u] = await peupler();
    await appliquerMigration(0);
    await appliquerMigration(1);

    const avant = await db.query<{ credits: number }>(
      'select credits from public.users where id = $1', [u],
    );

    const { rows } = await db.query<{ ok: boolean; solde: number }>(
      "select ok, solde from public.debiter_credits($1, 'reel', 'rendu:bout-en-bout')", [u],
    );
    expect(rows[0].ok).toBe(true);
    expect(rows[0].solde).toBe(avant.rows[0].credits - 10);

    // La ligne de journal porte bien les deux colonnes ajoutées.
    const journal = await db.query<{ reference_id: string; description: string }>(
      "select reference_id, description from public.credit_transactions where reference_id = 'rendu:bout-en-bout'",
    );
    expect(journal.rows).toHaveLength(1);
    expect(journal.rows[0].description).toBe('rendu reel');
  });
});
