/**
 * CINEMA IA — PLAFOND DE DEPENSE REELLE, PAR COMPTE ET GLOBAL (lib/cinema/generation/plafond-compte.ts).
 *
 * Ce que ces tests prouvent : la reservation refuse un montant inconnu/nul, elle ne leve
 * jamais, le budget inconnu (migration absente, base injoignable) refuse plutot que
 * d'engager a l'aveugle, et les plafonds sont LUS depuis l'environnement avec des bornes de
 * securite. L'ATOMICITE et la CONCURRENCE sont des proprietes du moteur PostgreSQL, eprouvees
 * par `tests-pg/cinema-plafond-compte.pg.test.ts` — la fonction SQL est doublee ici, avec les
 * memes regles de refus.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  reserverDepenseReplicate, confirmerDepenseReplicate, referenceDepense, PREFIXE_REFERENCE_DEPENSE,
  plafondCompteUsd, plafondGlobalUsd, PLAFOND_USD_PAR_COMPTE_DEFAUT, PLAFOND_USD_GLOBAL_DEFAUT,
  type ResultatReservationDepense,
} from '@/lib/cinema/generation/plafond-compte';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('les plafonds sont lus depuis l’environnement, avec une borne de securite', () => {
  it('absent ou vide : le defaut', () => {
    expect(plafondCompteUsd(env({}))).toBe(PLAFOND_USD_PAR_COMPTE_DEFAUT);
    expect(plafondCompteUsd(env({ CINEMA_PLAFOND_USD_COMPTE: '' }))).toBe(PLAFOND_USD_PAR_COMPTE_DEFAUT);
    expect(plafondGlobalUsd(env({}))).toBe(PLAFOND_USD_GLOBAL_DEFAUT);
  });

  it('invalide (non numerique, negatif) : le defaut, jamais 0 ni NaN', () => {
    for (const v of ['abc', '-5', 'NaN']) {
      expect(plafondCompteUsd(env({ CINEMA_PLAFOND_USD_COMPTE: v })), v).toBe(PLAFOND_USD_PAR_COMPTE_DEFAUT);
      expect(plafondGlobalUsd(env({ CINEMA_PLAFOND_USD_GLOBAL: v })), v).toBe(PLAFOND_USD_GLOBAL_DEFAUT);
    }
  });

  it('une valeur valide est reprise telle quelle, sous la borne haute', () => {
    expect(plafondCompteUsd(env({ CINEMA_PLAFOND_USD_COMPTE: '10' }))).toBe(10);
    expect(plafondGlobalUsd(env({ CINEMA_PLAFOND_USD_GLOBAL: '200' }))).toBe(200);
  });

  it('une valeur mal saisie ne peut pas ouvrir un budget illimite — bornee', () => {
    expect(plafondCompteUsd(env({ CINEMA_PLAFOND_USD_COMPTE: '999999' }))).toBe(50);
    expect(plafondGlobalUsd(env({ CINEMA_PLAFOND_USD_GLOBAL: '999999' }))).toBe(1000);
  });
});

describe('referenceDepense', () => {
  it('prefixe toujours de la meme maniere, pour etre reconnaissable au journal', () => {
    expect(referenceDepense('abc')).toBe(`${PREFIXE_REFERENCE_DEPENSE}:abc`);
  });
});

/** Un double de `reserver_depense_cinema` : mêmes règles que la fonction SQL. */
function reserveur(etat: { compte: number; global: number }, o: { socleAbsent?: boolean; jette?: boolean } = {}) {
  const vus = new Set<string>();
  return vi.fn(async (
    _userId: string, montant: number, reference: string, _operation: 'image' | 'video',
    plafondCompte: number, plafondGlobal: number,
  ): Promise<ResultatReservationDepense> => {
    if (o.jette) throw new Error('ECONNREFUSED');
    if (o.socleAbsent) return { ok: false, motif: 'socle_absent', dejaEngagee: false, totalCompteUsd: 0, totalGlobalUsd: 0 };
    if (vus.has(reference)) {
      return { ok: true, motif: null, dejaEngagee: true, totalCompteUsd: etat.compte, totalGlobalUsd: etat.global };
    }
    if (etat.compte + montant > plafondCompte) {
      return { ok: false, motif: 'plafond_compte_depasse', dejaEngagee: false, totalCompteUsd: etat.compte, totalGlobalUsd: etat.global };
    }
    if (etat.global + montant > plafondGlobal) {
      return { ok: false, motif: 'plafond_global_depasse', dejaEngagee: false, totalCompteUsd: etat.compte, totalGlobalUsd: etat.global };
    }
    etat.compte += montant;
    etat.global += montant;
    vus.add(reference);
    return { ok: true, motif: null, dejaEngagee: false, totalCompteUsd: etat.compte, totalGlobalUsd: etat.global };
  });
}

describe('reserverDepenseReplicate — ne depense jamais a l’aveugle', () => {
  it('montant positif connu, sous les deux plafonds : reserve et rend la reference', async () => {
    const etat = { compte: 0, global: 0 };
    const reserver = reserveur(etat);
    const r = await reserverDepenseReplicate('u1', 0.45, 'video', { reserver, plafondCompte: 5, plafondGlobal: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.montantUsd).toBe(0.45);
      expect(r.reference).toContain(PREFIXE_REFERENCE_DEPENSE);
    }
    expect(etat.compte).toBe(0.45);
  });

  it('montant nul, negatif, NaN ou Infinity : refus AVANT tout appel a la base', async () => {
    const reserver = reserveur({ compte: 0, global: 0 });
    for (const m of [0, -0.45, Number.NaN, Number.POSITIVE_INFINITY]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await reserverDepenseReplicate('u1', m, 'video', { reserver });
      expect(r).toMatchObject({ ok: false, motif: 'montant_invalide' });
    }
    expect(reserver).not.toHaveBeenCalled();
  });

  it('plafond du compte depasse : refus chiffre, rien engage', async () => {
    const etat = { compte: 4.8, global: 0 };
    const reserver = reserveur(etat);
    const r = await reserverDepenseReplicate('u1', 1, 'video', { reserver, plafondCompte: 5, plafondGlobal: 100 });
    expect(r).toMatchObject({ ok: false, motif: 'plafond_compte_depasse' });
    if (!r.ok) expect(r.message).toContain('5.00');
    expect(etat.compte).toBe(4.8);
  });

  it('plafond global depasse : refus chiffre, meme si le compte a de la marge', async () => {
    const etat = { compte: 0, global: 99.6 };
    const reserver = reserveur(etat);
    const r = await reserverDepenseReplicate('u1', 1, 'video', { reserver, plafondCompte: 50, plafondGlobal: 100 });
    expect(r).toMatchObject({ ok: false, motif: 'plafond_global_depasse' });
    if (!r.ok) expect(r.message).toContain('100.00');
  });

  it('migration absente (socle_absent) : refus explicite, jamais un appel a l’aveugle', async () => {
    const r = await reserverDepenseReplicate('u1', 0.45, 'video', { reserver: reserveur({ compte: 0, global: 0 }, { socleAbsent: true }) });
    expect(r).toMatchObject({ ok: false, motif: 'socle_absent' });
  });

  it('base injoignable : refus, ne leve jamais', async () => {
    const r = await reserverDepenseReplicate('u1', 0.45, 'video', { reserver: reserveur({ compte: 0, global: 0 }, { jette: true }) });
    expect(r).toMatchObject({ ok: false, motif: 'socle_absent' });
  });

  it('idempotence : un rejeu de la meme reference ne reserve pas deux fois', async () => {
    const etat = { compte: 0, global: 0 };
    const reserver = reserveur(etat);
    const ref = referenceDepense('fixe');
    await reserverDepenseReplicate('u1', 0.45, 'video', { reserver, reference: ref });
    await reserverDepenseReplicate('u1', 0.45, 'video', { reserver, reference: ref });
    expect(etat.compte).toBe(0.45);
  });
});

/** Un double de `confirmer_depense_cinema`. */
function confirmateur(o: { ok?: boolean; motif?: string | null; jette?: boolean } = {}) {
  return vi.fn(async () => {
    if (o.jette) throw new Error('ECONNREFUSED');
    return { ok: o.ok ?? true, motif: (o.motif as never) ?? null };
  });
}

describe('confirmerDepenseReplicate — ne leve jamais, meme en echec', () => {
  it('confirmation reussie', async () => {
    const confirmer = confirmateur();
    const r = await confirmerDepenseReplicate('u1', referenceDepense('x'), 'confirmee', { confirmer });
    expect(r.ok).toBe(true);
    expect(confirmer).toHaveBeenCalledWith('u1', referenceDepense('x'), 'confirmee', null);
  });

  it('refus de la base (ex. deja_finalisee) : rendu tel quel, jamais une exception', async () => {
    const r = await confirmerDepenseReplicate('u1', referenceDepense('x'), 'liberee', { confirmer: confirmateur({ ok: false, motif: 'deja_finalisee' }) });
    expect(r).toMatchObject({ ok: false, motif: 'deja_finalisee' });
  });

  it('base injoignable : refus, jamais une exception qui remonterait a la route', async () => {
    const r = await confirmerDepenseReplicate('u1', referenceDepense('x'), 'incertaine', { confirmer: confirmateur({ jette: true }) });
    expect(r).toMatchObject({ ok: false, motif: 'socle_absent' });
  });

  it('transmet un montant final different, quand fourni', async () => {
    const confirmer = confirmateur();
    await confirmerDepenseReplicate('u1', referenceDepense('x'), 'confirmee', { confirmer, montantFinal: 0.5 });
    expect(confirmer).toHaveBeenCalledWith('u1', referenceDepense('x'), 'confirmee', 0.5);
  });
});
