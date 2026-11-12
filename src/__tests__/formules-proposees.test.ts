/**
 * Les formules visées, confrontées à la valeur du crédit.
 */
import { describe, expect, it } from 'vitest';
import {
  FORMULES_PROPOSEES, REMISE_ABONNEMENT_TOLEREE, analyserFormule, analyserFormulesProposees,
} from '@/lib/stripe/formules-proposees';

const formule = (cle: string) => FORMULES_PROPOSEES.find((f) => f.cle === cle)!;
const VALEUR_PRO = 49 / 600; // 0,0817 CHF — l'échelle actuelle, conservée

describe('formules proposées', () => {
  it('aucune n’est activée : le type lui-même l’interdit', () => {
    for (const f of FORMULES_PROPOSEES) expect(f.activee).toBe(false);
  });

  it('porte bien la grille annoncée', () => {
    expect([formule('createur').prixCentimes, formule('createur').credits]).toEqual([1290, 1000]);
    expect([formule('pro').prixCentimes, formule('pro').credits]).toEqual([3490, 3000]);
    expect([formule('studio').prixCentimes, formule('studio').credits]).toEqual([6990, 6500]);
  });

  it('à l’échelle actuelle, les trois formules payantes diluent le crédit', () => {
    const a = analyserFormulesProposees(VALEUR_PRO);
    const payantes = a.filter((x) => x.prixCentimes > 0);
    expect(payantes.map((x) => x.verdict)).toEqual(['dilue', 'dilue', 'dilue']);
    // Créateur : 0,0129 CHF le crédit contre 0,0817 → 16 % de la valeur.
    expect(payantes[0].chfParCredit).toBeCloseTo(0.0129, 4);
    expect(payantes[0].rapport).toBeCloseTo(0.158, 2);
  });

  it('dit combien de crédits la formule pourrait inclure sans diluer', () => {
    const a = analyserFormule(formule('createur'), VALEUR_PRO);
    // 12,90 CHF à 0,0817 × 0,7 → 225 crédits.
    expect(a.motif).toContain('jusqu’à 225 crédits inclus, pas 1000');
  });

  it('tolère la remise d’abonnement, mais pas au-delà', () => {
    // 1000 crédits à 12,90 CHF = 0,0129 le crédit.
    // Référence 0,018 → 72 % : dans la remise tolérée (≥ 70 %).
    expect(analyserFormule(formule('createur'), 0.018).verdict).toBe('tenable');
    // Référence 0,020 → 64 % : au-delà, ce n'est plus une remise.
    expect(analyserFormule(formule('createur'), 0.02).verdict).toBe('dilue');
    expect(REMISE_ABONNEMENT_TOLEREE).toBe(0.3);
    expect(analyserFormule(formule('createur'), 0.05).verdict).toBe('dilue');
  });

  it('sans valeur de crédit configurée, aucun verdict inventé', () => {
    const a = analyserFormule(formule('pro'), null);
    expect(a.verdict).toBe('inconnu');
    expect(a.rapport).toBeNull();
    expect(a.chfParCredit).not.toBeNull();
  });

  it('Découverte (gratuite, sans crédits inclus) ne dilue rien', () => {
    const a = analyserFormule(formule('decouverte'), VALEUR_PRO);
    expect(a.verdict).toBe('tenable');
    expect(a.chfParCredit).toBeNull();
  });
});
