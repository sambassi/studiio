/**
 * MOBILE MONEY — fermé par défaut, et il dit pourquoi.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_PRODUCTION, BASE_SANDBOX, VARIABLES_ATTENDUES, etatMobileMoney,
} from '@/lib/paiements/mobile-money';

const complet = {
  MOBILE_MONEY_ACTIF: '1',
  MOBILE_MONEY_API_TOKEN: 'factice',
  MOBILE_MONEY_CALLBACK_URL: 'https://studiio.pro/api/paiements/rappel',
} as NodeJS.ProcessEnv;

describe('interrupteur Mobile Money', () => {
  it('environnement vide : fermé', () => {
    const e = etatMobileMoney({} as NodeJS.ProcessEnv);
    expect(e.actif).toBe(false);
    expect(e.motif).toBe('drapeau_absent');
    expect(e.message).toContain('n’est pas activé');
  });

  it('un drapeau approximatif ne l’ouvre pas', () => {
    for (const v of ['true', 'oui', 'yes', 'ON', '']) {
      expect(etatMobileMoney({ ...complet, MOBILE_MONEY_ACTIF: v } as NodeJS.ProcessEnv).actif, v).toBe(false);
    }
  });

  it('drapeau posé mais jeton ou rappel absent : toujours fermé', () => {
    expect(etatMobileMoney({ ...complet, MOBILE_MONEY_API_TOKEN: '' } as NodeJS.ProcessEnv).motif).toBe('jeton_absent');
    expect(etatMobileMoney({ ...complet, MOBILE_MONEY_CALLBACK_URL: '' } as NodeJS.ProcessEnv).motif).toBe('rappel_absent');
  });

  it('tout réuni : ouvert, et le bac à sable est le défaut', () => {
    const e = etatMobileMoney(complet);
    expect(e.actif).toBe(true);
    expect(e.sandbox).toBe(true);
    expect(BASE_SANDBOX).not.toBe(BASE_PRODUCTION);
  });

  it('la production ne s’atteint qu’en la nommant explicitement', () => {
    expect(etatMobileMoney({ ...complet, MOBILE_MONEY_BASE_URL: BASE_PRODUCTION } as NodeJS.ProcessEnv).sandbox).toBe(false);
    expect(etatMobileMoney({ ...complet, MOBILE_MONEY_BASE_URL: BASE_SANDBOX } as NodeJS.ProcessEnv).sandbox).toBe(true);
  });

  it('aucun message ne nomme le prestataire', () => {
    const messages = [
      etatMobileMoney({} as NodeJS.ProcessEnv).message,
      etatMobileMoney({ ...complet, MOBILE_MONEY_API_TOKEN: '' } as NodeJS.ProcessEnv).message,
    ].join(' ').toLowerCase();
    expect(messages).not.toContain('pawapay');
    expect(messages).not.toContain('cinetpay');
  });

  it('les noms de variables sont déclarés, jamais leurs valeurs', () => {
    expect(VARIABLES_ATTENDUES).toContain('MOBILE_MONEY_API_TOKEN');
    expect(VARIABLES_ATTENDUES.join(' ')).not.toMatch(/=|sk_|token_/);
  });
});
