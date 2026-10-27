/**
 * `rembourser_credits_operation` sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE CORRIGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinema IA débite les crédits « au dernier moment », juste avant l'appel au
 * fournisseur (`atelier.ts`). Si cet appel échoue APRÈS avoir été facturé par
 * Studiio (modèle qui refuse l'entrée, délai dépassé, réponse illisible), le
 * compte avait payé pour rien, sans aucun recours. Cette fonction rend les
 * crédits — avec la MÊME discipline que le débit : atomique, idempotente,
 * jamais une seconde écriture de solde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN VRAI MOTEUR
 * ─────────────────────────────────────────────────────────────────────────
 * Même raison que `debit-operation.pg.test.ts` : l'atomicité et l'idempotence
 * sont des propriétés du MOTEUR, pas de ce qu'on lui programme de répondre.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, creerUtilisateur, solde, transactions,
  debiterOperation, rembourserOperation, enConcurrence, urlBase,
} from './harness';

let client: Client;

beforeAll(async () => {
  urlBase();
  client = await connecter();
});
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

describe('1. Un remboursement nominal crédite exactement une fois', () => {
  it('le solde est incrémenté du montant, pas d autre chose', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 40, 'cinema-generation:1');
    expect(await solde(client, u)).toBe(60);

    const r = await rembourserOperation(client, u, 40, 'cinema-generation:1:remboursement');
    expect(r.ok).toBe(true);
    expect(r.deja_rembourse).toBe(false);
    expect(r.solde).toBe(100);
    expect(await solde(client, u)).toBe(100);
  });

  it('une transaction `refund` est écrite, et une seule, à côté du débit', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 15, 'op:1');
    await rembourserOperation(client, u, 15, 'op:1:remboursement', 'échec après paiement');

    const tx = await transactions(client, u);
    expect(tx).toHaveLength(2);
    expect(tx[0]).toMatchObject({ amount: -15, type: 'render', reference_id: 'op:1' });
    expect(tx[1]).toMatchObject({ amount: 15, type: 'refund', reference_id: 'op:1:remboursement' });
  });

  it('aucun contrôle de solde minimum : créditer ne peut jamais échouer pour « solde insuffisant »', async () => {
    // Un compte à 0 crédit (après un débit intégral) doit pouvoir être remboursé.
    const u = await creerUtilisateur(client, 10);
    await debiterOperation(client, u, 10, 'op:1');
    expect(await solde(client, u)).toBe(0);
    const r = await rembourserOperation(client, u, 10, 'op:1:remboursement');
    expect(r.ok).toBe(true);
    expect(await solde(client, u)).toBe(10);
  });
});

describe('2. Une référence rejouée ne rembourse pas deux fois', () => {
  it('le second appel rend `deja_rembourse`, sans toucher au solde', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 40, 'op:1');
    const a = await rembourserOperation(client, u, 40, 'op:1:remboursement');
    const b = await rembourserOperation(client, u, 40, 'op:1:remboursement');
    expect(a.deja_rembourse).toBe(false);
    expect(b.ok).toBe(true);
    expect(b.deja_rembourse).toBe(true);
    expect(await solde(client, u)).toBe(100);
    expect(await transactions(client, u)).toHaveLength(2); // le débit, puis UN remboursement
  });

  it('même après dix rejeux', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 5, 'op:1');
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rembourserOperation(client, u, 5, 'op:1:remboursement');
    }
    expect(await solde(client, u)).toBe(100);
    expect(await transactions(client, u)).toHaveLength(2);
  });

  it('la référence du remboursement DOIT différer de celle du débit — sinon la confusion est possible', async () => {
    // Démonstration du piège que `referenceRemboursement()` (TypeScript) évite :
    // rejouer la MÊME référence que le débit la fait passer pour « déjà vue »,
    // donc le remboursement ne credite jamais.
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 40, 'op:1');
    const r = await rembourserOperation(client, u, 40, 'op:1'); // même référence que le débit !
    expect(r.ok).toBe(true);
    expect(r.deja_rembourse).toBe(true); // confondu avec le débit, aucun crédit n'a eu lieu
    expect(await solde(client, u)).toBe(60); // toujours débité, jamais remboursé
  });

  it('deux utilisateurs peuvent porter la MÊME référence de remboursement', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    await debiterOperation(client, a, 10, 'partage');
    await debiterOperation(client, b, 10, 'partage');
    expect((await rembourserOperation(client, a, 10, 'partage:remboursement')).deja_rembourse).toBe(false);
    expect((await rembourserOperation(client, b, 10, 'partage:remboursement')).deja_rembourse).toBe(false);
    expect(await solde(client, a)).toBe(100);
    expect(await solde(client, b)).toBe(100);
  });
});

describe('3. Garde-fous — une erreur de code ne doit rien bouger', () => {
  it('une référence vide ou blanche est refusée', async () => {
    const u = await creerUtilisateur(client, 100);
    for (const ref of ['', '   ', '\t']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await rembourserOperation(client, u, 10, ref);
      expect(r.ok, JSON.stringify(ref)).toBe(false);
      expect(r.motif).toBe('reference_absente');
    }
    expect(await solde(client, u)).toBe(100);
  });

  it('un montant nul ou négatif est refusé — un négatif DÉBITERAIT par la porte du remboursement', async () => {
    const u = await creerUtilisateur(client, 100);
    for (const montant of [0, -50]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await rembourserOperation(client, u, montant, 'op:1');
      expect(r.ok, String(montant)).toBe(false);
      expect(r.motif).toBe('montant_invalide');
    }
    expect(await solde(client, u)).toBe(100);
  });

  it('un montant au-delà du plafond de sécurité est refusé', async () => {
    const u = await creerUtilisateur(client, 100_000);
    const r = await rembourserOperation(client, u, 1001, 'op:1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('montant_invalide');
    expect(await solde(client, u)).toBe(100_000);
  });

  it('un utilisateur inconnu ne crée rien', async () => {
    const r = await rembourserOperation(
      client, '00000000-0000-0000-0000-000000000000', 10, 'op:1',
    );
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('utilisateur_inconnu');
  });
});

describe('4. Concurrence — un seul remboursement même en course', () => {
  it('huit remboursements simultanés, même référence : un seul crédite réellement', async () => {
    const u = await creerUtilisateur(client, 100);
    await debiterOperation(client, u, 40, 'op:1');
    const res = await enConcurrence(8, async (c) => {
      const { rows } = await c.query(
        'select * from public.rembourser_credits_operation($1, $2, $3, null)',
        [u, 40, 'op:1:remboursement'],
      );
      return rows[0];
    });
    const reussis = res.filter((r) => r.ok);
    expect(reussis).toHaveLength(8);
    const reels = reussis.filter((r) => r.ok && !(r.valeur as { deja_rembourse: boolean }).deja_rembourse);
    expect(reels).toHaveLength(1);
    expect(await solde(client, u)).toBe(100);
    expect(await transactions(client, u)).toHaveLength(2); // débit + UN remboursement
  });
});

describe('La fonction est installée comme `debiter_credits_operation`', () => {
  it('SECURITY DEFINER, search_path figé, exécution retirée à public', async () => {
    const { rows } = await client.query(`
      select p.prosecdef, p.proconfig,
             has_function_privilege('public',
               'public.rembourser_credits_operation(uuid,integer,text,text)',
               'EXECUTE') as public_execute
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'rembourser_credits_operation'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toEqual(['search_path=pg_catalog, public']);
    expect(rows[0].public_execute).toBe(false);
  });

  it('elle n a créé ni table, ni colonne, ni index — elle réutilise celui du débit', async () => {
    const { rows } = await client.query(`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'credit_transactions'
       order by indexname`);
    const noms = rows.map((r) => r.indexname);
    expect(noms.filter((n: string) => n.includes('reference'))).toHaveLength(1);
  });

  it('elle refuse de s installer sans l index unique', async () => {
    await client.query('drop index public.credit_transactions_reference_unique');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-10-30-remboursement-credits-operation.sql'), 'utf-8',
    );
    await expect(client.query(sql)).rejects.toThrow(/credit_transactions_reference_unique absent/);
  });

  it('elle refuse de s installer sans `debiter_credits_operation`', async () => {
    await client.query('drop function public.debiter_credits_operation(uuid,integer,text,text,text)');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-10-30-remboursement-credits-operation.sql'), 'utf-8',
    );
    await expect(client.query(sql)).rejects.toThrow(/debiter_credits_operation absente/);
  });
});
