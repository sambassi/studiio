/**
 * LE CONTRAT DU PRESTATAIRE — les pièges déjà payés ailleurs.
 *
 * Chaque cas ci-dessous correspond à une panne constatée sur l'intégration
 * d'afroboost. Les figer ici évite de les repayer.
 */
import { describe, expect, it } from 'vitest';
import {
  MOTIF_MAX, confirmationAutorisee, corpsPagePaiement, estDefinitif,
  identifiantDeLaNotification, lireDepot, lirePagePaiement, referenceCredit,
  statutDepuisPrestataire,
} from '@/lib/paiements/pawapay/contrat';

const DEMANDE = {
  depositId: 'dep-1', pays: 'sen', devise: 'XOF', montant: 20602,
  motif: 'Studiio — 200 crédits', retourUrl: 'https://studiio.pro/retour',
};

describe('corps de création', () => {
  it('⚠️ le montant va dans `amountDetails`, PAS à la racine', () => {
    const c = corpsPagePaiement(DEMANDE);
    expect(c.amountDetails).toEqual({ amount: '20602', currency: 'XOF' });
    expect(c.amount).toBeUndefined();
  });

  it('⚠️ le montant part en CHAÎNE, entier pour une devise sans décimale', () => {
    expect((corpsPagePaiement(DEMANDE).amountDetails as { amount: unknown }).amount).toBe('20602');
    const avecDecimales = corpsPagePaiement({ ...DEMANDE, devise: 'KES', montant: 1234.5 });
    expect((avecDecimales.amountDetails as { amount: unknown }).amount).toBe('1234.50');
  });

  it('⚠️ le champ du numéro est `phoneNumber`, pas `msisdn` — et il est omis s’il manque', () => {
    expect(corpsPagePaiement({ ...DEMANDE, telephone: '+221770000000' }).phoneNumber).toBe('+221770000000');
    expect(corpsPagePaiement(DEMANDE).phoneNumber).toBeUndefined();
    expect(corpsPagePaiement(DEMANDE).msisdn).toBeUndefined();
  });

  it('le motif est borné, le pays mis en majuscules', () => {
    const long = corpsPagePaiement({ ...DEMANDE, motif: 'x'.repeat(120) });
    expect(String(long.reason)).toHaveLength(MOTIF_MAX);
    expect(long.country).toBe('SEN');
  });
});

describe('lecture de la réponse de création', () => {
  it('⚠️ `failureReason` PRIME sur un HTTP 200', () => {
    const lu = lirePagePaiement({ failureReason: 'PROVIDER_UNAVAILABLE' });
    expect(lu.ok).toBe(false);
    expect(lu.refus).toBe('echec_annonce');
    expect(lu.urlRedirection).toBeNull();
  });

  it('un numéro refusé est reconnu — c’est le seul cas qui mérite une relance', () => {
    expect(lirePagePaiement({ failureReason: 'INVALID_PHONE_NUMBER' }).refus).toBe('telephone_invalide');
    expect(lirePagePaiement({ failureReason: { failureCode: 'INVALID_PHONE_NUMBER' } }).refus).toBe('telephone_invalide');
  });

  it('⚠️ l’URL est cherchée sous tous les noms déjà observés', () => {
    for (const cle of ['redirectUrl', 'paymentPageUrl', 'paymentUrl', 'url', 'sessionUrl']) {
      const lu = lirePagePaiement({ [cle]: 'https://pay.exemple/abc' });
      expect(lu.ok, cle).toBe(true);
      expect(lu.urlRedirection, cle).toBe('https://pay.exemple/abc');
    }
  });

  it('une URL non https, ou absente, est un refus — jamais une redirection hasardeuse', () => {
    expect(lirePagePaiement({ redirectUrl: 'http://pay.exemple' }).refus).toBe('url_absente');
    expect(lirePagePaiement({}).refus).toBe('url_absente');
    expect(lirePagePaiement(null).refus).toBe('url_absente');
  });
});

describe('lecture d’un dépôt', () => {
  it('accepte l’objet seul comme le tableau d’un élément', () => {
    const attendu = { statut: 'reussi', montant: 20602, devise: 'XOF', motifEchec: null };
    expect(lireDepot({ status: 'COMPLETED', amountDetails: { amount: '20602', currency: 'XOF' } })).toEqual(attendu);
    expect(lireDepot([{ status: 'COMPLETED', amountDetails: { amount: '20602', currency: 'xof' } }])).toEqual(attendu);
  });

  it('⚠️ un statut inconnu reste EN ATTENTE — on ne conclut pas d’un mot qu’on ignore', () => {
    for (const s of ['PROCESSING', 'ACCEPTED', 'IN_RECONCILIATION', 'ZZZ', undefined]) {
      expect(statutDepuisPrestataire(s), String(s)).toBe('en_attente');
    }
    expect(estDefinitif('en_attente')).toBe(false);
    for (const s of ['reussi', 'echoue', 'expire', 'annule'] as const) expect(estDefinitif(s), s).toBe(true);
  });

  it('traduit les statuts connus', () => {
    expect(statutDepuisPrestataire('COMPLETED')).toBe('reussi');
    expect(statutDepuisPrestataire('FAILED')).toBe('echoue');
    expect(statutDepuisPrestataire('EXPIRED')).toBe('expire');
    expect(statutDepuisPrestataire('CANCELLED')).toBe('annule');
  });
});

describe('ce qui autorise à créditer', () => {
  const base = { montantAttendu: 20602, deviseAttendue: 'XOF' };

  it('les trois contrôles sont exigés ensemble', () => {
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: 20602, devise: 'XOF', motifEchec: null } }).ok).toBe(true);
    expect(confirmationAutorisee({ ...base, lu: { statut: 'en_attente', montant: 20602, devise: 'XOF', motifEchec: null } })).toMatchObject({ refus: 'statut_non_reussi' });
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: null, devise: 'XOF', motifEchec: null } })).toMatchObject({ refus: 'montant_absent' });
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: 20601, devise: 'XOF', motifEchec: null } })).toMatchObject({ refus: 'montant_insuffisant' });
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: 20602, devise: 'XAF', motifEchec: null } })).toMatchObject({ refus: 'devise_differente' });
  });

  it('la tolérance d’un centime absorbe les arrondis, pas un paiement partiel', () => {
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: 20601.995, devise: 'XOF', motifEchec: null } }).ok).toBe(true);
    expect(confirmationAutorisee({ ...base, lu: { statut: 'reussi', montant: 20000, devise: 'XOF', motifEchec: null } }).ok).toBe(false);
  });
});

describe('notification', () => {
  it('⚠️ on n’en retient QUE l’identifiant — tout le reste est relu au prestataire', () => {
    expect(identifiantDeLaNotification({ depositId: 'abcd1234', status: 'COMPLETED', amount: '999999' })).toBe('abcd1234');
    expect(identifiantDeLaNotification({ data: { deposit_id: 'abcd1234' } })).toBe('abcd1234');
    expect(identifiantDeLaNotification({ deposit: { id: 'abcd1234' } })).toBe('abcd1234');
  });

  it('un corps sans identifiant exploitable ne déclenche rien', () => {
    for (const c of [null, {}, { depositId: 'x' }, { depositId: '../../etc' }, 'texte']) {
      expect(identifiantDeLaNotification(c), JSON.stringify(c)).toBeNull();
    }
  });

  it('la référence de crédit porte le préfixe qui garantit l’unicité', () => {
    expect(referenceCredit('abc')).toBe('mm:abc');
    expect(referenceCredit('abc')).not.toMatch(/^stripe:/);
  });
});
