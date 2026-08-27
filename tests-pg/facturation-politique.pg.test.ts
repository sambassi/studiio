/**
 * Facturation différenciée, prouvée sur un vrai PostgreSQL 16.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'administrateur ne consomme aucun crédit commercial — mais il doit
 * produire **la même preuve serveur** que tout le monde : l'objet vu, la
 * transition d'état unique, l'impossibilité de confirmer deux fois. Seul le
 * paiement diffère.
 *
 * Le piège qu'on ferme : jusqu'ici l'exemption vivait dans du TypeScript qui
 * rendait `999_999_999` et neutralisait le débit. Depuis que le socle
 * atomique lit la vraie colonne `users.credits` et ne connaît aucune
 * exception, cette exemption avait disparu **sans que personne le voie** —
 * l'écran annonçait un solde quasi infini pendant qu'un débit réel aurait
 * décrémenté le solde réel.
 *
 * Ici, l'exemption est une politique, résolue depuis le rôle en base, et
 * c'est le moteur qui garantit qu'aucun crédit ne bouge.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  connecter, preparerBase, creerUtilisateurAvecRole, solde, transactions,
  reserverRendu, lireRendu, confirmer, confirmerSansDebit, clore,
  lireFacturation, enConcurrence,
} from './harness';

let db: Client;

beforeAll(async () => { db = await connecter(); });
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => { await preparerBase(db); });

// ════════════════════════════════════════════════════════════════════════════
// 1 à 4 — l'administrateur
// ════════════════════════════════════════════════════════════════════════════

describe('2, 3 & 4. Administrateur — rendu prouvé, aucun crédit touché', () => {
  it('la tentative est confirmée, sans le moindre débit', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');

    const c = await confirmerSansDebit(db, admin, r.id);
    expect(c.ok).toBe(true);
    expect(c.etat).toBe('confirmed');
    expect(c.deja_confirme).toBe(false);

    // 3. Le solde est strictement inchangé.
    expect(await solde(db, admin)).toBe(100);
    // 4. Aucune transaction de crédits n'existe — pas même une à zéro.
    expect(await transactions(db, admin)).toHaveLength(0);
  });

  it('la preuve serveur est la même : l état passe bien à confirmed', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'bureau', 'tv');
    await confirmerSansDebit(db, admin, r.id, 987_654, 'video/webm');
    const f = await lireFacturation(db, r.id);
    expect(f?.etat).toBe('confirmed');
    expect(f?.politique).toBe('partner_cost_only');
    expect(f?.transaction_id).toBeNull();
  });

  it('AUCUNE transaction à zéro n est créée — une ligne à 0 mentirait', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    for (const op of ['apercu', 'bureau', 'calendrier', 'avance-brouillon'] as const) {
      const r = await reserverRendu(db, admin, op, 'reel');
      await confirmerSansDebit(db, admin, r.id);
    }
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.credit_transactions where user_id = $1', [admin],
    );
    expect(Number(rows[0].n)).toBe(0);
    expect(await solde(db, admin)).toBe(100);
  });

  it('même avec un solde nul, le rendu administrateur aboutit', async () => {
    // C'est tout l'intérêt : l'admin n'achète jamais de crédits.
    const admin = await creerUtilisateurAvecRole(db, 0, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'tv');
    const c = await confirmerSansDebit(db, admin, r.id);
    expect(c.ok).toBe(true);
    expect(await solde(db, admin)).toBe(0);
  });

  it('le rejeu ne crée rien non plus', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    for (let i = 0; i < 5; i += 1) await confirmerSansDebit(db, admin, r.id);
    expect(await transactions(db, admin)).toHaveLength(0);
    expect(await solde(db, admin)).toBe(100);
  });

  it('la fonction sans débit garde le verrou de transition', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await clore(db, admin, r.id, 'cancelled');
    const c = await confirmerSansDebit(db, admin, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('rendu_clos');
    expect((await lireRendu(db, r.id))?.etat).toBe('cancelled');
  });

  it('confirmation et annulation concurrentes : une seule gagne, jamais de débit', async () => {
    for (let essai = 0; essai < 8; essai += 1) {
      const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
      const r = await reserverRendu(db, admin, 'apercu', 'reel');
      const res = await enConcurrence(2, async (client, i) => (
        i === 0
          ? { quoi: 'confirmer' as const, r: await confirmerSansDebit(client, admin, r.id) }
          : { quoi: 'clore' as const, r: await clore(client, admin, r.id, 'cancelled') }
      ));
      // On cherche le resultat de l'annulation sans predicat de type : les
      // deux branches de l'union ne portent pas la meme forme.
      const brut = res.find((x) => x.ok && x.valeur.quoi === 'clore');
      const annulation = brut && brut.ok && brut.valeur.quoi === 'clore'
        ? brut.valeur.r : null;
      const etat = (await lireRendu(db, r.id))?.etat;
      // Une annulation qui s'est declaree gagnante doit l'etre restee.
      if (annulation?.ok) expect(etat).toBe('cancelled');
      expect(['confirmed', 'cancelled']).toContain(etat);
      expect(await transactions(db, admin)).toHaveLength(0);
    }
  });

  it("un rendu d'autrui reste refusé, même pour un administrateur", async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const autre = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, autre, 'apercu', 'reel');
    const c = await confirmerSansDebit(db, admin, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('rendu_inconnu');
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5 à 9 — l'utilisateur
// ════════════════════════════════════════════════════════════════════════════

describe('6 & 7. Utilisateur — tarif serveur, un débit exact', () => {
  it('le tarif vient de tarifs_rendu, pas d un paramètre', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    expect((await reserverRendu(db, u, 'apercu', 'reel')).cout).toBe(10);
    expect((await reserverRendu(db, u, 'bureau', 'tv')).cout).toBe(15);
  });

  it('un rendu confirmé débite exactement une fois', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(true);
    expect(await solde(db, u)).toBe(90);
    const t = await transactions(db, u);
    expect(t).toHaveLength(1);
    expect(t[0].reference_id).toBe(`rendu:job:${r.id}`);
  });

  it('8. la confirmation rejouée ne débite pas une seconde fois', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    for (let i = 0; i < 6; i += 1) await confirmer(db, u, r.id);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('8bis. deux confirmations simultanées ne débitent qu une fois', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await enConcurrence(4, (client) => confirmer(client, u, r.id));
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });

  it('9. un rendu annulé ou échoué n est jamais facturé', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    for (const fin of ['cancelled', 'failed'] as const) {
      const r = await reserverRendu(db, u, 'bureau', 'reel');
      await clore(db, u, r.id, fin);
      expect((await confirmer(db, u, r.id)).ok).toBe(false);
    }
    expect(await solde(db, u)).toBe(100);
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('un solde insuffisant ne confirme rien', async () => {
    const u = await creerUtilisateurAvecRole(db, 5, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(false);
    expect(c.motif).toBe('solde_insuffisant');
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
    expect(await solde(db, u)).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Fermé par défaut
// ════════════════════════════════════════════════════════════════════════════

describe('Rôle absent, nul ou inconnu — facturé comme un utilisateur', () => {
  const roles: Array<[string, string | null]> = [
    ['user', 'user'],
    ['null', null],
    ['vide', ''],
    ['inconnu', 'moderateur'],
    ['casse trompeuse', 'Admin'],
    ['espaces', ' admin '],
    ['approchant', 'administrateur'],
  ];

  roles.forEach(([nom, role]) => {
    it(`${nom} → politique credits, donc débité`, async () => {
      const u = await creerUtilisateurAvecRole(db, 100, role);
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      const c = await confirmer(db, u, r.id);
      expect(c.ok).toBe(true);
      expect(await solde(db, u)).toBe(90);
      expect(await transactions(db, u)).toHaveLength(1);
    });
  });

  it('seul « admin » exact ouvre la politique partenaires', async () => {
    // La contrepartie du test précédent : la valeur exacte, elle, fonctionne.
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await confirmerSansDebit(db, admin, r.id);
    expect(await solde(db, admin)).toBe(100);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Le coût partenaire n'est jamais inventé
// ════════════════════════════════════════════════════════════════════════════

describe('Frais partenaires — enregistrés seulement s ils sont exacts', () => {
  it('un coût fourni est enregistré tel quel, avec son partenaire', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await confirmerSansDebit(db, admin, r.id, 120_000, 'video/webm', 'heygen', 'op-42', 0.1875);
    const f = await lireFacturation(db, r.id);
    expect(f?.partenaire).toBe('heygen');
    expect(f?.operation_partenaire).toBe('op-42');
    expect(Number(f?.cout_partenaire)).toBeCloseTo(0.1875, 4);
  });

  it('un coût absent est enregistré INDISPONIBLE, jamais zéro', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await confirmerSansDebit(db, admin, r.id, 120_000, 'video/webm', null, null, null);
    const f = await lireFacturation(db, r.id);
    // `null` dit « le partenaire ne nous a pas dit combien ». Un 0 se
    // relirait comme « cette opération n'a rien coûté ».
    expect(f?.cout_partenaire).toBeNull();
    expect(f?.cout_partenaire).not.toBe(0);
  });

  it('la colonne accepte le zéro quand il est RÉELLEMENT nul', async () => {
    // Distinction volontaire : `null` = inconnu, `0` = gratuit et vérifié.
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await confirmerSansDebit(db, admin, r.id, 120_000, 'video/webm', 'interne', 'gratuit', 0);
    const f = await lireFacturation(db, r.id);
    expect(Number(f?.cout_partenaire)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Droits et forme
// ════════════════════════════════════════════════════════════════════════════

describe('La fonction sans débit est fermée et ne touche pas aux crédits', () => {
  it('le rôle navigateur ne peut pas l exécuter', async () => {
    const { rows } = await db.query<{ autorise: boolean }>(
      `select has_function_privilege('role_navigateur',
         'public.confirmer_rendu_sans_debit(uuid,uuid,bigint,text,text,text,numeric)',
         'EXECUTE') as autorise`,
    );
    expect(rows[0].autorise).toBe(false);
  });

  it('elle fige son search_path', async () => {
    const { rows } = await db.query<{ config: string[] | null }>(
      `select proconfig as config from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='confirmer_rendu_sans_debit'`,
    );
    expect((rows[0].config ?? []).join(' ')).toMatch(/search_path=/);
  });

  it('son corps ne mentionne ni users ni credit_transactions', async () => {
    // Preuve lue dans le catalogue, pas dans le fichier : c'est la fonction
    // RÉELLEMENT installée qui est inspectée.
    const { rows } = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='confirmer_rendu_sans_debit'`,
    );
    expect(rows[0].src).not.toMatch(/public\.users/);
    expect(rows[0].src).not.toMatch(/credit_transactions/);
  });

  it('la contrainte de politique refuse une valeur inventée', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await expect(db.query(
      "update public.rendus set politique = 'gratuit' where id = $1", [r.id],
    )).rejects.toThrow(/check|violates/i);
  });

  it('la politique par défaut d une tentative est credits', async () => {
    const u = await creerUtilisateurAvecRole(db, 100, 'user');
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    expect((await lireFacturation(db, r.id))?.politique).toBe('credits');
  });
});

describe('12. Aucun 999999999 en base', () => {
  it('aucun solde fictif n a été écrit nulle part', async () => {
    const admin = await creerUtilisateurAvecRole(db, 100, 'admin');
    const r = await reserverRendu(db, admin, 'apercu', 'reel');
    await confirmerSansDebit(db, admin, r.id);
    const { rows } = await db.query<{ n: string }>(
      'select count(*) as n from public.users where credits >= 999999999',
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
