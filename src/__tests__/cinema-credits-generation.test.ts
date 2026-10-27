/**
 * CINEMA IA — LES CRÉDITS PAIENT LA GÉNÉRATION RÉELLE.
 *
 * Ce que ces tests prouvent : un budget qui vit sur le COMPTE (donc qui survit à la
 * suppression d'un film), une réservation prise AVANT l'appel payant, aucune double
 * facturation, aucun appel quand le budget est inconnu, et un remboursement seulement
 * quand rien n'est parti chez le fournisseur.
 *
 * Ce que cela NE prouve PAS : l'atomicité du débit sous concurrence réelle — c'est une
 * propriété du MOTEUR PostgreSQL, éprouvée par `tests-pg/debit-operation.pg.test.ts`.
 * Ici la fonction SQL est doublée, avec les mêmes règles.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

const journal = vi.hoisted(() => ({ lignes: [] as Array<{ reference: string; amount: number; type: string }>, erreurLecture: false, solde: 0 }));
const credites = vi.hoisted(() => ([] as Array<{ userId: string; montant: number; type: string }>));

/** Base simulée : index unique (user_id, reference_id) sur le journal, et solde du compte. */
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => {
        const filtres: Array<[string, unknown]> = [];
        const q: Record<string, unknown> = {
          eq: (k: string, v: unknown) => { filtres.push([k, v]); return q; },
          maybeSingle: async () => ({ data: table === 'users' ? { credits: journal.solde } : null, error: null }),
          then: (ok: (r: unknown) => unknown) => {
            if (journal.erreurLecture) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok);
            const ref = filtres.find(([k]) => k === 'reference_id')?.[1];
            return Promise.resolve({
              data: journal.lignes.filter((l) => l.reference === ref).map((l) => ({ id: l.reference, amount: l.amount, type: l.type })),
              error: null,
            }).then(ok);
          },
        };
        return q;
      },
      insert: async (ligne: Record<string, unknown>) => {
        const ref = String(ligne.reference_id ?? '');
        // L'index unique partiel : une référence déjà présente est refusée.
        if (journal.lignes.some((l) => l.reference === ref)) {
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        journal.lignes.push({ reference: ref, amount: Number(ligne.amount), type: String(ligne.type) });
        if (String(ligne.type) === 'refund') credites.push({ userId: String(ligne.user_id), montant: Number(ligne.amount), type: 'refund' });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async () => { if (table === 'users' && typeof patch.credits === 'number') journal.solde = patch.credits; return { error: null }; },
      }),
    }),
  },
}));

import {
  reserverCredits, rembourserUneFois, cleTarifGeneration, CLE_TARIF_IMAGE, CLE_TARIF_VIDEO,
  PREFIXE_REFERENCE, referenceRemboursement,
} from '@/lib/cinema/generation/credits';

/** Un double de `debiter_credits_operation` : mêmes règles que la fonction SQL. */
function debiteur(solde: { credits: number }, o: { socleAbsent?: boolean; jette?: boolean } = {}) {
  const vus = new Map<string, number>();
  return vi.fn(async (_userId: string, montant: number, type: string, reference: string) => {
    if (o.jette) throw new Error('ECONNREFUSED');
    if (o.socleAbsent) return { ok: false, solde: 0, dejaDebite: false, motif: 'socle_absent' as const };
    // Idempotence par référence, comme l'index unique (user_id, reference_id).
    if (vus.has(reference)) return { ok: true, solde: solde.credits, dejaDebite: true, motif: null };
    if (solde.credits < montant) return { ok: false, solde: solde.credits, dejaDebite: false, motif: 'solde_insuffisant' as const };
    solde.credits -= montant;
    vus.set(reference, montant);
    journal.lignes.push({ reference, amount: montant, type });
    return { ok: true, solde: solde.credits, dejaDebite: false, motif: null };
  });
}
const prix = (v: number) => async () => v;

beforeEach(() => { journal.lignes = []; journal.erreurLecture = false; journal.solde = 0; credites.length = 0; vi.clearAllMocks(); });

describe('les clés de tarif sont celles qui existent déjà', () => {
  it('image et vidéo utilisent le catalogue existant — aucune clé inventée', () => {
    expect(cleTarifGeneration('image')).toBe(CLE_TARIF_IMAGE);
    expect(cleTarifGeneration('video')).toBe(CLE_TARIF_VIDEO);
    expect(CLE_TARIF_IMAGE).toBe('ai.generate_background');
    expect(CLE_TARIF_VIDEO).toBe('ai.image_to_video');
  });
});

describe('la réservation précède l’appel payant', () => {
  it('solde suffisant : les crédits sont pris tout de suite, le solde baisse', async () => {
    const solde = { credits: 100 };
    const debiter = debiteur(solde);
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservation.cout).toBe(15);
    expect(solde.credits).toBe(85);
    expect(debiter).toHaveBeenCalledTimes(1);
    // Référence propre à la tentative, préfixée pour être reconnaissable au journal.
    if (r.ok) expect(r.reservation.reference).toContain(PREFIXE_REFERENCE);
  });

  it('solde insuffisant : REFUS chiffré, aucun débit, aucun appel possible', async () => {
    const solde = { credits: 3 };
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur(solde) });
    expect(r).toMatchObject({ ok: false, motif: 'solde_insuffisant', cout: 15 });
    if (!r.ok) expect(r.message).toContain('15 crédits');
    expect(solde.credits).toBe(3);
  });

  it('deux générations simultanées ne dépassent pas le solde : la seconde est refusée', async () => {
    const solde = { credits: 20 };
    const debiter = debiteur(solde);
    const [a, b] = await Promise.all([
      reserverCredits('u1', 'video', { prix: prix(15), debiter }),
      reserverCredits('u1', 'video', { prix: prix(15), debiter }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(solde.credits).toBe(5);
  });

  it('chaque tentative a SA référence : une seconde génération paie, elle n’est pas gratuite', async () => {
    const solde = { credits: 100 };
    const debiter = debiteur(solde);
    const a = await reserverCredits('u1', 'image', { prix: prix(5), debiter });
    const b = await reserverCredits('u1', 'image', { prix: prix(5), debiter });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.reservation.reference).not.toBe(b.reservation.reference);
    expect(solde.credits).toBe(90);
  });

  it('un rejeu de la MÊME référence ne débite pas deux fois', async () => {
    const solde = { credits: 100 };
    const debiter = debiteur(solde);
    await debiter('u1', 5, 'render', 'cinema-generation:fixe');
    await debiter('u1', 5, 'render', 'cinema-generation:fixe');
    expect(solde.credits).toBe(95);
  });
});

describe('budget inconnu : on ne dépense pas à l’aveugle', () => {
  it('prix illisible, négatif, ou lecture en panne : REFUS, aucun débit', async () => {
    const solde = { credits: 100 };
    for (const p of [Number.NaN, -1, Infinity]) {
      const r = await reserverCredits('u1', 'image', { prix: prix(p), debiter: debiteur(solde) });
      expect(r).toMatchObject({ ok: false, motif: 'budget_inconnu' });
    }
    const r = await reserverCredits('u1', 'image', { prix: async () => { throw new Error('tarifs illisibles'); }, debiter: debiteur(solde) });
    expect(r).toMatchObject({ ok: false, motif: 'budget_inconnu' });
    expect(solde.credits).toBe(100);
  });

  it('migration du débit atomique absente : REFUS (on ne sait pas compter, on ne dépense pas)', async () => {
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur({ credits: 999 }, { socleAbsent: true }) });
    expect(r).toMatchObject({ ok: false, motif: 'budget_inconnu' });
  });

  it('base injoignable au moment du débit : REFUS, jamais un appel payant « au cas où »', async () => {
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur({ credits: 999 }, { jette: true }) });
    expect(r).toMatchObject({ ok: false, motif: 'budget_inconnu' });
  });

  it('tarif administré à ZÉRO : gratuit, aucun débit — et ce n’est pas un budget inconnu', async () => {
    const debiter = debiteur({ credits: 0 });
    const r = await reserverCredits('u1', 'image', { prix: prix(0), debiter });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservation.cout).toBe(0);
    expect(debiter).not.toHaveBeenCalled();
  });
});

describe('remboursement : seulement si rien n’est parti, et une seule fois', () => {
  it('rend le montant RÉELLEMENT débité, pas le tarif du moment', async () => {
    const solde = { credits: 100 };
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur(solde) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await r.reservation.rembourser('fournisseur eteint')).toBe(true);
    expect(credites).toEqual([{ userId: 'u1', montant: 15, type: 'refund' }]);
  });

  it('un second remboursement est refusé PAR LA BASE (index unique), rien n’est rendu deux fois', async () => {
    const r = await reserverCredits('u1', 'image', { prix: prix(5), debiter: debiteur({ credits: 50 }) });
    if (!r.ok) throw new Error('réservation attendue');
    expect(await r.reservation.rembourser('x')).toBe(true);
    expect(await r.reservation.rembourser('x')).toBe(false);
    expect(await rembourserUneFois('u1', r.reservation.reference, 'x')).toBe(false);
    expect(credites).toHaveLength(1);
    // La trace porte sa propre référence, dérivée du débit.
    expect(journal.lignes.filter((l) => l.reference === referenceRemboursement(r.reservation.reference))).toHaveLength(1);
  });

  it('deux remboursements SIMULTANÉS : un seul passe', async () => {
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur({ credits: 100 }) });
    if (!r.ok) throw new Error('réservation attendue');
    const issues = await Promise.all([r.reservation.rembourser('a'), r.reservation.rembourser('b')]);
    expect(issues.filter(Boolean)).toHaveLength(1);
    expect(credites).toHaveLength(1);
  });

  it('le solde du compte remonte du montant rendu', async () => {
    journal.solde = 35;
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur({ credits: 100 }) });
    if (!r.ok) throw new Error('réservation attendue');
    await r.reservation.rembourser('x');
    expect(journal.solde).toBe(50);
  });

  it('rien au journal (aucun débit) : rien à rendre', async () => {
    expect(await rembourserUneFois('u1', 'cinema-generation:jamais-debitee', 'x')).toBe(false);
    expect(credites).toHaveLength(0);
  });

  it('journal illisible : remboursement différé, jamais un crédit inventé', async () => {
    const r = await reserverCredits('u1', 'image', { prix: prix(5), debiter: debiteur({ credits: 50 }) });
    if (!r.ok) throw new Error('réservation attendue');
    journal.erreurLecture = true;
    expect(await r.reservation.rembourser('x')).toBe(false);
    expect(credites).toHaveLength(0);
  });

  it('une réservation gratuite n’a rien à rendre', async () => {
    const r = await reserverCredits('u1', 'image', { prix: prix(0), debiter: debiteur({ credits: 0 }) });
    if (!r.ok) throw new Error('réservation attendue');
    expect(await r.reservation.rembourser('x')).toBe(false);
  });
});

describe('câblage de la route', () => {
  const r = readFileSync('src/app/api/cinema/films/[id]/generation/route.ts', 'utf8');

  it('la réservation est prise AVANT tout travail, et seulement en mode réel', () => {
    expect(r).toContain("if (choix.mode === 'reelle') {");
    expect(r).toContain("const prise = await reserverCredits(s.userId, operation as 'image' | 'video');");
    expect(r.indexOf('reserverCredits')).toBeLessThan(r.indexOf('await avecDossierTemporaire(ctx,'));
  });

  it('solde insuffisant → 402 ; budget inconnu → 409 ; aucun appel dans les deux cas', () => {
    expect(r).toContain("status: prise.motif === 'solde_insuffisant' ? 402 : 409");
    expect(r.indexOf("if (!prise.ok) {")).toBeLessThan(r.indexOf('await avecDossierTemporaire(ctx,'));
  });

  it('les crédits ne sont rendus que si le fournisseur n’a JAMAIS été appelé', () => {
    expect(r).toContain('const engage = (resultat.depenseUsd ?? 0) > 0;');
    expect(r).toContain('if (reservation && !engage) await reservation.rembourser(');
  });

  it('la réponse dit la vérité sur l’argent (rendu ou pris)', () => {
    expect(r).toContain('creditsRendus: !engage');
    expect(r).toContain('creditsPris: engage ? reservation.cout : 0');
  });

  it('aucune substitution silencieuse : un refus n’est jamais remplacé par une simulation', () => {
    // Le fournisseur est choisi UNE fois, avant la réservation ; aucun repli après un refus.
    expect(r.indexOf('const choix = fournisseurServeur')).toBeLessThan(r.indexOf('await reserverCredits('));
    expect(r).not.toMatch(/simule[^\n]*(apres|fallback|repli)/i);
    expect((r.match(/fournisseurServeur\(/g) ?? []).length).toBe(1);
  });
});
