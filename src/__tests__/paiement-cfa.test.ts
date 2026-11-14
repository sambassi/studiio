/**
 * CONVERSION EN FRANCS CFA — vérifiable, datée, et jamais devinée.
 */
import { describe, expect, it } from 'vitest';
import {
  EUR_PAR_CHF_MAX, PARITE_CFA_PAR_EUR, annonceConversion, convertirChfVersCfa, estDeviseCfa,
} from '@/lib/paiements/cfa';

/** Taux de référence BCE lu le 2026-11-11 : 1 CHF = 1,083 EUR. */
const TAUX = { tauxEurParChf: 1.083, tauxLe: '2026-11-11' };

const ok = (r: ReturnType<typeof convertirChfVersCfa>) => {
  if (!r.ok) throw new Error(`conversion refusée : ${r.motif}`);
  return r.conversion;
};

describe('parité du franc CFA', () => {
  it('est la parité fixe à l’euro, pas un taux de marché', () => {
    expect(PARITE_CFA_PAR_EUR).toBe(655.957);
  });

  it('XOF et XAF seulement', () => {
    expect(estDeviseCfa('XOF')).toBe(true);
    expect(estDeviseCfa('XAF')).toBe(true);
    expect(estDeviseCfa('EUR')).toBe(false);
    expect(estDeviseCfa('xof')).toBe(false);
  });
});

describe('conversion CHF → CFA', () => {
  it('passe par l’euro : 10 CHF ≈ 7 104 XOF au taux du jour', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', ...TAUX }));
    // 10 × 1,083 × 655,957 = 7 104,014 → 7 105 (arrondi à l'unité supérieure).
    expect(c.montantExact).toBeCloseTo(7104.01, 2);
    expect(c.montant).toBe(7105);
    expect(c.devise).toBe('XOF');
  });

  it('arrondit vers le HAUT, à l’unité : la devise n’a pas de subdivision', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', ...TAUX }));
    expect(Number.isInteger(c.montant)).toBe(true);
    expect(c.montant).toBeGreaterThanOrEqual(c.montantExact);
    // L'écart est rendu, pas dissimulé — et reste sous le franc CFA.
    expect(c.arrondi).toBeGreaterThanOrEqual(0);
    expect(c.arrondi).toBeLessThan(1);
  });

  it('cite ses deux sources : la parité fixe et le taux daté', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 2500, devise: 'XAF', ...TAUX }));
    expect(c.sources[0]).toContain('655,957');
    expect(c.sources[1]).toContain('2026-11-11');
    expect(c.tauxLe).toBe('2026-11-11');
  });

  it('n’ajoute aucun frais par défaut', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 5000, devise: 'XOF', ...TAUX }));
    expect(c.frais).toBe(0);
    expect(annonceConversion(c, 500)).toContain('Aucun frais ajouté.');
  });

  it('des frais répercutés sont affichés, jamais silencieux', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 5000, devise: 'XOF', fraisFraction: 0.02, ...TAUX }));
    expect(c.frais).toBeGreaterThan(0);
    expect(annonceConversion(c, 500)).toMatch(/de frais\.$/);
  });
});

describe('aucun prix en CFA sans taux justifiable', () => {
  it('sans taux : refus, pas de repli', () => {
    const r = convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', tauxEurParChf: null, tauxLe: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motif).toBe('taux_absent');
      expect(r.message).toContain('ne peut pas être affiché');
    }
  });

  it('sans DATE, le taux ne vaut rien', () => {
    const r = convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', tauxEurParChf: 1.083, tauxLe: '11/11/2026' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('taux_absent');
  });

  it('un taux absurde est refusé (le 400 XOF/CHF d’afroboost n’est pas une conversion)', () => {
    const r = convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', tauxEurParChf: EUR_PAR_CHF_MAX + 1, tauxLe: '2026-11-11' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('taux_invalide');
  });

  it('montant nul, négatif ou fractionnaire : refusé', () => {
    for (const chfCentimes of [0, -100, 10.5]) {
      const r = convertirChfVersCfa({ chfCentimes, devise: 'XOF', ...TAUX });
      expect(r.ok, String(chfCentimes)).toBe(false);
    }
  });

  it('devise hors CFA : refusée', () => {
    const r = convertirChfVersCfa({ chfCentimes: 1000, devise: 'NGN', ...TAUX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('devise_inconnue');
  });
});

describe('ce que lit le payeur', () => {
  it('porte le montant, la devise, les crédits, le prix CHF et la date du taux', () => {
    const c = ok(convertirChfVersCfa({ chfCentimes: 1000, devise: 'XOF', ...TAUX }));
    const texte = annonceConversion(c, 100);
    // Séparateur de milliers du fr-CH : espace fine insécable, pas une apostrophe.
    expect(texte).toMatch(/7\s?105 XOF/u);
    expect(texte).toContain('100 crédits');
    // fr-CH écrit la décimale avec une virgule.
    expect(texte).toContain('10,00 CHF');
    expect(texte).toContain('2026-11-11');
  });
});
