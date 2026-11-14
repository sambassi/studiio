/**
 * BILAN DES CRÉDITS — ce qui est mesuré, et ce qui reste inconnu.
 */
import { describe, expect, it } from 'vitest';
import { bilanParMois, margeParMois } from '@/lib/credits/bilan';

const T = (type: string, amount: number, jour = '2026-11-03') => ({ type, amount, created_at: `${jour}T10:00:00Z` });

describe('bilan par mois', () => {
  it('classe chaque type de transaction', () => {
    const [m] = bilanParMois([
      T('purchase', 200), T('purchase', 50), T('subscription', 600),
      T('bonus', 10), T('refund', 40), T('render', 15), T('render', 10),
    ], 0.0817);
    expect(m.mois).toBe('2026-11');
    expect([m.vendus, m.abonnement, m.offerts, m.remboursés, m.consommes]).toEqual([250, 600, 10, 40, 25]);
  });

  it('prend les montants en valeur absolue : les deux conventions de signe coexistent en base', () => {
    const [m] = bilanParMois([T('render', -15), T('render', 10)], null);
    expect(m.consommes).toBe(25);
  });

  it('estime la recette des recharges, et la nomme comme une estimation', () => {
    const [m] = bilanParMois([T('purchase', 200)], 0.1);
    expect(m.recetteEstimeeChf).toBe(20);
    // Les crédits d'abonnement ne sont PAS une recharge : ils ne comptent pas.
    const [m2] = bilanParMois([T('subscription', 600)], 0.1);
    expect(m2.recetteEstimeeChf).toBe(0);
  });

  it('sans valeur du crédit, aucune recette inventée', () => {
    const [m] = bilanParMois([T('purchase', 200)], null);
    expect(m.recetteEstimeeChf).toBeNull();
  });

  it('compte les lignes inclassables au lieu de les ignorer', () => {
    const [m] = bilanParMois([T('mystere', 5), { type: 'purchase', amount: 'douze', created_at: '2026-11-03T10:00:00Z' }], 0.1);
    expect(m.nonClassees).toBe(2);
    expect(m.vendus).toBe(0);
  });

  it('range les mois du plus récent au plus ancien', () => {
    const r = bilanParMois([T('purchase', 1, '2026-09-01'), T('purchase', 1, '2026-11-01'), T('purchase', 1, '2026-10-01')], 0.1);
    expect(r.map((m) => m.mois)).toEqual(['2026-11', '2026-10', '2026-09']);
  });

  it('une ligne sans date est écartée, pas rangée dans un mois inventé', () => {
    expect(bilanParMois([{ type: 'purchase', amount: 10 }], 0.1)).toEqual([]);
  });
});

describe('marge du mois', () => {
  const credits = bilanParMois([T('purchase', 1000)], 0.1); // 100 CHF estimés

  it('rapproche recette et coût dans la MÊME monnaie', () => {
    const [m] = margeParMois({
      credits,
      coutsFournisseurEur: [{ mois: '2026-11', coutFournisseurEur: 40 }],
      chfParEur: 0.93,
    });
    expect(m.coutFournisseurChf).toBe(37.2);
    expect(m.margeEstimeeChf).toBe(62.8);
    expect(m.motif).toBeNull();
  });

  it('sans taux EUR → CHF : marge inconnue, et la raison est dite', () => {
    const [m] = margeParMois({ credits, coutsFournisseurEur: [{ mois: '2026-11', coutFournisseurEur: 40 }], chfParEur: null });
    expect(m.margeEstimeeChf).toBeNull();
    expect(m.motif).toContain('pas dans la même monnaie');
  });

  it('coût non mesuré : marge inconnue, jamais une marge égale à la recette', () => {
    const [m] = margeParMois({ credits, coutsFournisseurEur: [{ mois: '2026-11', coutFournisseurEur: null }], chfParEur: 0.93 });
    expect(m.margeEstimeeChf).toBeNull();
    expect(m.recetteEstimeeChf).toBe(100);
    expect(m.motif).toContain('Aucun coût fournisseur mesuré');
  });

  it('sans valeur du crédit, ni recette ni marge', () => {
    const [m] = margeParMois({
      credits: bilanParMois([T('purchase', 1000)], null),
      coutsFournisseurEur: [{ mois: '2026-11', coutFournisseurEur: 40 }],
      chfParEur: 0.93,
    });
    expect(m.recetteEstimeeChf).toBeNull();
    expect(m.margeEstimeeChf).toBeNull();
  });
});
