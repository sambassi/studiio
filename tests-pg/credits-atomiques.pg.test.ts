/**
 * Débit de crédits : atomicité et idempotence, prouvées sur un VRAI PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER NE PEUT PAS ÊTRE UN TEST MOCKÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `UPDATE … SET credits = credits - coût WHERE credits >= coût` n'est atomique
 * que parce que le moteur sérialise les transactions concurrentes. Un index
 * unique ne déduplique que parce que le moteur le fait respecter. Ces deux
 * propriétés n'existent nulle part dans le JavaScript : un faux client
 * validerait aussi bien une implémentation cassée.
 *
 * L'implémentation d'avant faisait, dans `src/lib/credits/system.ts:33-46` :
 * lire le solde, soustraire en JavaScript, réécrire une valeur absolue, puis
 * journaliser dans une requête séparée. Deux débits concurrents lisaient le
 * même solde et écrivaient la même valeur : un rendu gratuit. Et rejouer la
 * même requête débitait deux fois, `credit_transactions.reference_id` étant
 * en base mais écrit par personne, sans index unique.
 *
 * Le premier test ci-dessous REPRODUIT ce motif sur le vrai moteur : il n'est
 * pas là pour passer au vert un jour, il est là pour prouver que le défaut
 * était réel et qu'il n'était pas une vue de l'esprit.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, rejouerMigration, creerUtilisateur, solde,
  transactions, debiter, enConcurrence,
} from './harness';

let db: Client;

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => { await preparerBase(db); });

// ════════════════════════════════════════════════════════════════════════════
// Le défaut d'origine, reproduit sur le vrai moteur
// ════════════════════════════════════════════════════════════════════════════

describe('Le motif lire-modifier-écrire perd bien une mise à jour', () => {
  it('deux débits concurrents à l ancienne ne retirent qu une fois', async () => {
    const user = await creerUtilisateur(db, 100);

    // Reproduction fidèle de `system.ts:33-41` : SELECT, calcul en JS,
    // UPDATE d'une valeur ABSOLUE. Aucune clause `WHERE credits >= …`.
    const resultats = await enConcurrence(2, async (client) => {
      const { rows } = await client.query<{ credits: number }>(
        'select credits from public.users where id = $1', [user],
      );
      const apres = rows[0].credits - 30;
      // Laisse l'autre connexion lire avant d'écrire — c'est la fenêtre que
      // le code d'origine ouvrait à chaque appel.
      await new Promise((r) => setTimeout(r, 40));
      await client.query('update public.users set credits = $1 where id = $2', [apres, user]);
      return apres;
    });

    expect(resultats.every((r) => r.ok)).toBe(true);
    // 100 - 30 - 30 devrait faire 40. Le motif d'origine rend 70 : la seconde
    // écriture écrase la première. C'est un rendu offert.
    expect(await solde(db, user)).toBe(70);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// La contrainte
// ════════════════════════════════════════════════════════════════════════════

describe('8. L index unique est réellement appliqué', () => {
  it('refuse deux transactions de même utilisateur et même référence', async () => {
    const user = await creerUtilisateur(db, 100);
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, -10, 'render', 'rendu:abc')`, [user],
    );
    await expect(db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, -10, 'render', 'rendu:abc')`, [user],
    )).rejects.toThrow(/unique|duplicate/i);
  });

  it('laisse passer la même référence pour DEUX utilisateurs différents', async () => {
    const a = await creerUtilisateur(db, 100);
    const b = await creerUtilisateur(db, 100);
    for (const u of [a, b]) {
      await db.query(
        `insert into public.credit_transactions (user_id, amount, type, reference_id)
         values ($1, -10, 'render', 'rendu:partage')`, [u],
      );
    }
    expect((await transactions(db, a)).length).toBe(1);
    expect((await transactions(db, b)).length).toBe(1);
  });
});

describe('9. Les lignes historiques sans référence restent possibles', () => {
  it('accepte plusieurs lignes à reference_id NULL pour un même utilisateur', async () => {
    const user = await creerUtilisateur(db, 100);
    // Toutes les lignes déjà en production sont dans ce cas : l'index doit
    // être partiel, sinon la migration serait inapplicable.
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `insert into public.credit_transactions (user_id, amount, type)
         values ($1, -10, 'render')`, [user],
      );
    }
    expect((await transactions(db, user)).length).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Le débit atomique
// ════════════════════════════════════════════════════════════════════════════

describe('Débit simple', () => {
  it('retire le montant du tarif serveur et journalise', async () => {
    const user = await creerUtilisateur(db, 100);
    const r = await debiter(db, user, 'reel', 'rendu:1');
    expect(r.ok).toBe(true);
    expect(r.deja_debite).toBe(false);
    expect(r.solde).toBe(90);
    expect(await solde(db, user)).toBe(90);
    const t = await transactions(db, user);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ amount: -10, type: 'render', reference_id: 'rendu:1' });
  });

  it('applique le tarif du format, jamais un montant reçu', async () => {
    const user = await creerUtilisateur(db, 100);
    expect((await debiter(db, user, 'tv', 'rendu:tv')).solde).toBe(85);
  });

  it('refuse un format inconnu sans rien débiter', async () => {
    const user = await creerUtilisateur(db, 100);
    const r = await debiter(db, user, 'carre', 'rendu:x');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('format_inconnu');
    expect(await solde(db, user)).toBe(100);
    expect(await transactions(db, user)).toHaveLength(0);
  });
});

describe('2. Répétition séquentielle — aucun second débit', () => {
  it('rejouer une réussite rend le même résultat métier', async () => {
    const user = await creerUtilisateur(db, 100);
    const un = await debiter(db, user, 'reel', 'rendu:même');
    const deux = await debiter(db, user, 'reel', 'rendu:même');
    expect(un.ok).toBe(true);
    expect(deux.ok).toBe(true);
    expect(deux.deja_debite).toBe(true);
    expect(deux.solde).toBe(90);
    expect(await solde(db, user)).toBe(90);
    expect(await transactions(db, user)).toHaveLength(1);
  });

  it('résiste à dix rejeux', async () => {
    const user = await creerUtilisateur(db, 100);
    for (let i = 0; i < 10; i += 1) await debiter(db, user, 'reel', 'rendu:dix');
    expect(await solde(db, user)).toBe(90);
    expect(await transactions(db, user)).toHaveLength(1);
  });
});

describe('1. Concurrence sur la MÊME référence — un seul débit', () => {
  it('deux appels simultanés ne retirent qu une fois', async () => {
    const user = await creerUtilisateur(db, 100);
    const r = await enConcurrence(2, (client) => debiter(client, user, 'reel', 'rendu:course'));
    expect(r.every((x) => x.ok)).toBe(true);
    expect(await solde(db, user)).toBe(90);
    expect(await transactions(db, user)).toHaveLength(1);
  });

  it('huit appels simultanés ne retirent qu une fois', async () => {
    const user = await creerUtilisateur(db, 100);
    await enConcurrence(8, (client) => debiter(client, user, 'reel', 'rendu:huit'));
    expect(await solde(db, user)).toBe(90);
    expect(await transactions(db, user)).toHaveLength(1);
  });

  it('exactement un appel se déclare débiteur, les autres se disent déjà débités', async () => {
    const user = await creerUtilisateur(db, 100);
    const r = await enConcurrence(6, (client) => debiter(client, user, 'reel', 'rendu:qui'));
    const reussis = r.filter((x): x is { ok: true; valeur: Awaited<ReturnType<typeof debiter>> } => x.ok);
    expect(reussis).toHaveLength(6);
    expect(reussis.filter((x) => x.valeur.deja_debite === false)).toHaveLength(1);
  });
});

describe('3. Concurrence sur DEUX références — aucune mise à jour perdue', () => {
  it('deux débits distincts simultanés retirent bien deux fois', async () => {
    const user = await creerUtilisateur(db, 100);
    await enConcurrence(2, (client, i) => debiter(client, user, 'reel', `rendu:${i}`));
    expect(await solde(db, user)).toBe(80);
    expect(await transactions(db, user)).toHaveLength(2);
  });

  it('dix débits distincts simultanés retirent exactement dix fois', async () => {
    const user = await creerUtilisateur(db, 1000);
    await enConcurrence(10, (client, i) => debiter(client, user, 'reel', `rendu:d${i}`));
    expect(await solde(db, user)).toBe(900);
    expect(await transactions(db, user)).toHaveLength(10);
  });
});

describe('4 & 5 & 7. Solde insuffisant', () => {
  it('solde suffisant pour UNE seule des deux opérations → une seule réussite', async () => {
    const user = await creerUtilisateur(db, 10);
    const r = await enConcurrence(2, (client, i) => debiter(client, user, 'reel', `rendu:c${i}`));
    const valeurs = r.filter((x) => x.ok).map((x) => (x as { valeur: { ok: boolean } }).valeur);
    expect(valeurs.filter((v) => v.ok)).toHaveLength(1);
    expect(valeurs.filter((v) => !v.ok)).toHaveLength(1);
    expect(await solde(db, user)).toBe(0);
    expect(await transactions(db, user)).toHaveLength(1);
  });

  it('solde insuffisant → aucune modification, aucune transaction', async () => {
    const user = await creerUtilisateur(db, 5);
    const r = await debiter(db, user, 'reel', 'rendu:pauvre');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('solde_insuffisant');
    expect(await solde(db, user)).toBe(5);
    expect(await transactions(db, user)).toHaveLength(0);
  });

  it('jamais de solde négatif, même sous vingt appels concurrents', async () => {
    const user = await creerUtilisateur(db, 30);
    await enConcurrence(20, (client, i) => debiter(client, user, 'reel', `rendu:n${i}`));
    const s = await solde(db, user);
    expect(s).toBe(0);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(await transactions(db, user)).toHaveLength(3);
  });

  it('la base elle-même refuse un solde négatif', async () => {
    const user = await creerUtilisateur(db, 10);
    await expect(
      db.query('update public.users set credits = -1 where id = $1', [user]),
    ).rejects.toThrow(/credits/i);
  });
});

describe('6. Rollback — le solde et le journal tombent ensemble', () => {
  it('un échec d écriture du journal restaure le solde', async () => {
    const user = await creerUtilisateur(db, 100);
    // On casse le journal APRÈS coup : la contrainte de type rendra l'insert
    // impossible, donc la transaction entière doit être annulée.
    await db.query(
      `alter table public.credit_transactions
       add constraint journal_casse check (type <> 'render') not valid`,
    );
    await expect(debiter(db, user, 'reel', 'rendu:rollback')).rejects.toThrow();
    expect(await solde(db, user)).toBe(100);
    expect(await transactions(db, user)).toHaveLength(0);
  });
});

describe('10. Un utilisateur ne peut pas débiter autrui', () => {
  it('une référence appartenant à un autre utilisateur ne le protège pas', async () => {
    const a = await creerUtilisateur(db, 100);
    const b = await creerUtilisateur(db, 100);
    await debiter(db, a, 'reel', 'rendu:commun');
    // Le même jeton chez B doit donner un débit propre à B, pas un « déjà fait »
    // hérité de A : la clé est (utilisateur, référence), pas la référence seule.
    const r = await debiter(db, b, 'reel', 'rendu:commun');
    expect(r.deja_debite).toBe(false);
    expect(await solde(db, a)).toBe(90);
    expect(await solde(db, b)).toBe(90);
  });

  it('un utilisateur inexistant est refusé sans rien écrire', async () => {
    const r = await debiter(db, '00000000-0000-0000-0000-000000000000', 'reel', 'rendu:fantome');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('utilisateur_inconnu');
  });
});

describe('11. Le rôle navigateur ne peut pas exécuter la fonction', () => {
  it('l exécution lui est retirée', async () => {
    const { rows } = await db.query<{ autorise: boolean }>(
      `select has_function_privilege('role_navigateur',
         'public.debiter_credits(uuid,text,text)', 'EXECUTE') as autorise`,
    );
    expect(rows[0].autorise).toBe(false);
  });

  it('aucune fonction de crédits n accepte un montant libre', async () => {
    // Le tarif vient d'une table serveur, jamais d'un argument : même exposée,
    // la fonction ne permettrait pas de choisir un montant.
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'debiter_credits'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].args).not.toMatch(/integer|numeric|bigint/);
  });

  it('la fonction fixe son search_path', async () => {
    const { rows } = await db.query<{ config: string[] | null }>(
      `select proconfig as config from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'debiter_credits'`,
    );
    expect((rows[0].config ?? []).join(' ')).toMatch(/search_path=/);
  });
});

describe('12. La migration est rejouable', () => {
  it('l appliquer deux fois ne change rien et ne lève rien', async () => {
    const user = await creerUtilisateur(db, 100);
    await debiter(db, user, 'reel', 'rendu:avant');
    await rejouerMigration(db);
    expect(await solde(db, user)).toBe(90);
    expect(await transactions(db, user)).toHaveLength(1);
    // Et elle fonctionne toujours après.
    expect((await debiter(db, user, 'reel', 'rendu:apres')).ok).toBe(true);
  });
});

describe('Le tarif serveur est la seule source', () => {
  it('correspond exactement à RENDER_COSTS du code', async () => {
    const { RENDER_COSTS } = await import('../src/lib/stripe/constants');
    const { rows } = await db.query<{ format: string; credits: number }>(
      'select format, credits from public.tarifs_rendu order by format',
    );
    const table = Object.fromEntries(rows.map((r) => [r.format, r.credits]));
    expect(table.reel).toBe(RENDER_COSTS.reel);
    expect(table.tv).toBe(RENDER_COSTS.tv);
  });
});
