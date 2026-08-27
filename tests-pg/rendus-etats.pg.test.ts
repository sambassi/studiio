/**
 * Le VERROU DE TRANSITION : seul un travail exactement `reserved` peut être
 * confirmé, donc débité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE SÉPARÉMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'index unique sur `(user_id, reference_id)` empêche un SECOND débit d'une
 * même référence. Il ne dit rien du PREMIER débit d'un travail déjà
 * `cancelled` ou `failed` : la référence n'a jamais été écrite, l'index n'a
 * donc rien à refuser. Les deux protections sont distinctes, et aucune ne
 * remplace l'autre.
 *
 * Une mutation l'avait prouvé : retirer `where etat = 'reserved'` laissait la
 * CI verte, parce qu'aucun test n'atteignait cette clause — le garde précoce
 * de la fonction interceptait tous les cas séquentiels. Le scénario qui la
 * met réellement à l'épreuve est une COURSE entre confirmation et annulation.
 *
 * Ces tests appellent la fonction SQL réelle. Aucune garde TypeScript n'est
 * dans le chemin : le moteur doit démontrer le verrou lui-même.
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

/** Force un état terminal directement en base, sans passer par une fonction. */
async function forcerEtat(client: Client, id: string, etat: string) {
  await client.query('update public.rendus set etat = $2 where id = $1', [id, etat]);
}

describe('1. `reserved` — la seule porte ouverte', () => {
  it('se confirme et débite une fois', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(true);
    expect(c.etat).toBe('confirmed');
    expect(c.deja_confirme).toBe(false);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });
});

describe('2. `confirmed` — rejeu idempotent', () => {
  it('rend le même résultat sans second débit', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await confirmer(db, u, r.id);
    const c = await confirmer(db, u, r.id);
    expect(c.ok).toBe(true);
    expect(c.deja_confirme).toBe(true);
    expect(c.solde).toBe(90);
    expect(await solde(db, u)).toBe(90);
    expect(await transactions(db, u)).toHaveLength(1);
  });
});

describe('3 & 4. Les états terminaux ne se confirment JAMAIS', () => {
  (['cancelled', 'failed'] as const).forEach((etat) => {
    it(`${etat} → refus, aucun débit, état inchangé`, async () => {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      await forcerEtat(db, r.id, etat);

      const c = await confirmer(db, u, r.id);
      expect(c.ok).toBe(false);
      expect(c.motif).toBe('rendu_clos');
      expect(c.etat).toBe(etat);
      expect(c.deja_confirme).toBe(false);

      expect(await solde(db, u)).toBe(100);
      expect(await transactions(db, u)).toHaveLength(0);
      expect((await lireRendu(db, r.id))?.etat).toBe(etat);
    });

    it(`${etat} → dix tentatives de confirmation ne débitent toujours rien`, async () => {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      await forcerEtat(db, r.id, etat);
      for (let i = 0; i < 10; i += 1) await confirmer(db, u, r.id);
      expect(await solde(db, u)).toBe(100);
      expect(await transactions(db, u)).toHaveLength(0);
    });

    it(`${etat} → passer par clore_rendu ne le rouvre pas`, async () => {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      await clore(db, u, r.id, etat === 'cancelled' ? 'cancelled' : 'failed');
      // Puis on tente de le refermer dans l'autre sens, puis de le confirmer.
      expect((await clore(db, u, r.id, 'cancelled')).ok).toBe(false);
      expect((await confirmer(db, u, r.id)).ok).toBe(false);
      expect(await transactions(db, u)).toHaveLength(0);
    });
  });
});

describe('5. Transitions invalides', () => {
  it('un état inconnu en base est refusé, pas confirmé par défaut', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    // Le `check` de la colonne interdit d'y écrire n'importe quoi : la
    // garantie vient de la base, pas d'une liste tenue à la main.
    await expect(forcerEtat(db, r.id, 'gratuit')).rejects.toThrow(/check|violates/i);
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
  });

  it('clore_rendu refuse de poser un état non terminal', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    expect((await clore(db, u, r.id, 'confirmed')).ok).toBe(false);
    expect((await clore(db, u, r.id, 'reserved')).ok).toBe(false);
    expect((await lireRendu(db, r.id))?.etat).toBe('reserved');
    expect(await transactions(db, u)).toHaveLength(0);
  });

  it('une tentative confirmée ne redevient jamais annulable', async () => {
    const u = await creerUtilisateur(db, 100);
    const r = await reserverRendu(db, u, 'apercu', 'reel');
    await confirmer(db, u, r.id);
    expect((await clore(db, u, r.id, 'cancelled')).ok).toBe(false);
    expect((await clore(db, u, r.id, 'failed')).ok).toBe(false);
    expect((await lireRendu(db, r.id))?.etat).toBe('confirmed');
    expect(await solde(db, u)).toBe(90);
  });
});

describe('6. Confirmation et annulation CONCURRENTES', () => {
  /**
   * Le scénario qui met réellement la clause `where etat = 'reserved'` à
   * l'épreuve. L'issue n'est pas déterministe — l'une ou l'autre gagne — mais
   * l'INVARIANT l'est : un seul état terminal, et un débit si et seulement si
   * c'est la confirmation qui l'emporte.
   */
  const course = async (u: string, id: string) => enConcurrence(2, async (client, i) => (
    i === 0
      ? { quoi: 'confirmer' as const, r: await confirmer(client, u, id) }
      : { quoi: 'clore' as const, r: await clore(client, u, id, 'cancelled') }
  ));

  it('une seule transition terminale gagne, et le débit la suit', async () => {
    for (let essai = 0; essai < 12; essai += 1) {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');

      const res = await course(u, r.id);
      expect(res.every((x) => x.ok)).toBe(true);

      const etatFinal = (await lireRendu(db, r.id))?.etat;
      const journal = await transactions(db, u);
      const soldeFinal = await solde(db, u);

      expect(['confirmed', 'cancelled']).toContain(etatFinal);

      if (etatFinal === 'confirmed') {
        // La confirmation a gagné : exactement un débit.
        expect(journal).toHaveLength(1);
        expect(soldeFinal).toBe(90);
      } else {
        // L'annulation a gagné : AUCUN débit. C'est ici que le verrou compte —
        // sans lui, la confirmation écraserait l'annulation et facturerait.
        expect(journal).toHaveLength(0);
        expect(soldeFinal).toBe(100);
      }
    }
  });

  it("le résultat rendu à l'appelant ne ment jamais sur l'état", async () => {
    // Une confirmation qui perd la course doit dire qu'elle a perdu. Repondre
    // « déjà confirmé » ferait livrer le montage sans qu'il ait été payé.
    for (let essai = 0; essai < 12; essai += 1) {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');

      const res = await course(u, r.id);
      const conf = res.find(
        (x): x is { ok: true; valeur: { quoi: 'confirmer'; r: Awaited<ReturnType<typeof confirmer>> } } =>
          x.ok && (x as { valeur: { quoi: string } }).valeur.quoi === 'confirmer',
      )!.valeur.r;

      const etatFinal = (await lireRendu(db, r.id))?.etat;
      const journal = await transactions(db, u);

      if (conf.ok) {
        // Elle se dit gagnante : il DOIT y avoir un débit et l'état confirmé.
        expect(etatFinal).toBe('confirmed');
        expect(journal).toHaveLength(1);
      } else {
        // Elle se dit perdante : rien ne doit avoir été facturé.
        expect(conf.motif).toBe('rendu_clos');
        expect(etatFinal).toBe('cancelled');
        expect(journal).toHaveLength(0);
      }
    }
  });

  it('huit confirmations contre une annulation : au plus un débit', async () => {
    for (let essai = 0; essai < 6; essai += 1) {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');

      await enConcurrence(9, async (client, i) => (
        i === 8 ? clore(client, u, r.id, 'cancelled') : confirmer(client, u, r.id)
      ));

      const journal = await transactions(db, u);
      const etatFinal = (await lireRendu(db, r.id))?.etat;
      expect(journal.length).toBeLessThanOrEqual(1);
      if (etatFinal === 'cancelled') expect(journal).toHaveLength(0);
      if (etatFinal === 'confirmed') expect(journal).toHaveLength(1);
      expect(await solde(db, u)).toBe(100 - journal.length * 10);
    }
  });
});

describe('7. Deux confirmations concurrentes — un seul débit', () => {
  it('sur douze essais, jamais deux débits', async () => {
    for (let essai = 0; essai < 12; essai += 1) {
      const u = await creerUtilisateur(db, 100);
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      await enConcurrence(2, (client) => confirmer(client, u, r.id));
      expect(await transactions(db, u)).toHaveLength(1);
      expect(await solde(db, u)).toBe(90);
      expect((await lireRendu(db, r.id))?.etat).toBe('confirmed');
    }
  });
});

describe('8. Cohérence après chaque scénario', () => {
  it('un débit existe si et seulement si l état est confirmed', async () => {
    const u = await creerUtilisateur(db, 1000);
    const scenarios: Array<'confirmer' | 'annuler' | 'echouer' | 'laisser'> =
      ['confirmer', 'annuler', 'echouer', 'laisser', 'confirmer', 'annuler'];

    const ids: string[] = [];
    for (const s of scenarios) {
      const r = await reserverRendu(db, u, 'apercu', 'reel');
      ids.push(r.id);
      if (s === 'confirmer') await confirmer(db, u, r.id);
      if (s === 'annuler') await clore(db, u, r.id, 'cancelled');
      if (s === 'echouer') await clore(db, u, r.id, 'failed');
    }

    const { rows } = await db.query<{ etat: string; transaction_id: string | null }>(
      'select etat, transaction_id from public.rendus where user_id = $1', [u],
    );
    for (const ligne of rows) {
      if (ligne.etat === 'confirmed') expect(ligne.transaction_id).not.toBeNull();
      else expect(ligne.transaction_id).toBeNull();
    }

    const confirmes = rows.filter((l) => l.etat === 'confirmed').length;
    expect(confirmes).toBe(2);
    expect(await transactions(db, u)).toHaveLength(2);
    expect(await solde(db, u)).toBe(1000 - 2 * 10);
  });

  it('jamais de débit orphelin : chaque transaction pointe une tentative confirmée', async () => {
    const u = await creerUtilisateur(db, 100);
    const a = await reserverRendu(db, u, 'apercu', 'reel');
    const b = await reserverRendu(db, u, 'bureau', 'tv');
    await confirmer(db, u, a.id);
    await clore(db, u, b.id, 'failed');

    const journal = await transactions(db, u);
    expect(journal).toHaveLength(1);
    expect(journal[0].reference_id).toBe(`rendu:job:${a.id}`);
    // Rien ne référence la tentative fermée.
    expect(journal.some((t) => t.reference_id === `rendu:job:${b.id}`)).toBe(false);
  });
});
