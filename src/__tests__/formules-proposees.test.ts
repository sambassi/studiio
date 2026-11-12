/**
 * Les formules visées, confrontées à la valeur du crédit.
 */
import { describe, expect, it } from 'vitest';
import {
  FORMULES_PROPOSEES, REMISE_ABONNEMENT_TOLEREE, analyserFormule, analyserFormulesProposees,
  creditsTenables, margeAbonnement, pireCoutParCredit, type LigneCoutParCredit,
} from '@/lib/stripe/formules-proposees';

const formule = (cle: string) => FORMULES_PROPOSEES.find((f) => f.cle === cle)!;
const VALEUR_PRO = 49 / 600; // 0,0817 CHF — l'échelle actuelle, conservée

describe('formules proposées', () => {
  it('aucune n’est activée : le type lui-même l’interdit', () => {
    for (const f of FORMULES_PROPOSEES) expect(f.activee).toBe(false);
  });

  it('porte les prix cibles, et des crédits CALCULÉS pour rester positifs', () => {
    expect([formule('createur').prixCentimes, formule('createur').credits]).toEqual([1290, 200]);
    expect([formule('pro').prixCentimes, formule('pro').credits]).toEqual([3490, 550]);
    expect([formule('studio').prixCentimes, formule('studio').credits]).toEqual([6990, 1100]);
  });

  it('chaque quantité reste SOUS son plafond tenable', () => {
    // Grille alignée sur le prix conseillé : pire coût = valeur / 1,4.
    const pire = VALEUR_PRO / 1.4;
    for (const f of FORMULES_PROPOSEES) {
      if (f.prixCentimes === 0) continue;
      expect(f.credits, f.nom).toBeLessThan(creditsTenables(f.prixCentimes, pire) as number);
    }
    expect(creditsTenables(1290, pire)).toBe(221);
    expect(creditsTenables(6990, pire)).toBe(1198);
  });

  it('les anciennes quantités annoncées (1000 / 3000 / 6500) ne sont PAS conservées', () => {
    const credits = FORMULES_PROPOSEES.map((f) => f.credits);
    expect(credits).not.toContain(1000);
    expect(credits).not.toContain(6500);
  });

  it('à l’échelle conservée, les trois formules payantes tiennent désormais', () => {
    const a = analyserFormulesProposees(VALEUR_PRO);
    const payantes = a.filter((x) => x.prixCentimes > 0);
    expect(payantes.map((x) => x.verdict)).toEqual(['tenable', 'tenable', 'tenable']);
    // Créateur : 12,90 CHF / 200 crédits = 0,0645 le crédit, 79 % de 0,0817.
    expect(payantes[0].chfParCredit).toBeCloseTo(0.0645, 4);
    expect(payantes[0].rapport).toBeCloseTo(0.79, 2);
  });

  it('une quantité excessive serait dite diluante, avec son plafond', () => {
    // ⚠️ C'était l'état des trois formules avant ce lot : 1 000 crédits pour
    // 12,90 CHF cédaient le crédit à 16 % de sa valeur de référence.
    const a = analyserFormule({ ...formule('createur'), credits: 1000 }, VALEUR_PRO);
    expect(a.verdict).toBe('dilue');
    expect(a.motif).toContain('jusqu’à 225 crédits inclus, pas 1000');
  });

  it('tolère la remise d’abonnement, mais pas au-delà', () => {
    // 200 crédits à 12,90 CHF = 0,0645 le crédit.
    // Référence 0,09 → 72 % : dans la remise tolérée (≥ 70 %).
    expect(analyserFormule(formule('createur'), 0.09).verdict).toBe('tenable');
    // Référence 0,11 → 59 % : au-delà, ce n'est plus une remise.
    expect(analyserFormule(formule('createur'), 0.11).verdict).toBe('dilue');
    expect(REMISE_ABONNEMENT_TOLEREE).toBe(0.3);
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

describe('marge réelle d’un abonnement', () => {
  /** Grille AVANT correction : l'avatar se vend 40 crédits pour 8,57 CHF. */
  const GRILLE_AVANT: LigneCoutParCredit[] = [
    { cle: 'avatar.avatar_v', libelle: 'Premium', prixCredits: 40, coutChf: 8.57 },
    { cle: 'render.reel', libelle: 'Reel (9:16)', prixCredits: 10, coutChf: 0 },
    { cle: 'audio.full_1000_chars', libelle: 'Audio complet', prixCredits: 1, coutChf: 0.066 },
  ];
  /** Grille APRÈS correction : l'avatar est à son prix conseillé. */
  const GRILLE_APRES: LigneCoutParCredit[] = [
    { cle: 'avatar.avatar_v', libelle: 'Premium', prixCredits: 147, coutChf: 8.57 },
    { cle: 'render.reel', libelle: 'Reel (9:16)', prixCredits: 10, coutChf: 0 },
    { cle: 'audio.full_1000_chars', libelle: 'Audio complet', prixCredits: 1, coutChf: 0.058 },
  ];

  it('retient le pire coût par crédit, et nomme l’opération responsable', () => {
    const pire = pireCoutParCredit(GRILLE_AVANT)!;
    expect(pire.cle).toBe('avatar.avatar_v');
    expect(pire.coutParCredit).toBeCloseTo(0.2143, 3);
  });

  it('ignore une ligne sans coût connu au lieu de la compter zéro, et le dit', () => {
    const m = margeAbonnement(formule('createur'), [...GRILLE_APRES, { cle: 'x', libelle: 'Inconnue', prixCredits: 5, coutChf: null }]);
    expect(m.pireOperation).not.toBe('Inconnue');
    expect(m.motif).toContain('1 tarif(s) sans coût connu');
  });

  it('AVANT correction des avatars, la formule perd de l’argent à plein régime', () => {
    const m = margeAbonnement(formule('createur'), GRILLE_AVANT);
    expect(m.prixVenteChf).toBe(12.9);
    expect(m.creditsOfferts).toBe(200);
    expect(m.coutUsageMaxChf).toBeCloseTo(42.86, 1);
    expect(m.margeReelleChf).toBeLessThan(0);
    expect(m.pireOperation).toBe('Premium');
    expect(m.motif).toMatch(/consomme moins de 30 %/);
  });

  it('APRÈS correction, le quota entier dépensé au pire reste positif', () => {
    for (const cle of ['createur', 'pro', 'studio'] as const) {
      const m = margeAbonnement(formule(cle), GRILLE_APRES);
      expect(m.margeReelleChf, cle).toBeGreaterThan(0);
      expect(m.motif, cle).toContain('reste positive');
    }
  });

  it('une formule sans crédits inclus ne porte aucun coût d’usage', () => {
    const m = margeAbonnement(formule('decouverte'), GRILLE_APRES);
    expect(m.coutUsageMaxChf).toBe(0);
    expect(m.margeReelleChf).toBe(0);
  });

  it('aucun coût connu dans la grille : marge réelle incalculable, jamais optimiste', () => {
    const m = margeAbonnement(formule('pro'), [{ cle: 'x', libelle: 'X', prixCredits: 5, coutChf: null }]);
    expect(m.margeReelleChf).toBeNull();
    expect(m.motif).toContain('incalculable');
  });
});
