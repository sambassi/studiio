/**
 * `reserver_depense_cinema` / `confirmer_depense_cinema` sur un VRAI PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CES FONCTIONS CORRIGENT
 * ─────────────────────────────────────────────────────────────────────────
 * Le seul garde-fou de dépense existant (`generation/couts.ts`, `verifierPlafond`)
 * vit sur le FILM : supprimer puis recréer un film le remet à zéro. Ces deux
 * fonctions ajoutent un plafond DURABLE, par compte et global, qui ne dépend
 * d'aucun film.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN VRAI MOTEUR
 * ─────────────────────────────────────────────────────────────────────────
 * L'atomicité (deux réservations concurrentes ne dépassent jamais le plafond)
 * est une propriété du MOTEUR, pas de ce qu'on lui programme de répondre.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, creerUtilisateur, reserverDepense, confirmerDepense,
  soldeDepenseCompte, soldeDepenseGlobale, enConcurrence, urlBase,
} from './harness';

let client: Client;

beforeAll(async () => {
  urlBase();
  client = await connecter();
});
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

describe('1. Réservation nominale', () => {
  it('incrémente le compte ET le global, du même montant', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    expect(r.ok).toBe(true);
    expect(r.deja_engagee).toBe(false);
    expect(Number(r.total_compte)).toBeCloseTo(0.45, 4);
    expect(Number(r.total_global)).toBeCloseTo(0.45, 4);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
    expect(await soldeDepenseGlobale(client)).toBeCloseTo(0.45, 4);
  });

  it('deux comptes distincts cumulent sur le MÊME compteur global', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    await reserverDepense(client, a, 0.45, 'cinema-depense:a1');
    await reserverDepense(client, b, 0.003, 'cinema-depense:b1');
    expect(await soldeDepenseCompte(client, a)).toBeCloseTo(0.45, 4);
    expect(await soldeDepenseCompte(client, b)).toBeCloseTo(0.003, 4);
    expect(await soldeDepenseGlobale(client)).toBeCloseTo(0.453, 4);
  });
});

describe('2. Plafond PAR COMPTE — refus net, rien n’est écrit', () => {
  it('une réservation qui dépasserait le plafond du compte est refusée', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 4, 'cinema-depense:1', 'video', 5, 100);
    const r = await reserverDepense(client, u, 2, 'cinema-depense:2', 'video', 5, 100);
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('plafond_compte_depasse');
    // Rien n'a bougé : le refus n'a pas écrit la différence autorisée (1 $ restant).
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(4, 4);
    expect(await soldeDepenseGlobale(client)).toBeCloseTo(4, 4);
  });

  it('exactement la marge restante passe encore', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 4, 'cinema-depense:1', 'video', 5, 100);
    const r = await reserverDepense(client, u, 1, 'cinema-depense:2', 'video', 5, 100);
    expect(r.ok).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(5, 4);
  });

  it('le plafond d’UN compte ne bloque pas un AUTRE compte', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    await reserverDepense(client, a, 5, 'cinema-depense:a-plein', 'video', 5, 100);
    const r = await reserverDepense(client, b, 5, 'cinema-depense:b-ok', 'video', 5, 100);
    expect(r.ok).toBe(true);
    expect(await soldeDepenseCompte(client, b)).toBeCloseTo(5, 4);
  });
});

describe('3. Plafond GLOBAL — refus même si le compte est large', () => {
  it('un compte au plafond global large, mais le global est atteint par d’autres', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    // Plafond global fixé à 1 $ pour ce test : `a` l'épuise.
    await reserverDepense(client, a, 1, 'cinema-depense:a1', 'video', 50, 1);
    const r = await reserverDepense(client, b, 0.45, 'cinema-depense:b1', 'video', 50, 1);
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('plafond_global_depasse');
    expect(await soldeDepenseCompte(client, b)).toBe(0); // b n'a RIEN engagé
    expect(await soldeDepenseGlobale(client)).toBeCloseTo(1, 4);
  });
});

describe('4. Idempotence — une référence rejouée ne réserve pas deux fois', () => {
  it('le second appel rend `deja_engagee`, compteurs inchangés', async () => {
    const u = await creerUtilisateur(client, 100);
    const a = await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    const b = await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    expect(a.deja_engagee).toBe(false);
    expect(b.ok).toBe(true);
    expect(b.deja_engagee).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
  });

  it('même avec un montant DIFFÉRENT au rejeu, la référence fait foi', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    const r = await reserverDepense(client, u, 4, 'cinema-depense:1');
    expect(r.deja_engagee).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4); // pas 4,45
  });
});

describe('5. Garde-fous — une erreur de code ne doit rien bouger', () => {
  it('une référence vide est refusée', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await reserverDepense(client, u, 0.45, '');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('reference_absente');
  });

  it('un montant nul ou négatif est refusé', async () => {
    const u = await creerUtilisateur(client, 100);
    for (const m of [0, -0.45]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await reserverDepense(client, u, m, `cinema-depense:${m}`);
      expect(r.ok, String(m)).toBe(false);
      expect(r.motif).toBe('montant_invalide');
    }
  });

  it('un montant aberrant (> 5 $, aucune opération connue ne coûte autant) est refusé', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await reserverDepense(client, u, 6, 'cinema-depense:1');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('montant_invalide');
  });

  it('une opération hors catalogue est refusée', async () => {
    const u = await creerUtilisateur(client, 100);
    const { rows } = await client.query(
      "select * from public.reserver_depense_cinema($1, 0.45, 'cinema-depense:1', 'audio', 5, 100)",
      [u],
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].motif).toBe('operation_invalide');
  });

  it('un plafond négatif est refusé', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await reserverDepense(client, u, 0.45, 'cinema-depense:1', 'video', -1, 100);
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('plafond_invalide');
  });
});

describe('6. Concurrence — un plafond ne peut jamais être dépassé en course', () => {
  it('dix réservations de 1 $ simultanées, plafond compte à 5 $ : exactement cinq passent', async () => {
    const u = await creerUtilisateur(client, 100);
    const res = await enConcurrence(10, async (c, i) => {
      const { rows } = await c.query(
        "select * from public.reserver_depense_cinema($1, 1, $2, 'video', 5, 100)",
        [u, `course:${i}`],
      );
      return rows[0];
    });
    const reussis = res.filter((r) => r.ok && (r.valeur as { ok: boolean }).ok);
    expect(reussis).toHaveLength(5);
    const solde = await soldeDepenseCompte(client, u);
    expect(solde).toBeCloseTo(5, 4);
    expect(solde).toBeLessThanOrEqual(5);
  });

  it('même référence en course : une seule réservation réelle (comme les crédits)', async () => {
    const u = await creerUtilisateur(client, 100);
    const res = await enConcurrence(8, async (c) => {
      const { rows } = await c.query(
        "select * from public.reserver_depense_cinema($1, 0.45, 'course-ref', 'video', 5, 100)",
        [u],
      );
      return rows[0];
    });
    const reussis = res.filter((r) => r.ok && (r.valeur as { ok: boolean }).ok);
    expect(reussis).toHaveLength(8); // tous "réussissent" au sens API...
    const reels = reussis.filter((r) => r.ok && !(r.valeur as { deja_engagee: boolean }).deja_engagee);
    expect(reels).toHaveLength(1); // ...mais un SEUL a réellement engagé
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
  });

  it('le plafond GLOBAL tient aussi en course, entre comptes DIFFÉRENTS', async () => {
    // Séquentiel, et non `Promise.all` : la MÊME connexion `client` ne pipeline pas
    // plusieurs requêtes à la fois (le driver `pg` le signale par un avertissement).
    const comptes: string[] = [];
    for (let i = 0; i < 10; i += 1) comptes.push(await creerUtilisateur(client, 100)); // eslint-disable-line no-await-in-loop
    const res = await enConcurrence(10, async (c, i) => {
      const { rows } = await c.query(
        "select * from public.reserver_depense_cinema($1, 1, $2, 'video', 50, 5)",
        [comptes[i], `global-course:${i}`],
      );
      return rows[0];
    });
    const reussis = res.filter((r) => r.ok && (r.valeur as { ok: boolean }).ok);
    expect(reussis).toHaveLength(5); // plafond global à 5 $, 1 $ chacun
    expect(await soldeDepenseGlobale(client)).toBeCloseTo(5, 4);
    expect(await soldeDepenseGlobale(client)).toBeLessThanOrEqual(5);
  });
});

describe('7. Confirmation — libère, maintient, ou ajuste selon l’issue RÉELLE', () => {
  it('"confirmee" : le montant reste compté, inchangé', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'confirmee');
    expect(r.ok).toBe(true);
    expect(Number(r.total_compte)).toBeCloseTo(0.45, 4);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
  });

  it('"liberee" : le montant est RETIRÉ des deux compteurs — rien n’est jamais parti', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'liberee');
    expect(r.ok).toBe(true);
    expect(Number(r.total_compte)).toBe(0);
    expect(await soldeDepenseCompte(client, u)).toBe(0);
    expect(await soldeDepenseGlobale(client)).toBe(0);
    // La marge entière redevient disponible : une nouvelle réservation au plafond passe.
    const suivante = await reserverDepense(client, u, 5, 'cinema-depense:2', 'video', 5, 100);
    expect(suivante.ok).toBe(true);
  });

  it('"incertaine" : reste compté — jamais sous-estimé en attendant la réconciliation', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'incertaine');
    expect(r.ok).toBe(true);
    expect(Number(r.total_compte)).toBeCloseTo(0.45, 4);
  });

  it('réconciliation : une "incertaine" peut être reclassée "liberee" plus tard', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    await confirmerDepense(client, u, 'cinema-depense:1', 'incertaine');
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
    const reconciliee = await confirmerDepense(client, u, 'cinema-depense:1', 'liberee');
    expect(reconciliee.ok).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBe(0);
  });

  it('réconciliation : une "incertaine" peut aussi être confirmée comme réellement dépensée', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    await confirmerDepense(client, u, 'cinema-depense:1', 'incertaine');
    const reconciliee = await confirmerDepense(client, u, 'cinema-depense:1', 'confirmee');
    expect(reconciliee.ok).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
  });

  it('idempotent : confirmer deux fois le MÊME statut final ne change rien', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    await confirmerDepense(client, u, 'cinema-depense:1', 'confirmee');
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'confirmee');
    expect(r.ok).toBe(true);
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4);
  });

  it('refuse un DEUXIÈME statut final différent — une confirmation déjà finalisée ne se réécrit pas', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    await confirmerDepense(client, u, 'cinema-depense:1', 'confirmee');
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'liberee');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('deja_finalisee');
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(0.45, 4); // inchangé
  });

  it('référence inconnue : refus net', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await confirmerDepense(client, u, 'cinema-depense:fantome', 'confirmee');
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('reference_absente');
  });

  it('le compteur ne descend jamais sous zéro, même en cas de double libération par un autre canal', async () => {
    const u = await creerUtilisateur(client, 100);
    await reserverDepense(client, u, 0.45, 'cinema-depense:1');
    await confirmerDepense(client, u, 'cinema-depense:1', 'liberee');
    expect(await soldeDepenseCompte(client, u)).toBe(0);
    // Un second essai sur la même référence, déjà finalisée : refusé, pas de passage sous zéro.
    const r = await confirmerDepense(client, u, 'cinema-depense:1', 'liberee');
    expect(r.ok).toBe(true); // rejeu du MÊME statut : idempotent
    expect(await soldeDepenseCompte(client, u)).toBe(0);
  });
});

describe('8. Indépendance du compteur — survit à tout ce qui touche un « film »', () => {
  it('aucune colonne ni contrainte ne référence un film : rien ne peut le remettre à zéro en le supprimant', async () => {
    const { rows } = await client.query(`
      select tc.constraint_type, kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
       where tc.table_name in ('cinema_depenses_comptes', 'cinema_depenses_globales', 'cinema_depenses_journal')
    `);
    const colonnes = rows.map((r) => r.column_name);
    expect(colonnes).not.toContain('film_id');
    expect(colonnes).not.toContain('film');
  });

  it('le compteur persiste après plusieurs réservations/confirmations successives, sans jamais revenir à zéro tout seul', async () => {
    const u = await creerUtilisateur(client, 100);
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await reserverDepense(client, u, 0.45, `cinema-depense:film-${i}`, 'video', 50, 100);
      // eslint-disable-next-line no-await-in-loop
      await confirmerDepense(client, u, `cinema-depense:film-${i}`, 'confirmee');
    }
    // Chaque "film" simulé a laissé sa trace : rien ne les a jamais effacées.
    expect(await soldeDepenseCompte(client, u)).toBeCloseTo(2.25, 4);
  });
});

describe('La fonction est installée comme les fonctions de crédits', () => {
  it('SECURITY DEFINER, search_path figé, exécution retirée à public', async () => {
    for (const [nom, sig] of [
      ['reserver_depense_cinema', 'uuid,numeric,text,text,numeric,numeric'],
      ['confirmer_depense_cinema', 'uuid,text,text,numeric'],
    ]) {
      const { rows } = await client.query(`
        select p.prosecdef, p.proconfig,
               has_function_privilege('public', $1, 'EXECUTE') as public_execute
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $2`,
      [`public.${nom}(${sig})`, nom]);
      expect(rows, nom).toHaveLength(1);
      expect(rows[0].prosecdef, nom).toBe(true);
      expect(rows[0].proconfig, nom).toEqual(['search_path=pg_catalog, public']);
      expect(rows[0].public_execute, nom).toBe(false);
    }
  });

  it('une référence ne peut réserver qu’une fois PAR COMPTE — index unique (user_id, reference)', async () => {
    const { rows } = await client.query(
      "select indexdef from pg_indexes where indexname = 'cinema_depenses_journal_reference_unique'",
    );
    expect(rows[0].indexdef).toContain('(user_id, reference)');
  });

  it('elle refuse de s’installer sans la table `users`', async () => {
    await client.query('drop table public.cinema_depenses_comptes cascade');
    await client.query('drop table public.cinema_depenses_globales cascade');
    await client.query('drop table public.cinema_depenses_journal cascade');
    await client.query('drop function if exists public.reserver_depense_cinema(uuid,numeric,text,text,numeric,numeric)');
    await client.query('drop function if exists public.confirmer_depense_cinema(uuid,text,text,numeric)');
    await client.query('drop table public.users cascade');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(join(process.cwd(), 'migrations/2026-10-31-cinema-plafond-compte.sql'), 'utf-8');
    await expect(client.query(sql)).rejects.toThrow(/table public\.users absente/);
  });
});
