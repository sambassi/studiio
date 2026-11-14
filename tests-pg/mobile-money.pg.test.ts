/**
 * MOBILE MONEY sur un VRAI PostgreSQL 16 — le plafond et l'unicité du crédit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN VRAI MOTEUR, ET PAS UN DOUBLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les deux propriétés éprouvées ici ne sont pas des propriétés du code : ce
 * sont des propriétés du MOTEUR.
 *
 *   - « cinq paiements ouverts au maximum, même si dix requêtes arrivent
 *     ensemble » dépend du verrou consultatif et du niveau d'isolation. Un
 *     double en mémoire dirait toujours oui, puisqu'il n'a pas de
 *     concurrence à gérer.
 *   - « une référence ne crédite qu'une fois, même sous course » dépend de
 *     l'index unique partiel et du verrou de ligne.
 *
 * Un test qui ne les éprouve pas sur Postgres ne les éprouve pas du tout.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connecter, preparerBase, creerUtilisateur, enConcurrence, urlBase } from './harness';

let client: Client;

beforeAll(async () => {
  urlBase();
  client = await connecter();
});
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

/** Un dépôt ouvert, tel que la route l'insère. */
async function ouvrirDepot(c: Client, user: string, id: string, quand = 'now()'): Promise<void> {
  await c.query(
    `insert into public.pawapay_depots
       (deposit_id, user_id, offre_type, offre_cle, credits, montant_local,
        devise, pays, prix_chf_cents, sandbox, created_at)
     values ($1, $2, 'pack', 'small', 50, 6394, 'XOF', 'SEN', 900, true, ${quand})`,
    [id, user],
  );
}

async function compterOuverts(c: Client, user: string): Promise<number> {
  const r = await c.query(
    `select count(*)::int as n from public.pawapay_depots
      where user_id = $1 and statut = 'en_attente'`, [user],
  );
  return r.rows[0].n as number;
}

describe('1. Le plafond de paiements ouverts', () => {
  it('laisse passer cinq ouvertures, refuse la sixième', async () => {
    const u = await creerUtilisateur(client, 100);
    for (let i = 0; i < 5; i += 1) await ouvrirDepot(client, u, `d${i}`);

    await expect(ouvrirDepot(client, u, 'd5')).rejects.toThrow(/trop_de_paiements_ouverts/);
    expect(await compterOuverts(client, u)).toBe(5);
  });

  it('⚠️ DIX OUVERTURES SIMULTANÉES n’en laissent passer que cinq', async () => {
    // C'est l'épreuve qui compte. Le contrôle applicatif compte puis insère :
    // dix requêtes parallèles le passent toutes. Seul le verrou pris dans le
    // déclencheur, au moment de l'insertion, tient réellement le plafond.
    const u = await creerUtilisateur(client, 100);

    const r = await enConcurrence(10, (c, i) => ouvrirDepot(c, u, `course-${i}`));

    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(r.filter((x) => !x.ok)).toHaveLength(5);
    for (const echec of r.filter((x) => !x.ok)) {
      expect((echec as { erreur: string }).erreur).toMatch(/trop_de_paiements_ouverts/);
    }
    expect(await compterOuverts(client, u)).toBe(5);
  });

  it('deux comptes ne s’attendent pas : chacun a ses cinq places', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    for (let i = 0; i < 5; i += 1) await ouvrirDepot(client, a, `a${i}`);

    // Le compte A est plein ; B ouvre quand même.
    await expect(ouvrirDepot(client, a, 'a5')).rejects.toThrow(/trop_de_paiements_ouverts/);
    await ouvrirDepot(client, b, 'b0');
    expect(await compterOuverts(client, b)).toBe(1);
  });

  it('un paiement conclu libère une place, un abandonné aussi', async () => {
    const u = await creerUtilisateur(client, 100);
    for (let i = 0; i < 5; i += 1) await ouvrirDepot(client, u, `d${i}`);

    await client.query(`update public.pawapay_depots set statut = 'reussi' where deposit_id = 'd0'`);
    await ouvrirDepot(client, u, 'apres-reussite');

    await client.query(`update public.pawapay_depots set statut = 'abandonne' where deposit_id = 'd1'`);
    await ouvrirDepot(client, u, 'apres-abandon');

    expect(await compterOuverts(client, u)).toBe(5);
  });

  it('les paiements de plus de 24 h ne comptent plus dans le plafond', async () => {
    const u = await creerUtilisateur(client, 100);
    for (let i = 0; i < 5; i += 1) {
      await ouvrirDepot(client, u, `vieux-${i}`, `now() - interval '30 hours'`);
    }
    // Le plafond ne regarde que la fenêtre de 24 h : rien ne bloque.
    await ouvrirDepot(client, u, 'neuf');
    expect(await compterOuverts(client, u)).toBe(6);
  });
});

describe('2. Le crédit, exactement une fois', () => {
  const crediter = (c: Client, user: string, ref: string, montant = 50) =>
    c.query(
      `select * from public.crediter_credits_mobile_money($1, $2, 'purchase', $3, 'Mobile Money')`,
      [user, montant, ref],
    ).then((r) => r.rows[0] as { ok: boolean; solde: number; deja_credite: boolean; motif: string | null });

  it('crédite, puis reconnaît le rejeu sans recréditer', async () => {
    const u = await creerUtilisateur(client, 100);
    const a = await crediter(client, u, 'mm:dep-1');
    expect(a).toMatchObject({ ok: true, deja_credite: false, solde: 150 });

    const b = await crediter(client, u, 'mm:dep-1');
    expect(b).toMatchObject({ ok: true, deja_credite: true, solde: 150 });
  });

  it('⚠️ DEUX CONFIRMATIONS SIMULTANÉES ne créditent qu’une fois', async () => {
    // Le cas réel : la notification et la réconciliation tombent ensemble.
    const u = await creerUtilisateur(client, 100);

    const r = await enConcurrence(2, (c) => crediter(c, u, 'mm:course'));
    expect(r.every((x) => x.ok)).toBe(true);

    const solde = await client.query('select credits from public.users where id = $1', [u]);
    expect(solde.rows[0].credits).toBe(150);
    const lignes = await client.query(
      `select count(*)::int as n from public.credit_transactions where reference_id = 'mm:course'`,
    );
    expect(lignes.rows[0].n).toBe(1);
  });

  it('refuse une référence qui n’est pas la sienne — l’index ne couvre que `mm:%`', async () => {
    const u = await creerUtilisateur(client, 100);
    const r = await crediter(client, u, 'stripe:sess-1');
    expect(r).toMatchObject({ ok: false, motif: 'reference_invalide' });
    const solde = await client.query('select credits from public.users where id = $1', [u]);
    expect(solde.rows[0].credits).toBe(100);
  });

  // La réciproque — « un crédit Stripe ne gêne pas un crédit Mobile Money » —
  // n'est pas éprouvée ici : `crediter_credits_stripe` vient d'une migration
  // que ce harnais ne joue pas. Le point qui compte, lui, l'est ci-dessus :
  // la fonction Mobile Money REFUSE une référence `stripe:`, parce que son
  // index unique ne couvre que `mm:%` et qu'elle ne doit jamais promettre une
  // unicité qu'il ne tient pas.
});

describe('3. L’index de rotation existe et porte la bonne condition', () => {
  it('la file de relecture et la réserve de seconde chance ont chacune leur index', async () => {
    const r = await client.query(
      `select indexname, indexdef from pg_indexes
        where tablename = 'pawapay_depots' order by indexname`,
    );
    const defs = Object.fromEntries(r.rows.map((x) => [x.indexname, x.indexdef as string]));

    expect(defs.pawapay_depots_en_attente).toMatch(/derniere_verification_le/);
    expect(defs.pawapay_depots_en_attente).toMatch(/statut = 'en_attente'/);
    expect(defs.pawapay_depots_abandonnes).toMatch(/statut = 'abandonne'/);
    expect(defs.pawapay_depots_abandonnes).toMatch(/credite_le IS NULL/);
  });

  it('le statut `abandonne` est accepté, un statut inventé ne l’est pas', async () => {
    const u = await creerUtilisateur(client, 100);
    await ouvrirDepot(client, u, 'd0');
    await client.query(`update public.pawapay_depots set statut = 'abandonne' where deposit_id = 'd0'`);
    await expect(
      client.query(`update public.pawapay_depots set statut = 'perdu' where deposit_id = 'd0'`),
    ).rejects.toThrow(/statut_check/);
  });
});
