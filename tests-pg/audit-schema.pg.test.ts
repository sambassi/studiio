/**
 * `ops/audit-schema-production.sql` — validation sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce script est destiné à être lancé à la main sur la base de production. Il
 * prétend deux choses : que sa syntaxe est valide, et qu'il ne peut rien
 * écrire. Les deux méritent une preuve du moteur, pas une relecture.
 *
 * La première est évidente — un `DO` block de deux cents lignes ne se vérifie
 * pas à l'œil. La seconde l'est moins : `BEGIN TRANSACTION READ ONLY` est une
 * garantie de PostgreSQL, pas une promesse du script. Le test la met à
 * l'épreuve en injectant une écriture volontaire et en exigeant que le moteur
 * la refuse.
 *
 * Le fichier versionné est joué TEL QUEL, jamais recopié : un test qui
 * réécrirait le script ne testerait que sa propre copie.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connecter, RACINE, MIGRATIONS } from './harness';

const SCRIPT = join(RACINE, 'ops/audit-schema-production.sql');
const SCHEMA_PRODUCTION = join(RACINE, 'tests-pg/schema-production.sql');

const scriptTexte = () => readFileSync(SCRIPT, 'utf-8');

let db: Client;

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

/** Repose la base sur le schéma réel de production, sans migration. */
async function poserProduction() {
  await db.query('drop schema if exists public cascade; create schema public;');
  await db.query(readFileSync(SCHEMA_PRODUCTION, 'utf-8'));
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.users (id, email, credits)
       values (gen_random_uuid(), $1, $2) returning id`,
      [`compte${i}@studiio.test`, 100 + i * 10],
    );
    ids.push(rows[0].id);
  }
  for (const id of ids) {
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type)
       values ($1, -10, 'render')`, [id],
    );
  }
  return ids;
}

/**
 * Joue le script sur une connexion NEUVE et collecte ses `RAISE NOTICE`.
 *
 * Connexion dédiée : le script ouvre et referme sa propre transaction, il ne
 * doit pas hériter d'un état laissé par un autre test.
 */
async function jouerScript(texte = scriptTexte()) {
  const client = await connecter();
  const notices: string[] = [];
  client.on('notice', (n) => notices.push(n.message ?? ''));
  try {
    await client.query(texte);
    return { ok: true as const, notices, erreur: null };
  } catch (e) {
    return {
      ok: false as const,
      notices,
      erreur: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await client.end();
  }
}

/** Empreinte complète du schéma ET des données, pour comparaison avant/après. */
async function empreinte() {
  const objets = await db.query(
    `select 'table' as sorte, c.relname as nom, '' as detail
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')
     union all
     select 'colonne', table_name || '.' || column_name,
            data_type || coalesce('(' || character_maximum_length || ')','') || '/' || is_nullable
       from information_schema.columns where table_schema = 'public'
     union all
     select 'contrainte', con.conname, pg_get_constraintdef(con.oid)
       from pg_constraint con join pg_class cl on cl.oid = con.conrelid
       join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public'
     union all
     select 'index', indexname, indexdef from pg_indexes where schemaname = 'public'
     union all
     select 'fonction', p.proname, pg_get_function_identity_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
     order by 1, 2, 3`,
  );
  const donnees = await db.query(
    `select (select count(*) from public.users)                       as users,
            (select coalesce(sum(credits),0) from public.users)       as credits,
            (select count(*) from public.credit_transactions)         as tx,
            (select coalesce(sum(amount),0) from public.credit_transactions) as montants,
            (select coalesce(string_agg(id::text, ',' order by id), '') from public.users) as ids_users,
            (select coalesce(string_agg(id::text, ',' order by id), '') from public.credit_transactions) as ids_tx`,
  );
  return { objets: objets.rows, donnees: donnees.rows[0] };
}

// ════════════════════════════════════════════════════════════════════════════

describe('Le script est joué tel qu il est versionné', () => {
  it('le fichier existe et porte les garanties annoncées', () => {
    const t = scriptTexte();
    expect(t).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(t.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    // ASCII pur : c'est ce qui l'a rendu robuste au copier-coller entre
    // terminaux, après une corruption constatée sur la version précédente.
    expect(/^[\x00-\x7F]*$/.test(t)).toBe(true);
  });
});

describe('1. Syntaxe valide sur PostgreSQL 16', () => {
  beforeEach(async () => { await poserProduction(); });

  it('la version du moteur est bien 16', async () => {
    // `show server_version` nomme sa colonne `server_version`, pas `v` :
    // le `as` n'est possible que par `current_setting`.
    const { rows } = await db.query<{ v: string }>(
      "select current_setting('server_version') as v",
    );
    expect(rows[0].v.startsWith('16.')).toBe(true);
  });

  it('le script s exécute sans la moindre erreur', async () => {
    const r = await jouerScript();
    expect(r.erreur).toBeNull();
    expect(r.ok).toBe(true);
  });

  it('il parcourt bien ses quatre sections', async () => {
    const { notices } = await jouerScript();
    const tout = notices.join('\n');
    expect(tout).toContain('1. OBJETS QUI DOIVENT DEJA EXISTER');
    expect(tout).toContain('2. COLONNES CREEES PAR LA MIGRATION');
    expect(tout).toContain('3. OBJETS QUI DOIVENT ETRE ABSENTS');
    expect(tout).toContain('4. TEMOINS');
  });

  it('il rend un verdict', async () => {
    const { notices } = await jouerScript();
    expect(notices.some((n) => n.includes('VERDICT'))).toBe(true);
  });
});

describe('2. Il s exécute jusqu au ROLLBACK', () => {
  it('la connexion reste utilisable après, sans transaction ouverte', async () => {
    await poserProduction();
    const client = await connecter();
    await client.query(scriptTexte());
    // Si le ROLLBACK n'avait pas été atteint, la transaction resterait
    // ouverte et cette requête partirait dedans.
    const { rows } = await client.query<{ etat: string }>(
      "select case when txid_current_if_assigned() is null then 'aucune' else 'ouverte' end as etat",
    );
    expect(rows[0].etat).toBe('aucune');
    await client.end();
  });
});

describe('3. La transaction est réellement READ ONLY', () => {
  it('le script le déclare au moteur, dès sa première instruction', async () => {
    await poserProduction();
    // On mesure le drapeau DEPUIS l'intérieur de la transaction du script.
    const client = await connecter();
    const notices: string[] = [];
    client.on('notice', (n) => notices.push(n.message ?? ''));
    const sonde = scriptTexte().replace(
      'BEGIN TRANSACTION READ ONLY;',
      "BEGIN TRANSACTION READ ONLY;\nDO $sonde$ BEGIN RAISE NOTICE 'read_only=%',"
      + " current_setting('transaction_read_only'); END $sonde$;",
    );
    await client.query(sonde);
    await client.end();
    expect(notices.some((n) => n === 'read_only=on')).toBe(true);
  });
});

describe('4. Aucune modification — schéma ni données', () => {
  it('le schéma et les données sont identiques, au caractère près', async () => {
    await poserProduction();
    const avant = await empreinte();
    const r = await jouerScript();
    expect(r.erreur).toBeNull();
    const apres = await empreinte();
    expect(apres.objets).toEqual(avant.objets);
    expect(apres.donnees).toEqual(avant.donnees);
  });

  it('les identifiants de chaque ligne sont inchangés', async () => {
    await poserProduction();
    const avant = await empreinte();
    await jouerScript();
    const apres = await empreinte();
    expect(apres.donnees.ids_users).toBe(avant.donnees.ids_users);
    expect(apres.donnees.ids_tx).toBe(avant.donnees.ids_tx);
    expect(String(avant.donnees.ids_tx).length).toBeGreaterThan(0);
  });

  it('même après le passage des deux migrations, il ne modifie rien', async () => {
    await poserProduction();
    for (const m of MIGRATIONS) await db.query(readFileSync(m, 'utf-8'));
    const avant = await empreinte();
    const r = await jouerScript();
    expect(r.erreur).toBeNull();
    const apres = await empreinte();
    expect(apres.objets).toEqual(avant.objets);
    expect(apres.donnees).toEqual(avant.donnees);
  });
});

describe('5. MUTATION — une écriture volontaire est refusée par le moteur', () => {
  /**
   * La preuve décisive. On injecte une écriture réelle dans la transaction du
   * script. Si `BEGIN TRANSACTION READ ONLY` tient sa promesse, PostgreSQL la
   * refuse lui-même — aucune garde applicative n'intervient.
   */
  const injections: Array<[string, string]> = [
    ['INSERT', "INSERT INTO public.users (id, email, credits) VALUES (gen_random_uuid(), 'pirate@x.test', 999);"],
    ['UPDATE', "UPDATE public.users SET credits = 0;"],
    ['DELETE', "DELETE FROM public.credit_transactions;"],
    ['CREATE TABLE', 'CREATE TABLE public.intruse (id int);'],
    ['ALTER TABLE', 'ALTER TABLE public.users ADD COLUMN intruse text;'],
  ];

  injections.forEach(([nom, ecriture]) => {
    it(`${nom} injecté dans la transaction du script est refusé`, async () => {
      await poserProduction();
      const avant = await empreinte();

      const mute = scriptTexte().replace(
        'BEGIN TRANSACTION READ ONLY;',
        `BEGIN TRANSACTION READ ONLY;\n${ecriture}`,
      );
      expect(mute).not.toBe(scriptTexte());

      const r = await jouerScript(mute);
      expect(r.ok).toBe(false);
      expect(r.erreur).toMatch(/read-only transaction/i);

      // Et rien n'a bougé, évidemment.
      const apres = await empreinte();
      expect(apres.objets).toEqual(avant.objets);
      expect(apres.donnees).toEqual(avant.donnees);
    });
  });

  it('la même écriture réussit HORS de la transaction — le refus vient bien du READ ONLY', async () => {
    // Sans ce contrôle, le test précédent passerait aussi si l'écriture était
    // invalide pour une tout autre raison.
    await poserProduction();
    await expect(db.query(
      "INSERT INTO public.users (id, email, credits) VALUES (gen_random_uuid(), 'temoin@x.test', 1)",
    )).resolves.toBeTruthy();
  });
});

describe('Le verdict reflète l état réel du schéma', () => {
  it('sur le schéma de production nu : aucun blocage', async () => {
    await poserProduction();
    const { notices } = await jouerScript();
    const verdict = notices.find((n) => n.includes('VERDICT')) ?? '';
    expect(verdict).toContain('SCHEMA COMPATIBLE');
    expect(verdict).toContain('0 blocage');
  });

  it("il annonce l'absence de reference_id comme un état CONFORME", async () => {
    await poserProduction();
    const { notices } = await jouerScript();
    const ligne = notices.find((n) => n.includes('reference_id')) ?? '';
    expect(ligne).toContain('ETAT INITIAL CONFORME');
  });

  it('après migration, il refuse de laisser migrer une seconde fois', async () => {
    await poserProduction();
    for (const m of MIGRATIONS) await db.query(readFileSync(m, 'utf-8'));
    const { notices } = await jouerScript();
    const verdict = notices.find((n) => n.includes('VERDICT')) ?? '';
    expect(verdict).toContain('NE PAS MIGRER');
  });
});
