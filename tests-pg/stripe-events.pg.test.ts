/**
 * Idempotence des webhooks Stripe sur un VRAI PostgreSQL 16.
 *
 * Ce que seule la base peut prouver, sur la migration de production
 * (`migrations/2026-09-29-stripe-events.sql`, jamais recopiée) :
 *
 *   1. elle s'applique sur une base SANS `stripe_events`, et se rejoue ;
 *   2. elle s'applique sur la table MINIMALE créée à la main
 *      (`event_id` PK, `type`, `received_at`) AVEC des lignes : elles passent
 *      `processed`, et l'insert de l'ancien webhook continue de passer ;
 *   3. N claims simultanés du même événement → un seul `claimed` ;
 *   4. rejeu après `processed` → `already_processed` ;
 *   5. retry après `failed` → `claimed`, attempts+1 ;
 *   6. bail expiré → `claimed` ; bail valide → `in_progress` ;
 *   7. `crediter_credits_stripe` : une référence ne crédite qu'une fois,
 *      même sous concurrence ;
 *   8. droits : rien pour `public` ;
 *   9. le rollback retire les fonctions et garde la table.
 *
 * Les courses partent de connexions distinctes relâchées par une barrière
 * (`enConcurrence`) — jamais d'un `sleep`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import type { Client } from 'pg';
import {
  connecter, preparerBase, appliquerMigration, creerUtilisateur, solde,
  transactions, enConcurrence, debiterOperation, RACINE,
} from './harness';

const MIGRATION = join(RACINE, 'migrations/2026-09-29-stripe-events.sql');
const ROLLBACK = join(RACINE, 'migrations/rollback/2026-09-29-stripe-events.rollback.sql');

let db: Client;
beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });

async function claim(c: Client, id: string, type = 'checkout.session.completed', bail = 300) {
  const { rows } = await c.query<{ r: string }>(
    'select public.stripe_event_claim($1, $2, $3) as r', [id, type, bail],
  );
  return rows[0].r;
}
async function complete(c: Client, id: string) {
  await c.query('select public.stripe_event_complete($1)', [id]);
}
async function fail(c: Client, id: string, err: string | null) {
  await c.query('select public.stripe_event_fail($1, $2)', [id, err]);
}
async function ligne(c: Client, id: string) {
  const { rows } = await c.query(
    `select event_id, type, status, attempts, last_error, processed_at, lease_until, received_at
       from public.stripe_events where event_id = $1`, [id],
  );
  return rows[0] as {
    event_id: string; type: string; status: string; attempts: number;
    last_error: string | null; processed_at: Date | null; lease_until: Date | null; received_at: Date;
  } | undefined;
}

interface Credit { ok: boolean; solde: number; deja_credite: boolean; motif: string | null }
async function crediter(
  c: Client, u: string, montant: number, reference: string,
  type = 'purchase', mode = 'ajouter', description: string | null = null,
): Promise<Credit> {
  const { rows } = await c.query<Credit>(
    'select * from public.crediter_credits_stripe($1, $2, $3, $4, $5, $6)',
    [u, montant, type, reference, description, mode],
  );
  return rows[0];
}

// ────────────────────────────────────────────────────────────────────────────
// 1-2. Application sur les deux états possibles de la base
// ────────────────────────────────────────────────────────────────────────────

describe('1. Table absente', () => {
  beforeEach(async () => { await preparerBase(db); });

  it('la migration crée la table au contrat, et se rejoue', async () => {
    expect((await db.query("select to_regclass('public.stripe_events') as t")).rows[0].t).toBeNull();
    await appliquerMigration(db, MIGRATION);
    await appliquerMigration(db, MIGRATION);

    const { rows } = await db.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'stripe_events' order by column_name`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, [r.data_type, r.is_nullable]]));
    expect(cols).toEqual({
      attempts: ['integer', 'NO'],
      event_id: ['text', 'NO'],
      last_error: ['text', 'YES'],
      lease_until: ['timestamp with time zone', 'YES'],
      processed_at: ['timestamp with time zone', 'YES'],
      received_at: ['timestamp with time zone', 'NO'],
      status: ['text', 'NO'],
      type: ['text', 'NO'],
    });
    const pk = await db.query(
      `select a.attname from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.conrelid = 'public.stripe_events'::regclass and c.contype = 'p'`,
    );
    expect(pk.rows.map((r) => r.attname)).toEqual(['event_id']);
    await expect(db.query(
      "insert into public.stripe_events (event_id, type, status) values ('x', 't', 'bidon')",
    )).rejects.toThrow(/stripe_events_status_check/);
  });
});

describe('1 bis. Garde M4 : doublons de référence Stripe déjà présents', () => {
  beforeEach(async () => { await preparerBase(db); });

  it('la migration s arrête avec le décompte, et rien n est modifié', async () => {
    // Doublons possibles aujourd'hui : l'index du 27 août n'interdit la
    // même référence que pour un MÊME compte.
    const a = await creerUtilisateur(db, 10);
    const b = await creerUtilisateur(db, 20);
    const c = await creerUtilisateur(db, 30);
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id) values
         ($1, 5, 'purchase', 'stripe:cs:double'), ($2, 5, 'purchase', 'stripe:cs:double'),
         ($1, 7, 'subscription', 'stripe:in:triple'), ($2, 7, 'subscription', 'stripe:in:triple'),
         ($3, 7, 'subscription', 'stripe:in:triple'),
         ($1, 1, 'render', 'rendu:partage'), ($2, 1, 'render', 'rendu:partage')`,
      [a, b, c],
    );
    const avant = (await db.query(
      'select user_id, amount, reference_id from public.credit_transactions order by user_id, reference_id',
    )).rows;

    await expect(appliquerMigration(db, MIGRATION)).rejects.toMatchObject({
      code: '23505',
      message: expect.stringContaining('2 reference(s) stripe en doublon (5 lignes)'),
    });

    // Rien : ni table, ni fonction, ni index, ni ligne modifiée.
    expect((await db.query("select to_regclass('public.stripe_events') as t")).rows[0].t).toBeNull();
    expect((await db.query("select to_regclass('public.credit_transactions_stripe_reference_unique') as t")).rows[0].t).toBeNull();
    expect((await db.query("select count(*)::int as n from pg_proc where proname = 'crediter_credits_stripe'")).rows[0].n).toBe(0);
    expect((await db.query(
      'select user_id, amount, reference_id from public.credit_transactions order by user_id, reference_id',
    )).rows).toEqual(avant);
    expect(await solde(db, a)).toBe(10);
  });

  it('les références de débit partagées ne déclenchent pas la garde', async () => {
    const a = await creerUtilisateur(db, 10);
    const b = await creerUtilisateur(db, 20);
    await db.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id) values
         ($1, -1, 'render', 'rendu:partage'), ($2, -1, 'render', 'rendu:partage')`,
      [a, b],
    );
    await appliquerMigration(db, MIGRATION);
    expect((await db.query("select to_regclass('public.credit_transactions_stripe_reference_unique') as t")).rows[0].t)
      .not.toBeNull();
  });
});

describe('2. Table minimale créée à la main, avec des lignes', () => {
  beforeEach(async () => {
    await preparerBase(db);
    // Le schéma que l'ancien webhook suppose (route.ts : insert de
    // `event_id`, `type`, `received_at`).
    await db.query(`
      create table public.stripe_events (
        event_id    text primary key,
        type        text,
        received_at timestamptz default now()
      );
      grant all on table public.stripe_events to public;
      insert into public.stripe_events (event_id, type) values
        ('evt_ancien_1', 'checkout.session.completed'),
        ('evt_ancien_2', 'invoice.payment_succeeded');
    `);
  });

  it('les lignes existantes passent processed et ne sont pas rejouées', async () => {
    await appliquerMigration(db, MIGRATION);
    await appliquerMigration(db, MIGRATION);

    const l1 = await ligne(db, 'evt_ancien_1');
    expect(l1?.status).toBe('processed');
    expect(l1?.attempts).toBe(1);
    expect(l1?.type).toBe('checkout.session.completed');
    expect(await claim(db, 'evt_ancien_1')).toBe('already_processed');
    expect(await claim(db, 'evt_ancien_2')).toBe('already_processed');
    const { rows } = await db.query('select count(*)::int as n from public.stripe_events');
    expect(rows[0].n).toBe(2);
  });

  it('l insert de l ancien webhook passe toujours (défaut processed)', async () => {
    await appliquerMigration(db, MIGRATION);
    await db.query(
      'insert into public.stripe_events (event_id, type, received_at) values ($1, $2, now())',
      ['evt_ancien_code', 'checkout.session.completed'],
    );
    expect((await ligne(db, 'evt_ancien_code'))?.status).toBe('processed');
  });

  it('les nouveaux événements suivent le contrat', async () => {
    await appliquerMigration(db, MIGRATION);
    expect(await claim(db, 'evt_neuf')).toBe('claimed');
    await complete(db, 'evt_neuf');
    expect(await claim(db, 'evt_neuf')).toBe('already_processed');
  });

  it('une table sans cle unique sur event_id en reçoit une', async () => {
    await db.query(`
      drop table public.stripe_events;
      create table public.stripe_events (
        id uuid primary key default gen_random_uuid(),
        event_id text, type text, received_at timestamptz default now()
      );
      insert into public.stripe_events (event_id, type) values ('evt_x', 'a');
    `);
    await appliquerMigration(db, MIGRATION);
    await appliquerMigration(db, MIGRATION);
    expect(await claim(db, 'evt_x')).toBe('already_processed');
    expect(await claim(db, 'evt_y')).toBe('claimed');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3-6. Le cycle de vie d'un événement
// ────────────────────────────────────────────────────────────────────────────

describe('3-6. Claim / complete / fail', () => {
  beforeEach(async () => {
    await preparerBase(db);
    await appliquerMigration(db, MIGRATION);
  });

  it('3. dix claims simultanés : un seul claimed, les autres in_progress', async () => {
    const res = await enConcurrence(10, (c) => claim(c, 'evt_course'));
    expect(res.every((r) => r.ok)).toBe(true);
    const valeurs = res.map((r) => (r.ok ? r.valeur : 'erreur'));
    expect(valeurs.filter((v) => v === 'claimed')).toHaveLength(1);
    expect(valeurs.filter((v) => v === 'in_progress')).toHaveLength(9);
    const l = await ligne(db, 'evt_course');
    expect(l?.status).toBe('processing');
    expect(l?.attempts).toBe(1);
  });

  it('4. rejeu après processed : already_processed, rien ne bouge', async () => {
    expect(await claim(db, 'evt_1')).toBe('claimed');
    await complete(db, 'evt_1');
    const avant = await ligne(db, 'evt_1');
    expect(avant?.status).toBe('processed');
    expect(avant?.processed_at).not.toBeNull();
    expect(avant?.lease_until).toBeNull();

    for (let i = 0; i < 3; i += 1) expect(await claim(db, 'evt_1')).toBe('already_processed');
    const apres = await ligne(db, 'evt_1');
    expect(apres).toEqual(avant);
  });

  it('4b. rejeu concurrent après processed : tous already_processed', async () => {
    await claim(db, 'evt_2');
    await complete(db, 'evt_2');
    const res = await enConcurrence(8, (c) => claim(c, 'evt_2'));
    expect(res.map((r) => (r.ok ? r.valeur : 'erreur'))).toEqual(Array(8).fill('already_processed'));
  });

  it('5. retry après fail : claimed, attempts+1, erreur tronquée et gardée', async () => {
    expect(await claim(db, 'evt_3')).toBe('claimed');
    await fail(db, 'evt_3', 'x'.repeat(5000));
    let l = await ligne(db, 'evt_3');
    expect(l?.status).toBe('failed');
    expect(l?.lease_until).toBeNull();
    expect(l?.last_error).toHaveLength(2000);

    expect(await claim(db, 'evt_3')).toBe('claimed');
    l = await ligne(db, 'evt_3');
    expect(l?.status).toBe('processing');
    expect(l?.attempts).toBe(2);
    expect(l?.last_error).toHaveLength(2000);

    await complete(db, 'evt_3');
    expect(await claim(db, 'evt_3')).toBe('already_processed');
    expect((await ligne(db, 'evt_3'))?.attempts).toBe(2);
  });

  it('5b. retry concurrent après fail : un seul claimed', async () => {
    await claim(db, 'evt_4');
    await fail(db, 'evt_4', 'boom');
    const res = await enConcurrence(10, (c) => claim(c, 'evt_4'));
    const valeurs = res.map((r) => (r.ok ? r.valeur : 'erreur'));
    expect(valeurs.filter((v) => v === 'claimed')).toHaveLength(1);
    expect(valeurs.filter((v) => v === 'in_progress')).toHaveLength(9);
    expect((await ligne(db, 'evt_4'))?.attempts).toBe(2);
  });

  it('5c. fail sans message : erreur par défaut, pas de NULL', async () => {
    await claim(db, 'evt_5');
    await fail(db, 'evt_5', null);
    expect((await ligne(db, 'evt_5'))?.last_error).toBe('erreur inconnue');
  });

  it('6. bail valide : in_progress ; bail expiré : claimed, attempts+1', async () => {
    expect(await claim(db, 'evt_6', 'x', 300)).toBe('claimed');
    expect(await claim(db, 'evt_6', 'x', 300)).toBe('in_progress');
    expect((await ligne(db, 'evt_6'))?.attempts).toBe(1);

    // Le worker est mort sans complete() ni fail() : on vieillit son bail.
    await db.query(
      "update public.stripe_events set lease_until = clock_timestamp() - interval '1 second' where event_id = 'evt_6'",
    );
    expect(await claim(db, 'evt_6', 'x', 300)).toBe('claimed');
    const l = await ligne(db, 'evt_6');
    expect(l?.attempts).toBe(2);
    expect(l!.lease_until!.getTime()).toBeGreaterThan(Date.now() + 200_000);
    expect(await claim(db, 'evt_6', 'x', 300)).toBe('in_progress');
  });

  it('6b. bail expiré en temps réel (1 s), sans manipulation', async () => {
    expect(await claim(db, 'evt_7', 'x', 1)).toBe('claimed');
    await db.query('select pg_sleep(1.2)');
    expect(await claim(db, 'evt_7', 'x', 1)).toBe('claimed');
    expect((await ligne(db, 'evt_7'))?.attempts).toBe(2);
  });

  it('6c. bail expiré, reprise concurrente : un seul claimed', async () => {
    await claim(db, 'evt_8');
    await db.query(
      "update public.stripe_events set lease_until = clock_timestamp() - interval '1 second' where event_id = 'evt_8'",
    );
    const res = await enConcurrence(10, (c) => claim(c, 'evt_8'));
    const valeurs = res.map((r) => (r.ok ? r.valeur : 'erreur'));
    expect(valeurs.filter((v) => v === 'claimed')).toHaveLength(1);
  });

  it('un worker attardé ne rouvre pas un événement déjà processed', async () => {
    await claim(db, 'evt_9');
    await complete(db, 'evt_9');
    await fail(db, 'evt_9', 'trop tard');
    const l = await ligne(db, 'evt_9');
    expect(l?.status).toBe('processed');
    expect(l?.last_error).toBeNull();
  });

  it('complete sur un événement inconnu lève P0002 ; fail ne lève pas', async () => {
    await expect(complete(db, 'evt_fantome')).rejects.toMatchObject({ code: 'P0002' });
    await expect(fail(db, 'evt_fantome', 'x')).resolves.toBeUndefined();
    expect(await ligne(db, 'evt_fantome')).toBeUndefined();
  });

  it('entrées invalides : erreur 22023, rien n est écrit', async () => {
    for (const [id, type, bail] of [
      ['', 't', 300], ['  ', 't', 300], ['evt', '', 300], ['evt', 't', 0], ['evt', 't', -1], ['evt', 't', 86401],
    ] as Array<[string, string, number]>) {
      await expect(claim(db, id, type, bail)).rejects.toMatchObject({ code: '22023' });
    }
    await expect(db.query("select public.stripe_event_claim(null, 't')")).rejects.toMatchObject({ code: '22023' });
    await expect(db.query("select public.stripe_event_claim('evt', 't', null)")).rejects.toMatchObject({ code: '22023' });
    const { rows } = await db.query('select count(*)::int as n from public.stripe_events');
    expect(rows[0].n).toBe(0);
  });

  it('le bail par défaut est de 300 s', async () => {
    const { rows } = await db.query("select public.stripe_event_claim('evt_def', 't') as r");
    expect(rows[0].r).toBe('claimed');
    const l = await ligne(db, 'evt_def');
    const secondes = (l!.lease_until!.getTime() - l!.received_at.getTime()) / 1000;
    expect(secondes).toBeGreaterThan(295);
    expect(secondes).toBeLessThan(305);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Octroi de crédits idempotent
// ────────────────────────────────────────────────────────────────────────────

describe('7. crediter_credits_stripe', () => {
  beforeEach(async () => {
    await preparerBase(db);
    await appliquerMigration(db, MIGRATION);
  });

  it('ajoute exactement une fois, rejeu sans effet', async () => {
    const u = await creerUtilisateur(db, 20);
    const r1 = await crediter(db, u, 150, 'stripe:cs:cs_test_1');
    expect(r1).toEqual({ ok: true, solde: 170, deja_credite: false, motif: null });
    const r2 = await crediter(db, u, 150, 'stripe:cs:cs_test_1');
    expect(r2).toEqual({ ok: true, solde: 170, deja_credite: true, motif: null });
    expect(await solde(db, u)).toBe(170);
    const tx = await transactions(db, u);
    expect(tx).toEqual([{ amount: 150, type: 'purchase', reference_id: 'stripe:cs:cs_test_1' }]);
  });

  it('dix octrois simultanés de la même référence : un seul crédit', async () => {
    const u = await creerUtilisateur(db, 0);
    const res = await enConcurrence(10, (c) => crediter(c, u, 500, 'stripe:cs:cs_course'));
    expect(res.every((r) => r.ok && r.valeur.ok)).toBe(true);
    const neufs = res.filter((r) => r.ok && !r.valeur.deja_credite);
    expect(neufs).toHaveLength(1);
    expect(await solde(db, u)).toBe(500);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('mode fixer : solde remis au montant, journal au montant, rejeu sans effet', async () => {
    const u = await creerUtilisateur(db, 37);
    const r = await crediter(db, u, 1000, 'stripe:in:in_1', 'subscription', 'fixer');
    expect(r).toEqual({ ok: true, solde: 1000, deja_credite: false, motif: null });
    await debiterOperation(db, u, 10, 'rendu:a');
    const r2 = await crediter(db, u, 1000, 'stripe:in:in_1', 'subscription', 'fixer');
    expect(r2.deja_credite).toBe(true);
    expect(await solde(db, u)).toBe(990);
    const { rows } = await db.query(
      "select amount, description from public.credit_transactions where reference_id = 'stripe:in:in_1'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1000);
    expect(rows[0].description).toContain('precedent 37');
  });

  it('deux factures différentes : deux crédits', async () => {
    const u = await creerUtilisateur(db, 0);
    await crediter(db, u, 300, 'stripe:in:in_a', 'subscription');
    await crediter(db, u, 300, 'stripe:in:in_b', 'subscription');
    expect(await solde(db, u)).toBe(600);
  });

  it('M4. la même référence Stripe pour deux comptes : un seul crédit, refus explicite', async () => {
    const a = await creerUtilisateur(db, 0);
    const b = await creerUtilisateur(db, 0);
    expect((await crediter(db, a, 50, 'stripe:in:partage')).deja_credite).toBe(false);
    const r = await crediter(db, b, 50, 'stripe:in:partage');
    expect(r).toEqual({ ok: false, solde: 0, deja_credite: false, motif: 'reference_autre_compte' });
    expect(await solde(db, b)).toBe(0);
    expect(await transactions(db, b)).toHaveLength(0);
    // Le rejeu du titulaire reste un rejeu.
    expect((await crediter(db, a, 50, 'stripe:in:partage')).deja_credite).toBe(true);
  });

  it('M4. deux comptes en course sur la même référence : un seul crédit au total', async () => {
    const comptes = [];
    for (let i = 0; i < 10; i += 1) comptes.push(await creerUtilisateur(db, 0));
    const res = await enConcurrence(10, (c, i) => crediter(c, comptes[i], 300, 'stripe:in:course'));
    expect(res.every((r) => r.ok)).toBe(true);
    const valeurs = res.map((r) => (r.ok ? r.valeur : null));
    expect(valeurs.filter((v) => v?.ok && !v.deja_credite)).toHaveLength(1);
    expect(valeurs.filter((v) => v?.motif === 'reference_autre_compte')).toHaveLength(9);
    const { rows } = await db.query(
      "select count(*)::int as n, sum(amount)::int as s from public.credit_transactions where reference_id = 'stripe:in:course'",
    );
    expect(rows[0]).toEqual({ n: 1, s: 300 });
    let total = 0;
    for (const u of comptes) total += await solde(db, u);
    expect(total).toBe(300);
  });

  it('M4. l index global est posé, partiel, et ne gêne pas les débits', async () => {
    const { rows } = await db.query(
      "select indexdef from pg_indexes where indexname = 'credit_transactions_stripe_reference_unique'",
    );
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(reference_id\) WHERE .*reference_id.* ~~ 'stripe:%'/);
    // Deux comptes peuvent toujours porter la même référence de DÉBIT.
    const a = await creerUtilisateur(db, 100);
    const b = await creerUtilisateur(db, 100);
    expect((await debiterOperation(db, a, 10, 'rendu:meme')).deja_debite).toBe(false);
    expect((await debiterOperation(db, b, 10, 'rendu:meme')).deja_debite).toBe(false);
    // Et l'index refuse un doublon écrit à la main, hors fonction.
    await db.query(
      "insert into public.credit_transactions (user_id, amount, type, reference_id) values ($1, 1, 'bonus', 'stripe:cs:main')", [a],
    );
    await expect(db.query(
      "insert into public.credit_transactions (user_id, amount, type, reference_id) values ($1, 1, 'bonus', 'stripe:cs:main')", [b],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('refus explicites, rien n est écrit', async () => {
    const u = await creerUtilisateur(db, 10);
    const cas: Array<[number, string, string, string, string]> = [
      [50, 'purchase', 'cs_sans_prefixe', 'ajouter', 'reference_invalide'],
      [50, 'purchase', 'stripe:', 'ajouter', 'reference_invalide'],
      [50, 'purchase', '   ', 'ajouter', 'reference_invalide'],
      [50, 'purchase', 'stripe:' + 'x'.repeat(260), 'ajouter', 'reference_invalide'],
      [0, 'purchase', 'stripe:cs:a', 'ajouter', 'montant_invalide'],
      [-5, 'purchase', 'stripe:cs:a', 'ajouter', 'montant_invalide'],
      [100001, 'purchase', 'stripe:cs:a', 'ajouter', 'montant_invalide'],
      [50, 'render', 'stripe:cs:a', 'ajouter', 'type_invalide'],
      [50, 'purchase', 'stripe:cs:a', 'doubler', 'mode_invalide'],
    ];
    for (const [m, t, ref, mode, motif] of cas) {
      const r = await crediter(db, u, m, ref, t, mode);
      expect(r.ok).toBe(false);
      expect(r.motif).toBe(motif);
    }
    const inconnu = await crediter(db, '00000000-0000-0000-0000-000000000000', 50, 'stripe:cs:a');
    expect(inconnu.motif).toBe('utilisateur_inconnu');
    expect(await solde(db, u)).toBe(10);
    expect(await transactions(db, u)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Droits
// ────────────────────────────────────────────────────────────────────────────

describe('8. Droits minimaux', () => {
  beforeEach(async () => {
    await preparerBase(db);
    await appliquerMigration(db, MIGRATION);
  });

  it('public ne peut exécuter aucune fonction ni lire la table', async () => {
    for (const f of [
      'public.stripe_event_claim(text,text,int)',
      'public.stripe_event_complete(text)',
      'public.stripe_event_fail(text,text)',
      'public.crediter_credits_stripe(uuid,integer,text,text,text,text)',
    ]) {
      const { rows } = await db.query('select has_function_privilege($1, $2, $3) as p', ['public', f, 'EXECUTE']);
      expect(rows[0].p, f).toBe(false);
    }
    const t = await db.query("select has_table_privilege('public', 'public.stripe_events', 'SELECT') as p");
    expect(t.rows[0].p).toBe(false);
  });

  /** Exécute `sql` sous `role`, dans une transaction toujours annulée. */
  async function sous(role: string, sql: string) {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      return await db.query(sql);
    } finally {
      await db.query('rollback');
    }
  }

  it('le rôle navigateur est refusé, même sur une table ancienne ouverte à public', async () => {
    await preparerBase(db);
    await db.query(`
      create table public.stripe_events (event_id text primary key, type text, received_at timestamptz default now());
      grant all on table public.stripe_events to public;
    `);
    await appliquerMigration(db, MIGRATION);
    // En production le schéma `public` est utilisable par tous ; le schéma
    // recréé par le harnais ne l'est pas. Sans ce grant, le refus viendrait
    // du schéma et le test ne prouverait rien sur la table ni les fonctions.
    await db.query('grant usage on schema public to public');

    await expect(sous('role_navigateur', "select public.stripe_event_claim('evt', 't')"))
      .rejects.toMatchObject({ code: '42501' });
    await expect(sous('role_navigateur',
      "select * from public.crediter_credits_stripe(gen_random_uuid(), 10, 'purchase', 'stripe:cs:x')"))
      .rejects.toMatchObject({ code: '42501' });
    await expect(sous('role_navigateur', 'select * from public.stripe_events'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(sous('role_navigateur',
      "insert into public.stripe_events (event_id, type) values ('evt_pirate', 't')"))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('les fonctions sont SECURITY DEFINER avec un search_path fige', async () => {
    const { rows } = await db.query(
      `select proname, prosecdef, proconfig from pg_proc
        where proname in ('stripe_event_claim','stripe_event_complete','stripe_event_fail','crediter_credits_stripe')
        order by proname`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toEqual(['search_path=pg_catalog, public']);
    }
  });

  it('service_role, s il existe, reçoit EXECUTE et rien sur la table', async () => {
    // Rôle de CLUSTER : créé pour ce test, retiré à la fin pour ne rien
    // changer à ce que voient les autres fichiers.
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;`);
    try {
      await appliquerMigration(db, MIGRATION);
      await db.query('grant usage on schema public to public');
      const f = await db.query(
        "select has_function_privilege('service_role', 'public.stripe_event_claim(text,text,int)', 'EXECUTE') as p",
      );
      expect(f.rows[0].p).toBe(true);
      const t = await db.query("select has_table_privilege('service_role', 'public.stripe_events', 'SELECT') as p");
      expect(t.rows[0].p).toBe(false);

      const { rows } = await sous('service_role', "select public.stripe_event_claim('evt_srv', 't') as r");
      expect(rows[0].r).toBe('claimed');
      await expect(sous('service_role', 'select * from public.stripe_events'))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.query('drop owned by service_role; drop role service_role;');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Rollback
// ────────────────────────────────────────────────────────────────────────────

describe('9. Rollback', () => {
  beforeEach(async () => {
    await preparerBase(db);
    await appliquerMigration(db, MIGRATION);
  });

  it('retire les fonctions, garde la table et ses lignes, se rejoue, puis la migration se réapplique', async () => {
    await claim(db, 'evt_r');
    await complete(db, 'evt_r');
    await appliquerMigration(db, ROLLBACK);
    await appliquerMigration(db, ROLLBACK);

    const { rows } = await db.query(
      `select count(*)::int as n from pg_proc where proname in
        ('stripe_event_claim','stripe_event_complete','stripe_event_fail','crediter_credits_stripe')`,
    );
    expect(rows[0].n).toBe(0);
    expect((await db.query("select to_regclass('public.credit_transactions_stripe_reference_unique') as t")).rows[0].t).toBeNull();
    expect((await db.query("select to_regclass('public.credit_transactions_reference_unique') as t")).rows[0].t).not.toBeNull();
    expect((await ligne(db, 'evt_r'))?.status).toBe('processed');

    await appliquerMigration(db, MIGRATION);
    expect(await claim(db, 'evt_r')).toBe('already_processed');
  });
});
