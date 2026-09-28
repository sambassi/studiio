/**
 * PawaPay — `pawapay_deposits` et `crediter_depot_pawapay` sur un VRAI
 * PostgreSQL.
 *
 * La migration de production est jouée telle quelle (jamais recopiée). Ce que
 * seule la base peut prouver :
 *
 * 1. Premier crédit : solde + journal `purchase` + dépôt `credite`, ensemble.
 * 2. Rejeu du même dépôt : `deja_credite`, aucun second crédit.
 * 3. N appels concurrents sur N connexions : un seul crédit.
 * 4. Dépôt inexistant, dépôt d'un autre utilisateur, paramètres incohérents :
 *    erreur, RIEN d'écrit.
 * 5. Panne au milieu (contrainte violée à l'insertion du journal) : rollback
 *    complet — solde inchangé, dépôt non crédité — puis re-tentative saine.
 * 6. Référence déjà présente au journal : `deja_credite` sans second crédit.
 * 7. Droits : `public` n'exécute pas la RPC.
 * 8. Migration rejouable ; rollback propre, qui laisse le socle crédits intact.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'path';
import type { Client } from 'pg';
import {
  RACINE, connecter, preparerBase, appliquerMigration, creerUtilisateur, solde,
  transactions, enConcurrence,
} from './harness';

const MIGRATION_PAWAPAY = join(RACINE, 'migrations/2026-09-28-pawapay-deposits.sql');
const ROLLBACK_PAWAPAY = join(RACINE, 'migrations/2026-09-28-pawapay-deposits.rollback.sql');
const SIGNATURE = 'public.crediter_depot_pawapay(uuid,uuid,integer,text)';

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => {
  await preparerBase(db);
  await appliquerMigration(db, MIGRATION_PAWAPAY);
});

async function creerDepot(
  userId: string,
  over: Partial<{ credits: number; pack: string; statut: string; montant: string }> = {},
): Promise<string> {
  const { rows } = await db.query<{ deposit_id: string }>(
    `insert into public.pawapay_deposits (deposit_id, user_id, pack, credits, montant_chf_centimes, montant, devise, pays, statut)
     values (gen_random_uuid(), $1, $2, $3, 900, $4, 'XOF', 'CIV', $5) returning deposit_id`,
    [userId, over.pack ?? 'small', over.credits ?? 50, over.montant ?? '6500', over.statut ?? 'en_attente'],
  );
  return rows[0].deposit_id;
}

const ref = (id: string) => `pawapay:${id}`;

async function crediter(
  client: Client, depositId: string, userId: string | null, credits: number | null, reference = ref(depositId),
): Promise<string> {
  const { rows } = await client.query<{ r: string }>(
    'select public.crediter_depot_pawapay($1, $2, $3, $4) as r',
    [depositId, userId, credits, reference],
  );
  return rows[0].r;
}

async function depot(id: string) {
  const { rows } = await db.query(
    'select statut, credite_le, montant::text as montant from public.pawapay_deposits where deposit_id = $1', [id],
  );
  return rows[0] as { statut: string; credite_le: Date | null; montant: string } | undefined;
}

describe('crediter_depot_pawapay — crédit unique et atomique', () => {
  it('premier crédit : solde, journal purchase et dépôt crédité ensemble', async () => {
    const u = await creerUtilisateur(db, 10);
    const d = await creerDepot(u, { credits: 50 });

    expect(await crediter(db, d, u, 50)).toBe('credite');

    expect(await solde(db, u)).toBe(60);
    expect(await transactions(db, u)).toEqual([{ amount: 50, type: 'purchase', reference_id: ref(d) }]);
    const etat = await depot(d);
    expect(etat?.statut).toBe('credite');
    expect(etat?.credite_le).not.toBeNull();
  });

  it('deuxième appel avec le même depositId : deja_credite, aucun double crédit', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u, { credits: 200, pack: 'medium' });

    expect(await crediter(db, d, u, 200)).toBe('credite');
    expect(await crediter(db, d, u, 200)).toBe('deja_credite');
    expect(await crediter(db, d, u, 200)).toBe('deja_credite');

    expect(await solde(db, u)).toBe(200);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('N appels concurrents sur N connexions : un seul crédit', async () => {
    const u = await creerUtilisateur(db, 5);
    const d = await creerDepot(u, { credits: 500, pack: 'large' });

    const resultats = await enConcurrence(12, (c) => crediter(c, d, u, 500));

    expect(resultats.every((r) => r.ok)).toBe(true);
    const valeurs = resultats.map((r) => (r.ok ? r.valeur : r.erreur));
    expect(valeurs.filter((v) => v === 'credite')).toHaveLength(1);
    expect(valeurs.filter((v) => v === 'deja_credite')).toHaveLength(11);
    expect(await solde(db, u)).toBe(505);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('un dépôt echec relu COMPLETED peut être crédité (aligné sur le store mémoire)', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u, { statut: 'echec' });
    expect(await crediter(db, d, u, 50)).toBe('credite');
    expect(await solde(db, u)).toBe(50);
    expect((await depot(d))?.statut).toBe('credite');
  });

  it('user_id et credits viennent de la LIGNE : paramètres nuls acceptés, ligne fait foi', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u, { credits: 50 });
    expect(await crediter(db, d, null, null)).toBe('credite');
    expect(await solde(db, u)).toBe(50);
  });
});

describe('crediter_depot_pawapay — refus sans écriture', () => {
  it('dépôt inexistant : erreur, rien d’écrit', async () => {
    const u = await creerUtilisateur(db, 10);
    const inconnu = '00000000-0000-4000-8000-000000000001';
    await expect(crediter(db, inconnu, u, 50)).rejects.toThrow(/depot inconnu/);
    expect(await solde(db, u)).toBe(10);
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('dépôt d’un autre utilisateur : erreur, ni l’un ni l’autre crédité', async () => {
    const proprietaire = await creerUtilisateur(db, 10);
    const intrus = await creerUtilisateur(db, 10);
    const d = await creerDepot(proprietaire);

    await expect(crediter(db, d, intrus, 50)).rejects.toThrow(/autre utilisateur/);

    expect(await solde(db, proprietaire)).toBe(10);
    expect(await solde(db, intrus)).toBe(10);
    expect(await transactions(db, proprietaire)).toHaveLength(0);
    expect(await transactions(db, intrus)).toHaveLength(0);
    expect((await depot(d))?.statut).toBe('en_attente');
  });

  it('credits différents du dépôt : erreur, rien d’écrit', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u, { credits: 50 });
    await expect(crediter(db, d, u, 5000)).rejects.toThrow(/credits/);
    expect(await solde(db, u)).toBe(0);
    expect((await depot(d))?.statut).toBe('en_attente');
  });

  it('référence qui ne correspond pas au dépôt : erreur, rien d’écrit', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u);
    await expect(crediter(db, d, u, 50, 'pawapay:autre')).rejects.toThrow(/reference invalide/);
    expect(await solde(db, u)).toBe(0);
    expect(await transactions(db, u)).toHaveLength(0);
  });
});

describe('crediter_depot_pawapay — panne au milieu', () => {
  it('insertion du journal refusée : rollback complet, puis re-tentative saine', async () => {
    const u = await creerUtilisateur(db, 30);
    const d = await creerDepot(u, { credits: 777, pack: 'xlarge' });

    // Panne simulée APRÈS l'incrément du solde : le journal refuse ce montant.
    await db.query('alter table public.credit_transactions add constraint panne_simulee check (amount <> 777)');

    await expect(crediter(db, d, u, 777)).rejects.toThrow(/panne_simulee/);

    expect(await solde(db, u)).toBe(30);
    expect(await transactions(db, u)).toHaveLength(0);
    const etat = await depot(d);
    expect(etat?.statut).toBe('en_attente');
    expect(etat?.credite_le).toBeNull();

    // La panne levée, le rattrapage suivant crédite normalement, une fois.
    await db.query('alter table public.credit_transactions drop constraint panne_simulee');
    expect(await crediter(db, d, u, 777)).toBe('credite');
    expect(await solde(db, u)).toBe(807);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('référence déjà au journal (écrite hors de ce chemin) : deja_credite, pas de second crédit', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u, { credits: 50 });
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id) values ($1, 50, 'purchase', $2)`,
      [u, ref(d)],
    );
    await db.query('update public.users set credits = 50 where id = $1', [u]);

    expect(await crediter(db, d, u, 50)).toBe('deja_credite');

    expect(await solde(db, u)).toBe(50);
    expect(await transactions(db, u)).toHaveLength(1);
    expect((await depot(d))?.statut).toBe('credite');
  });
});

describe('pawapay_deposits — contraintes, droits, index', () => {
  it('statut hors contrat refusé ; montant numeric exact relu en chaîne', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(creerDepot(u, { statut: 'COMPLETED' })).rejects.toThrow(/check/i);
    await expect(creerDepot(u, { pack: 'enorme' })).rejects.toThrow(/check/i);
    const d = await creerDepot(u, { montant: '38701.50' });
    expect((await depot(d))?.montant).toBe('38701.50');
  });

  it('un dépôt credite exige credite_le (et inversement)', async () => {
    const u = await creerUtilisateur(db, 0);
    await expect(creerDepot(u, { statut: 'credite' })).rejects.toThrow(/credite_coherent/);
  });

  it('public n’exécute pas la RPC, role_navigateur non plus', async () => {
    const { rows } = await db.query(
      `select has_function_privilege('public', $1, 'EXECUTE') as pub,
              has_function_privilege('role_navigateur', $1, 'EXECUTE') as nav,
              has_table_privilege('role_navigateur', 'public.pawapay_deposits', 'SELECT') as tab`,
      [SIGNATURE],
    );
    expect(rows[0]).toEqual({ pub: false, nav: false, tab: false });
  });

  it('SECURITY DEFINER et search_path figé', async () => {
    const { rows } = await db.query(
      `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`, [SIGNATURE],
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toEqual(['search_path=pg_catalog, public']);
  });

  it('index du cron (statut, verifie_le nulls first, cree_le)', async () => {
    const { rows } = await db.query(
      `select indexdef from pg_indexes where indexname = 'pawapay_deposits_statut_verifie_le'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(statut, verifie_le NULLS FIRST, cree_le\)/);
  });

  it('ordre du rattrapage : verifie_le ASC NULLS FIRST, puis cree_le', async () => {
    const u = await creerUtilisateur(db, 0);
    const ids: string[] = [];
    for (const [cree, verifie] of [
      ['2026-09-28T10:00:00Z', '2026-09-28T12:00:00Z'],
      ['2026-09-28T11:00:00Z', null],
      ['2026-09-28T09:00:00Z', null],
      ['2026-09-28T08:00:00Z', '2026-09-28T11:30:00Z'],
    ] as const) {
      const d = await creerDepot(u);
      await db.query('update public.pawapay_deposits set cree_le = $2, verifie_le = $3 where deposit_id = $1', [d, cree, verifie]);
      ids.push(d);
    }
    // Même requête que le store (`listerEnAttente`), bornes incluses.
    const { rows } = await db.query(
      `select deposit_id from public.pawapay_deposits
        where statut = 'en_attente' and cree_le <= $1 and cree_le >= $2
        order by verifie_le asc nulls first, cree_le asc limit 10`,
      ['2026-09-28T11:00:00Z', '2026-09-28T08:00:00Z'],
    );
    expect(rows.map((r) => r.deposit_id)).toEqual([ids[2], ids[1], ids[3], ids[0]]);
  });
});

describe('migration et rollback', () => {
  it('la migration est rejouable', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u);
    await appliquerMigration(db, MIGRATION_PAWAPAY);
    expect(await crediter(db, d, u, 50)).toBe('credite');
  });

  it('refuse de s’appliquer sans le socle crédits (index de référence)', async () => {
    await db.query('drop schema if exists public cascade; create schema public;');
    await expect(appliquerMigration(db, MIGRATION_PAWAPAY)).rejects.toThrow(/credits-atomiques/);
  });

  it('le rollback s’applique proprement, deux fois, sans toucher aux crédits accordés', async () => {
    const u = await creerUtilisateur(db, 0);
    const d = await creerDepot(u);
    expect(await crediter(db, d, u, 50)).toBe('credite');

    await appliquerMigration(db, ROLLBACK_PAWAPAY);
    await appliquerMigration(db, ROLLBACK_PAWAPAY);

    const { rows } = await db.query(
      `select to_regclass('public.pawapay_deposits') as t,
              to_regprocedure('public.crediter_depot_pawapay(uuid,uuid,integer,text)') as f,
              to_regclass('public.credit_transactions_reference_unique') as idx`,
    );
    expect(rows[0].t).toBeNull();
    expect(rows[0].f).toBeNull();
    expect(rows[0].idx).not.toBeNull();
    expect(await solde(db, u)).toBe(50);
    expect(await transactions(db, u)).toHaveLength(1);

    // Et la migration se ré-applique après rollback.
    await appliquerMigration(db, MIGRATION_PAWAPAY);
    const d2 = await creerDepot(u);
    expect(await crediter(db, d2, u, 50)).toBe('credite');
  });
});
