/**
 * `debiter_credits_operation` sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE REMPLACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `deductCredits` (TypeScript) faisait, en trois requêtes séparées :
 * `SELECT credits` → comparaison en JavaScript → `UPDATE credits = <valeur
 * absolue>` → `INSERT` dans le journal.
 *
 * Deux appels concurrents lisaient le même solde et écrivaient la même
 * valeur : un débit disparaissait. Le journal pouvait manquer alors que le
 * solde avait bougé. Et aucune référence n'était écrite, donc un rejeu
 * débitait une seconde fois.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN VRAI MOTEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'atomicité et l'idempotence sont des propriétés du MOTEUR. Un client
 * simulé rejoue ce qu'on lui programme : il « prouverait » aussi bien une
 * implémentation cassée. Les courses ci-dessous partent de connexions
 * distinctes, relâchées par une barrière — jamais d'un `sleep`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, creerUtilisateur, solde, transactions,
  debiterOperation, enConcurrence, urlBase,
} from './harness';

let client: Client;

beforeAll(async () => {
  urlBase();
  client = await connecter();
});
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

// ────────────────────────────────────────────────────────────────────────────
// 1, 6, 7. Le débit nominal
// ────────────────────────────────────────────────────────────────────────────

describe('1. Un débit retire exactement une fois', () => {
  it('le solde est décrémenté du montant, pas d autre chose', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await debiterOperation(client, u, 40, 'avatar:v1');
    expect(r.ok).toBe(true);
    expect(r.deja_debite).toBe(false);
    expect(r.solde).toBe(60);
    expect(await solde(client, u)).toBe(60);
  });

  it('7. une transaction est écrite, et une seule', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 40, 'avatar:v1', 'render', 'avatar');
    const tx = await transactions(client, u);
    expect(tx).toHaveLength(1);
    expect(tx[0].amount).toBe(-40);
    expect(tx[0].reference_id).toBe('avatar:v1');
  });

  it('la raison de l appel est enregistrée, elle ne l était pas', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 3, 'ia:upscale:1', 'render', 'ia:upscale');
    const { rows } = await client.query(
      'select description from public.credit_transactions where user_id = $1', [u],
    );
    expect(rows[0].description).toBe('ia:upscale');
  });
});

describe('6. Solde insuffisant : rien ne bouge', () => {
  it('aucun débit, aucune transaction, motif explicite', async () => {
    const u = await creerUtilisateur(client, 10);
    const r = await debiterOperation(client, u, 40, 'avatar:v1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('solde_insuffisant');
    expect(await solde(client, u)).toBe(10);
    expect(await transactions(client, u)).toHaveLength(0);
  });

  it('le solde ne passe jamais sous zéro, même au centime près', async () => {
    const u = await creerUtilisateur(client, 39);
    const r = await debiterOperation(client, u, 40, 'avatar:v1');
    expect(r.ok).toBe(false);
    expect(await solde(client, u)).toBe(39);
    // Et exactement le montant disponible passe.
    const r2 = await debiterOperation(client, u, 39, 'avatar:v2');
    expect(r2.ok).toBe(true);
    expect(await solde(client, u)).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2, 11, 12. Idempotence
// ────────────────────────────────────────────────────────────────────────────

describe('2. Une référence rejouée ne débite pas deux fois', () => {
  it('le second appel rend `deja_debite`, sans toucher au solde', async () => {
    const u = await creerUtilisateur(client, 100);
    const a = await debiterOperation(client, u, 40, 'avatar:v1');
    const b = await debiterOperation(client, u, 40, 'avatar:v1');
    expect(a.deja_debite).toBe(false);
    expect(b.ok).toBe(true);
    expect(b.deja_debite).toBe(true);
    expect(await solde(client, u)).toBe(60);
    expect(await transactions(client, u)).toHaveLength(1);
  });

  it('même après dix rejeux', async () => {
    const u = await creerUtilisateur(client, 100);
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await debiterOperation(client, u, 5, 'ia:ocr:42');
    }
    expect(await solde(client, u)).toBe(95);
    expect(await transactions(client, u)).toHaveLength(1);
  });

  it('12. la même référence avec un AUTRE montant ne redébite pas non plus', async () => {
    // C'est le cas dangereux : un appelant qui change le prix mais garde la
    // clé. La référence fait foi — sinon elle ne servirait à rien.
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 5, 'ia:ocr:42');
    const b = await debiterOperation(client, u, 500, 'ia:ocr:42');
    expect(b.ok).toBe(true);
    expect(b.deja_debite).toBe(true);
    expect(await solde(client, u)).toBe(95);
    expect(await transactions(client, u)).toHaveLength(1);
  });

  it('deux utilisateurs peuvent porter la MÊME référence', async () => {
    // La clé est `(user_id, reference_id)` : un compte ne doit pas pouvoir
    // bloquer le débit d'un autre en devinant sa référence.
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    expect((await debiterOperation(client, a, 10, 'partage')).ok).toBe(true);
    expect((await debiterOperation(client, b, 10, 'partage')).deja_debite).toBe(false);
    expect(await solde(client, a)).toBe(90);
    expect(await solde(client, b)).toBe(90);
  });

  it('11. une référence vide ou blanche est refusée', async () => {
    const u = await creerUtilisateur(client, 100);
    for (const ref of ['', '   ', '\t']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await debiterOperation(client, u, 10, ref);
      expect(r.ok, JSON.stringify(ref)).toBe(false);
      expect(r.motif).toBe('reference_absente');
    }
    // `null` aussi — sans référence, `reference_id` sortirait de l'index
    // partiel et le débit serait rejouable à l'infini.
    const { rows } = await client.query(
      'select * from public.debiter_credits_operation($1, 10, $2, null, null)',
      [u, 'render'],
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].motif).toBe('reference_absente');
    expect(await solde(client, u)).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9, 10. Le montant, contrôlé par la base
// ────────────────────────────────────────────────────────────────────────────

describe('9 & 10. Un montant aberrant est refusé, pas appliqué', () => {
  it('un montant nul écrirait une trace de débit sans débiter', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await debiterOperation(client, u, 0, 'op:1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('montant_invalide');
    expect(await transactions(client, u)).toHaveLength(0);
  });

  it('un montant négatif CRÉDITERAIT par la porte du débit', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await debiterOperation(client, u, -50, 'op:1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('montant_invalide');
    expect(await solde(client, u)).toBe(100);
  });

  it('un montant au-delà du plafond de sécurité est refusé', async () => {
    const u = await creerUtilisateur(client, 100_000);
    const r = await debiterOperation(client, u, 1001, 'op:1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('montant_invalide');
    expect(await solde(client, u)).toBe(100_000);
    // Le plafond borne une erreur de code, il n'invente pas de tarif :
    // l'opération la plus chère du produit coûte 40.
    expect((await debiterOperation(client, u, 1000, 'op:2')).ok).toBe(true);
  });

  it('un type hors du CHECK de la colonne est refusé lisiblement', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await debiterOperation(client, u, 10, 'op:1', 'avatar');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('type_invalide');
    expect(await transactions(client, u)).toHaveLength(0);
  });

  it('un utilisateur inconnu ne crée rien', async () => {
    const { rows } = await client.query(
      "select * from public.debiter_credits_operation('00000000-0000-0000-0000-000000000000', 10, 'render', 'op:1', null)",
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].motif).toBe('utilisateur_inconnu');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3, 4, 5. Concurrence — sur de vraies connexions
// ────────────────────────────────────────────────────────────────────────────

describe('3. Même référence en concurrence : un seul débit', () => {
  it('huit appels simultanés retirent le montant UNE fois', async () => {
    const u = await creerUtilisateur(client, 100);
    const res = await enConcurrence(8, async (c) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 10, $2, $3, null)',
        [u, 'render', 'course:1'],
      );
      return rows[0];
    });
    const reussis = res.filter((r) => r.ok);
    expect(reussis).toHaveLength(8);
    // Tous rendent `ok`, mais un seul a réellement retiré.
    const reels = reussis.filter((r) => r.ok && !(r.valeur as { deja_debite: boolean }).deja_debite);
    expect(reels).toHaveLength(1);
    expect(await solde(client, u)).toBe(90);
    expect(await transactions(client, u)).toHaveLength(1);
  });
});

describe('4. Opérations distinctes, solde suffisant : toutes passent', () => {
  it('quatre débits de 10 sur 100 crédits', async () => {
    const u = await creerUtilisateur(client, 100);
    const res = await enConcurrence(4, async (c, i) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 10, $2, $3, null)',
        [u, 'render', `op:${i}`],
      );
      return rows[0];
    });
    expect(res.every((r) => r.ok && (r.valeur as { ok: boolean }).ok)).toBe(true);
    expect(await solde(client, u)).toBe(60);
    expect(await transactions(client, u)).toHaveLength(4);
  });
});

describe('5. Opérations distinctes, solde insuffisant : jamais négatif', () => {
  it('six débits de 10 sur 25 crédits — deux passent, le solde reste à 5', async () => {
    const u = await creerUtilisateur(client, 25);
    const res = await enConcurrence(6, async (c, i) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 10, $2, $3, null)',
        [u, 'render', `op:${i}`],
      );
      return rows[0];
    });
    const passes = res.filter((r) => r.ok && (r.valeur as { ok: boolean }).ok);
    expect(passes).toHaveLength(2);
    const restant = await solde(client, u);
    expect(restant).toBe(5);
    expect(restant).toBeGreaterThanOrEqual(0);
    expect(await transactions(client, u)).toHaveLength(2);
  });

  it('la somme des transactions égale toujours ce qui a quitté le solde', async () => {
    const u = await creerUtilisateur(client, 37);
    await enConcurrence(10, async (c, i) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 7, $2, $3, null)',
        [u, 'render', `op:${i}`],
      );
      return rows[0];
    });
    const tx = await transactions(client, u);
    const retire = tx.reduce((n, t) => n + Math.abs(t.amount), 0);
    expect(await solde(client, u)).toBe(37 - retire);
    expect(await solde(client, u)).toBeGreaterThanOrEqual(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La fonction elle-même
// ────────────────────────────────────────────────────────────────────────────

describe('La fonction est installée comme les autres', () => {
  it('SECURITY DEFINER, search_path figé, exécution retirée à public', async () => {
    const { rows } = await client.query(`
      select p.prosecdef, p.proconfig,
             has_function_privilege('public',
               'public.debiter_credits_operation(uuid,integer,text,text,text)',
               'EXECUTE') as public_execute
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'debiter_credits_operation'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toEqual(['search_path=pg_catalog, public']);
    expect(rows[0].public_execute).toBe(false);
  });

  it('elle n a créé ni table, ni colonne, ni index', async () => {
    // La migration ne fait qu'AJOUTER une fonction : elle réutilise l'index
    // unique du 27 août. Un second index serait un doublon silencieux.
    const { rows } = await client.query(`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'credit_transactions'
       order by indexname`);
    const noms = rows.map((r) => r.indexname);
    expect(noms).toContain('credit_transactions_reference_unique');
    expect(noms.filter((n: string) => n.includes('reference'))).toHaveLength(1);
  });

  it('elle s appuie sur l index du 27 août, elle ne le refait pas', async () => {
    const { rows } = await client.query(
      "select indexdef from pg_indexes where indexname = 'credit_transactions_reference_unique'",
    );
    expect(rows[0].indexdef).toContain('(user_id, reference_id)');
    expect(rows[0].indexdef).toContain('WHERE (reference_id IS NOT NULL)');
  });

  it('SANS l index, la concurrence débite plusieurs fois — c est lui qui tient', async () => {
    // Preuve par ABLATION, sur le moteur réel : on retire la garantie et on
    // regarde ce qui se passe. Le pré-contrôle `exists` attrape les rejeux
    // SÉQUENTIELS ; il ne voit rien d'une course, où les deux transactions
    // n'ont pas encore été validées. C'est l'index unique, et lui seul, qui
    // fait échouer la seconde.
    //
    // Sans cette démonstration, l'idempotence « passerait » les tests par la
    // seule vertu du pré-contrôle, et personne ne saurait que l'index porte
    // le cas qui compte.
    const u = await creerUtilisateur(client, 1000);
    await client.query('drop index public.credit_transactions_reference_unique');

    await enConcurrence(8, async (c) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 10, $2, $3, null)',
        [u, 'render', 'ablation:1'],
      );
      return rows[0];
    });

    const tx = await transactions(client, u);
    expect(tx.length, "sans l'index, la même référence débite plusieurs fois")
      .toBeGreaterThan(1);
    expect(await solde(client, u)).toBeLessThan(990);
  });

  it('AVEC l index, la même course ne débite qu une fois', async () => {
    // Le pendant du test précédent, toutes choses égales par ailleurs.
    const u = await creerUtilisateur(client, 1000);
    await enConcurrence(8, async (c) => {
      const { rows } = await c.query(
        'select * from public.debiter_credits_operation($1, 10, $2, $3, null)',
        [u, 'render', 'ablation:2'],
      );
      return rows[0];
    });
    expect(await transactions(client, u)).toHaveLength(1);
    expect(await solde(client, u)).toBe(990);
  });

  it('elle refuse de s installer sans cet index', async () => {
    // La précondition de la migration. Sans elle, la fonction paraîtrait
    // idempotente alors que deux appels simultanés passeraient tous les deux.
    await client.query('drop index public.credit_transactions_reference_unique');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-08-30-debit-operation.sql'), 'utf-8',
    );
    await expect(client.query(sql)).rejects.toThrow(/credit_transactions_reference_unique absent/);
  });
});
