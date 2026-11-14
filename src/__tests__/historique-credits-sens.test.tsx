/**
 * HISTORIQUE DES CRÉDITS — une consommation ne s'affiche pas comme un gain.
 *
 * L'historique se fiait au SIGNE STOCKÉ dans `credit_transactions.amount`.
 * Or deux conventions y coexistent selon l'appelant : une génération de
 * 40 crédits pouvait être enregistrée en positif, et s'affichait alors
 * « +40 » en vert — exactement comme un achat.
 */
import { describe, expect, it } from 'vitest';
import {
  LIBELLE_PAR_TYPE, SENS_PAR_TYPE, libelleTransaction, montantAffiche,
  montantSigne, sensTransaction,
} from '@/lib/credits/libelles-transaction';

describe('sens d’une transaction', () => {
  it('seule la génération diminue le solde', () => {
    expect(SENS_PAR_TYPE.render).toBe('debit');
    for (const t of ['purchase', 'subscription', 'bonus', 'refund'] as const) {
      expect(SENS_PAR_TYPE[t], t).toBe('credit');
    }
  });

  it('⚠️ le signe vient du TYPE, pas de la colonne — les deux conventions donnent le même affichage', () => {
    expect(montantSigne('render', 40)).toBe(-40);
    expect(montantSigne('render', -40)).toBe(-40);
    expect(montantAffiche('render', 40)).toBe('−40');
    expect(montantAffiche('render', -40)).toBe('−40');
  });

  it('un achat et un remboursement restent positifs, quelle que soit la convention', () => {
    expect(montantAffiche('purchase', 200)).toBe('+200');
    expect(montantAffiche('purchase', -200)).toBe('+200');
    expect(montantAffiche('refund', 40)).toBe('+40');
  });

  it('un type inconnu est traité comme un débit — jamais comme un gain', () => {
    expect(sensTransaction('mystere')).toBe('debit');
    expect(sensTransaction(undefined)).toBe('debit');
    expect(montantAffiche('mystere', 5)).toBe('−5');
  });

  it('un montant illisible ne produit pas NaN à l’écran', () => {
    expect(montantSigne('purchase', 'douze')).toBe(0);
    expect(montantAffiche('purchase', null)).toBe('+0');
  });
});

describe('libellés français', () => {
  it('plus aucun terme technique', () => {
    expect(libelleTransaction('render')).toBe('Génération');
    expect(libelleTransaction('purchase')).toBe('Achat de crédits');
    expect(libelleTransaction('subscription')).toBe('Crédits de l’abonnement');
    expect(libelleTransaction('bonus')).toBe('Crédits offerts');
    expect(libelleTransaction('refund')).toBe('Remboursement');
    for (const l of Object.values(LIBELLE_PAR_TYPE)) expect(l).not.toMatch(/^[a-z_]+$/);
  });

  it('un type inconnu garde sa valeur brute : on ne masque pas une ligne', () => {
    expect(libelleTransaction('mystere')).toBe('mystere');
    expect(libelleTransaction('')).toBe('Opération');
    expect(libelleTransaction(null)).toBe('Opération');
  });
});

describe('cohérence avec le bilan administrateur', () => {
  it('les deux lisent le même sens par type', async () => {
    const { bilanParMois } = await import('@/lib/credits/bilan');
    // La même ligne, stockée dans les deux conventions, compte pareil.
    const positif = bilanParMois([{ type: 'render', amount: 40, created_at: '2026-11-05T10:00:00Z' }], null);
    const negatif = bilanParMois([{ type: 'render', amount: -40, created_at: '2026-11-05T10:00:00Z' }], null);
    expect(positif[0].consommes).toBe(negatif[0].consommes);
    expect(positif[0].consommes).toBe(Math.abs(montantSigne('render', 40)));
  });
});
