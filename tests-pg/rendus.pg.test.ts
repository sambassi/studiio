/**
 * La tentative de rendu : preuve serveur, et un seul débit.
 *
 * Le débit était devenu atomique, mais il restait suspendu dans le vide :
 * rien ne reliait un crédit retiré à un travail réellement produit. Le
 * montage est composé DANS le navigateur et téléversé directement dans MinIO
 * — le serveur ne voyait qu'une autorisation d'écriture, une URL et un
 * nombre, tous fournis par le client.
 *
 * Une ligne de `public.rendus` EST la tentative. Elle porte la clé de
 * stockage attribuée par le serveur, et c'est cette clé-là — jamais une URL
 * soufflée par le client — que le serveur ira vérifier avant de confirmer.
 *
 * Ces tests portent sur ce que la BASE garantit : la transition d'état ne
 * peut se produire qu'une fois, le débit part avec elle ou pas du tout. La
 * vérification de l'objet lui-même est testée côté route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, creerUtilisateur, solde, transactions,
  reserverRendu, lireRendu, confirmer, clore, enConcurrence,
} from './harness';

let db: Client;

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => { await preparerBase(db); });

describe('1 & 3. La tentative est créée par le serveur', () => {
  it('naît réservée, avec un coût et une clé', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    expect(r.etat).toBe('reserved');
    expect(r.cout).toBe(10);
    expect(r.bucket).toBe('media');
    expect(r.cle_objet).toContain(`${u}/rendus/`);
    expect(r.transaction_id).toBeNull();
  });

  it('2. le coût vient du tarif serveur, pas d un paramètre', async () => {
    const u = await creerUtilisateur(db, 100);
    expect((await reserverRendu(db, u, 'bureau', 'tv')).cout).toBe(15);
    expect((await reserverRendu(db, u, 'bureau', 'reel')).cout).toBe(10);
  });

  it('un format hors tarif ne crée AUCUNE tentative', async () => {
    const u = await creerUtilisateur(db, 100);
    // La réservation lit le coût dans `tarifs_rendu` : un format absent ne
    // sélectionne rien, donc rien n'est inséré. Pas d'exception — mais pas de
    // tentative non plus, ce qui est le point : aucun rendu ne peut naître
    // sans tarif.
    await reserverRendu(db, u, 'apercu', 'carre');
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.rendus where user_id = $1', [u],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('et la FK refuse un format inventé, même en écriture directe', async () => {
    const u = await creerUtilisateur(db, 100);
    await expect(db.query(
      `insert into public.rendus (user_id, operation, format, cout, bucket, cle_objet)
       values ($1::uuid, 'apercu', 'carre', 0, 'media', $1::text || '/x.webm')`, [u],
    )).rejects.toThrow(/foreign key|violates/i);
  });

  it('une opération inconnue est refusée', async () => {
    const u = await creerUtilisateur(db, 100);
    await expect(reserverRendu(db, u, 'gratuit', 'reel')).rejects.toThrow(/operation/i);
  });

  it('3. deux tentatives ne peuvent pas viser le même objet', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await expect(db.query(
      `insert into public.rendus (user_id, operation, format, cout, bucket, cle_objet)
       values ($1, 'apercu', 'reel', 10, 'media', $2)`, [u, r.cle_objet],
    )).rejects.toThrow(/unique|duplicate/i);
  });

  it('réserver ne débite RIEN', async () => {
    const u = await creerUtilisateur(db, 100);
    await reserverRendu(db, u, 'apercu', 'reel');
    await reserverRendu(db, u, 'bureau', 'tv');
    expect(await solde(db, u)).toBe(100);
    expect(await transactions(db, u)).toHaveLength(0);
  });
});

describe('6. Confirmer débite une fois, et une seule', () => {
  it('retire le coût et journalise avec la référence de la tentative', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(true);
    expect(c.etat).toBe('confirmed');
    expect(c.deja_confirme).toBe(false);
    expect(c.solde).toBe(90);
    const t = await transactions(db, u);
    expect(t).toHaveLength(1);
    expect(t[0].reference_id).toBe(`rendu:job:${r.id}`);
    expect(t[0].amount).toBe(-10);
  });

  it('relie la transaction à la tentative, et retient ce que le serveur a vu', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'bureau', 'tv');
    await confirmer(db, u, r.id, 987_654, 'video/webm');
    const apres = await lireRendu(db, r.id);
    expect(apres?.transaction_id).not.toBeNull();
    expect(Number(apres?.taille_octets)).toBe(987_654);
  });

  it('12. deux tentatives volontaires distinctes débitent deux fois', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await reserverRendu(db, u, 'apercu', 'reel');
    const b = await reserverRendu(db, u, 'apercu', 'reel');
    await confirmer(db, u, a.id);
    await confirmer(db, u, b.id);
    expect(await solde(db, u)).toBe(80);
    expect(await transactions(db, u)).toHaveLength(2);
  });
});

describe('8 & 11. Rejeu et double clic — un seul débit', () => {
  it('confirmer deux fois de suite ne débite qu une fois', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const un = await confirmer(db, u, r.id);
    const deux = await confirmer(db, u, r.id);
    expect(un.deja_confirme).toBe(false);
    expect(deux.ok).toBe(true);
    expect(deux.deja_confirme).toBe(true);
    expect(deux.solde).toBe(90);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('résiste à dix rejeux', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    for (let i = 0; i < 10; i += 1) await confirmer(db, u, r.id);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('7. deux confirmations SIMULTANÉES ne débitent qu une fois', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const res = await enConcurrence(2, (client) => confirmer(client, u, r.id));
    expect(res.every((x) => x.ok)).toBe(true);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('huit confirmations simultanées : une seule gagne', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const res = await enConcurrence(8, (client) => confirmer(client, u, r.id));
    const valeurs = res.filter((x) => x.ok).map((x) => (x as { valeur: { deja_confirme: boolean } }).valeur);
    expect(valeurs.filter((v) => v.deja_confirme === false)).toHaveLength(1);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('dix tentatives distinctes en parallèle débitent exactement dix fois', async () => {
    const u = await creerUtilisateur(db, 1000);
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push((await reserverRendu(db, u, 'apercu', 'reel')).id);
    await enConcurrence(10, (client, i) => confirmer(client, u, ids[i]));
    expect(await solde(db, u)).toBe(900);
    expect(await transactions(db, u)).toHaveLength(10);
  });
});

describe('9. Une tentative d autrui est refusée', () => {
  it('ne confirme pas, ne débite pas, et ne dit pas qu elle existe', async () => {
    const a = await creerUtilisateur(db, 100);
    const b = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, a, 'apercu', 'reel');
    const c = await confirmer(db, b, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('rendu_inconnu');
    expect(await solde(db, a)).toBe(100);
    expect(await solde(db, b)).toBe(100);
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
  });

  it('une tentative inexistante est refusée de la même façon', async () => {
    const u = await creerUtilisateur(db, 100);
    const c = await confirmer(db, u, '00000000-0000-0000-0000-000000000000');
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('rendu_inconnu');
    expect(await solde(db, u)).toBe(100);
  });

  it('ne peut pas non plus être close par un autre', async () => {
    const a = await creerUtilisateur(db, 100);
    const b = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, a, 'apercu', 'reel');
    expect((await clore(db, b, r.id, 'cancelled')).ok).toBe(false);
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
  });
});

describe('10. Échec de composition ou de téléversement — aucun débit', () => {
  it('une tentative annulée ne débite jamais', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'bureau', 'reel');
    expect((await clore(db, u, r.id, 'cancelled')).ok).toBe(true);
    expect(await solde(db, u)).toBe(100);
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('4 & 5. une tentative marquée en échec ne peut plus être confirmée', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await clore(db, u, r.id, 'failed', 'objet absent');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('rendu_clos');
    expect(await solde(db, u)).toBe(100);
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('une tentative CONFIRMÉE ne peut plus être annulée après coup', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await confirmer(db, u, r.id);
    expect((await clore(db, u, r.id, 'cancelled')).ok).toBe(false);
    expect((await lireRendu(db, r.id))?.etat).toBe('confirmed');
    expect(await solde(db, u)).toBe(90);
  });

  it('un état de clôture inventé est refusé', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    expect((await clore(db, u, r.id, 'confirmed')).ok).toBe(false);
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
  });
});

describe('Crédits insuffisants — rien n est confirmé', () => {
  it('la tentative RESTE réservée : pas de livraison sans paiement', async () => {
    const u = await creerUtilisateur(db, 5);
    const r = await reserverRendu(db, u, 'bureau', 'reel');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('solde_insuffisant');
    expect(c.etat).toBe('reserved');
    // Le point décisif : le passage à `confirmed` a bien été défait.
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
    expect(await solde(db, u)).toBe(5);
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('jamais de solde négatif, même sous vingt confirmations concurrentes', async () => {
    const u = await creerUtilisateur(db, 30);
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) ids.push((await reserverRendu(db, u, 'apercu', 'reel')).id);
    await enConcurrence(20, (client, i) => confirmer(client, u, ids[i]));
    expect(await solde(db, u)).toBe(0);
    expect(await transactions(db, u)).toHaveLength(3);
    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from public.rendus where user_id = $1 and etat = 'confirmed'", [u],
    );
    expect(Number(rows[0].n)).toBe(3);
  });

  it('une tentative redevenue payable se confirme normalement', async () => {
    const u = await creerUtilisateur(db, 5);
    const r = await reserverRendu(db, u, 'bureau', 'reel');
    expect((await confirmer(db, u, r.id)).ok).toBe(false);
    await db.query('update public.users set credits = 50 where id = $1', [u]);
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(true);
    expect(c.solde).toBe(40);
  });
});

describe('Droits', () => {
  it('le rôle navigateur ne peut exécuter ni confirmer ni clore', async () => {
    const { rows } = await db.query<{ c: boolean; k: boolean }>(
      `select has_function_privilege('role_navigateur','public.confirmer_rendu(uuid,uuid,bigint,text)','EXECUTE') as c,
              has_function_privilege('role_navigateur','public.clore_rendu(uuid,uuid,text,text)','EXECUTE') as k`,
    );
    expect(rows[0].c).toBe(false);
    expect(rows[0].k).toBe(false);
  });

  it('aucune des deux fonctions n accepte un montant', async () => {
    const { rows } = await db.query<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('confirmer_rendu','clore_rendu')`,
    );
    expect(rows).toHaveLength(2);
    // `bigint` est la TAILLE observée par le serveur, pas un montant — et elle
    // ne sert qu'à être journalisée.
    for (const r of rows) expect(r.args).not.toMatch(/integer|numeric/);
  });

  it('les deux fonctions figent leur search_path', async () => {
    const { rows } = await db.query<{ proname: string; config: string[] | null }>(
      `select p.proname, p.proconfig as config from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('confirmer_rendu','clore_rendu')`,
    );
    for (const r of rows) expect((r.config ?? []).join(' ')).toMatch(/search_path=/);
  });
});
