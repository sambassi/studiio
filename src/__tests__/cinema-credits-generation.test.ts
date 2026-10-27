/**
 * CINEMA IA — LES CRÉDITS PAIENT LA GÉNÉRATION RÉELLE.
 *
 * Ce que ces tests prouvent : un budget qui vit sur le COMPTE (donc qui survit à la
 * suppression d'un film), une réservation prise AVANT l'appel payant, aucune double
 * facturation, aucun appel quand le budget est inconnu — et, depuis le correctif du
 * 30/10/2026, un remboursement FIABLE et IDEMPOTENT quand l'appel payé échoue ensuite
 * (`rembourserCredits`, symétrique de `reserverCredits`).
 *
 * Ce que cela NE prouve PAS : l'atomicité du débit (ni du remboursement) sous concurrence
 * réelle — ce sont des propriétés du MOTEUR PostgreSQL, éprouvées par
 * `tests-pg/debit-operation.pg.test.ts` et `tests-pg/remboursement-credits-operation.pg.test.ts`.
 * Ici les fonctions SQL sont doublées, avec les mêmes règles.
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
  reserverCredits, rembourserCredits, cleTarifGeneration, CLE_TARIF_IMAGE, CLE_TARIF_VIDEO, PREFIXE_REFERENCE,
} from '@/lib/cinema/generation/credits';
import { referenceRemboursement } from '@/lib/credits/atomique';

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

describe('la réservation elle-même reste simple : rembourser est une fonction À PART', () => {
  it('la réservation ne sait pas rendre — ce n’est pas sa responsabilité (voir `rembourserCredits` plus bas)', async () => {
    const r = await reserverCredits('u1', 'video', { prix: prix(15), debiter: debiteur({ credits: 100 }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Aucune API de remboursement SUR la réservation : `rembourserCredits` la prend en
    // paramètre, elle n'est pas une méthode de l'objet — même séparation que le débit et
    // son miroir `rembourserOperationAtomique` côté `lib/credits/atomique.ts`.
    expect('rembourser' in r.reservation).toBe(false);
    expect(Object.keys(r.reservation).sort()).toEqual(['cout', 'reference']);
  });

  it('aucun solde n’est jamais calculé dans l’application (pas de lecture-puis-écriture)', () => {
    const code = readFileSync('src/lib/cinema/generation/credits.ts', 'utf8');
    // Le seul mouvement d'argent est le débit atomique de PostgreSQL.
    expect(code).not.toMatch(/from\('users'\)/);
    expect(code).not.toMatch(/addCredits|credits:\s*\(/);
    expect(code).toContain('debiterOperationAtomique');
  });

  it('l’atelier appelle le paiement APRÈS tous ses refus et AVANT le premier appel payant', () => {
    const a = readFileSync('src/lib/cinema/generation/atelier.ts', 'utf8');
    const iPlafond = a.indexOf('if (!verification.autorise)');
    const iVideoSansImage = a.indexOf("'une video se genere depuis une image");
    const iPayer = a.indexOf('const paiement = await options.payer();');
    const iAppel = a.indexOf('await fournisseur.genererImage(');
    expect(iPlafond).toBeGreaterThan(0);
    expect(iPayer).toBeGreaterThan(iPlafond);
    expect(iPayer).toBeGreaterThan(iVideoSansImage);
    expect(iPayer).toBeLessThan(iAppel);
  });

  it('un refus de paiement n’engage rien : pas de `depenseUsd`, donc rien à compter', () => {
    const a = readFileSync('src/lib/cinema/generation/atelier.ts', 'utf8');
    expect(a).toContain("return { ok: false, erreur: paiement.message, refusPaiement: paiement.motif };");
    // Les `depenseUsd` ne sont posés qu'APRÈS le paiement.
    const iPayer = a.indexOf('const paiement = await options.payer();');
    for (const m of a.matchAll(/depenseUsd: devis\.totalUsd \?\? 0/g)) {
      expect(m.index!).toBeGreaterThan(iPayer);
    }
  });
});

describe('rembourserCredits — fiable, idempotent, jamais une seconde écriture', () => {
  /** Un double de `rembourser_credits_operation` : mêmes règles que la fonction SQL. */
  function rembourseur(solde: { credits: number }, o: { socleAbsent?: boolean; jette?: boolean } = {}) {
    const vus = new Map<string, number>();
    return vi.fn(async (_userId: string, montant: number, reference: string) => {
      if (o.jette) throw new Error('ECONNREFUSED');
      if (o.socleAbsent) return { ok: false, solde: 0, dejaRembourse: false, motif: 'socle_absent' as const };
      if (vus.has(reference)) return { ok: true, solde: solde.credits, dejaRembourse: true, motif: null };
      solde.credits += montant;
      vus.set(reference, montant);
      return { ok: true, solde: solde.credits, dejaRembourse: false, motif: null };
    });
  }

  it('gratuit (coût 0) : rien à rendre, aucun appel à la base', async () => {
    const rembourser = rembourseur({ credits: 0 });
    const r = await rembourserCredits('u1', { cout: 0, reference: 'cinema-generation:x' }, 'image', { rembourser });
    expect(r.ok).toBe(true);
    expect(rembourser).not.toHaveBeenCalled();
  });

  it('remboursement nominal : crédite le montant, avec une référence DÉRIVÉE du débit', async () => {
    const solde = { credits: 85 };
    const rembourser = rembourseur(solde);
    const r = await rembourserCredits('u1', { cout: 15, reference: 'cinema-generation:abc' }, 'video', { rembourser });
    expect(r.ok).toBe(true);
    expect(solde.credits).toBe(100);
    expect(rembourser).toHaveBeenCalledTimes(1);
    const [, montant, reference] = rembourser.mock.calls[0];
    expect(montant).toBe(15);
    // JAMAIS la même référence que le débit : sinon l'index unique confondrait les deux.
    expect(reference).not.toBe('cinema-generation:abc');
    expect(reference).toBe(referenceRemboursement('cinema-generation:abc'));
  });

  it('idempotent : un second appel avec la même réservation ne crédite pas deux fois', async () => {
    const solde = { credits: 85 };
    const rembourser = rembourseur(solde);
    const reservation = { cout: 15, reference: 'cinema-generation:abc' };
    await rembourserCredits('u1', reservation, 'video', { rembourser });
    await rembourserCredits('u1', reservation, 'video', { rembourser });
    expect(solde.credits).toBe(100); // pas 115
  });

  it('migration absente : REFUS explicite (`budget_inconnu`), jamais un succès qui n’a pas eu lieu', async () => {
    const r = await rembourserCredits(
      'u1', { cout: 15, reference: 'cinema-generation:abc' }, 'video',
      { rembourser: rembourseur({ credits: 0 }, { socleAbsent: true }) },
    );
    expect(r).toMatchObject({ ok: false, motif: 'budget_inconnu' });
  });

  it('base injoignable : REFUS, ne lève jamais (la route doit pouvoir répondre quand même)', async () => {
    const r = await rembourserCredits(
      'u1', { cout: 15, reference: 'cinema-generation:abc' }, 'video',
      { rembourser: rembourseur({ credits: 0 }, { jette: true }) },
    );
    expect(r).toMatchObject({ ok: false, motif: 'erreur' });
  });

  it('un motif de refus franc (ex. utilisateur inconnu) est rendu tel quel, sous `refuse`', async () => {
    const rembourser = vi.fn(async () => ({ ok: false, solde: 0, dejaRembourse: false, motif: 'utilisateur_inconnu' as const }));
    const r = await rembourserCredits('u1', { cout: 15, reference: 'cinema-generation:abc' }, 'video', { rembourser });
    expect(r).toMatchObject({ ok: false, motif: 'refuse' });
  });
});

describe('câblage : la route réserve, l’exécuteur paie (hors requête HTTP)', () => {
  const r = readFileSync('src/app/api/cinema/films/[id]/generation/route.ts', 'utf8');
  // Depuis le suivi durable des générations, TOUTE la logique financière vit dans
  // l'exécuteur, lancé en arrière-plan : la route ne débite plus rien elle-même.
  const x = readFileSync('src/lib/cinema/generation/executeur-generation.ts', 'utf8');

  it('le paiement est confié à l’atelier, et seulement en mode réel', () => {
    expect(x).toContain("const payer = mode !== 'reelle' ? undefined : async () => {");
    expect(x).toContain('const prise = await reserverCredits(userId, operation);');
    expect(x).toContain('plafondUsd, payer }');
  });

  it('la route ne touche ni aux crédits ni à la dépense : elle valide, réserve la génération et répond 202', () => {
    expect(r).not.toContain('reserverCredits');
    expect(r).not.toContain('rembourserCredits');
    expect(r).not.toContain('reserverDepenseReplicate');
    expect(r).toContain('reserverGeneration(');
    expect(r).toContain('lancerGeneration(');
    expect(r).toContain('status: 202');
  });

  it('un refus de paiement est noté comme échec, sans remboursement (rien n’a été pris)', () => {
    const iRefus = x.indexOf("if ('refusPaiement' in resultat && resultat.refusPaiement) {");
    expect(iRefus).toBeGreaterThan(0);
    const bloc = x.slice(iRefus, x.indexOf('return', iRefus) + 20);
    expect(bloc).not.toContain('rembourserCredits');
  });

  it('l’argent est écrit sur la génération : crédits pris, puis rendus ou non', () => {
    expect(x).toContain('creditsPris');
    expect(x).toContain('creditsRembourses');
    // Écrit AVANT l'appel payant : une interruption du serveur ne perd pas l'information.
    expect(x.indexOf('referenceCredits: prise.reservation.reference')).toBeGreaterThan(0);
  });

  it('aucune substitution silencieuse : un refus n’est jamais remplacé par une simulation', () => {
    expect(r.indexOf('const choix = fournisseurServeur')).toBeLessThan(r.indexOf('reserverGeneration('));
    expect(r).not.toMatch(/simule[^\n]*(apres|fallback|repli)/i);
    expect(x).not.toMatch(/simule[^\n]*(apres|fallback|repli)/i);
    expect((r.match(/fournisseurServeur\(/g) ?? []).length).toBe(1);
    expect(x).not.toContain('fournisseurServeur(');
  });

  it('le remboursement n’est tenté QUE si des crédits ont réellement été pris', () => {
    const bloc = x.slice(x.indexOf('if (!resultat.ok) {'), x.indexOf('await rembourserCredits(') + 200);
    expect(bloc).toMatch(/if \(res && res\.cout > 0\) \{/);
  });

  it('un remboursement non prouvé est journalisé, mais ne bloque jamais l’issue', () => {
    expect(x).toContain('issue.ok');
    expect(x).toContain('console.error(`[Cinema] remboursement non prouve');
  });
});
