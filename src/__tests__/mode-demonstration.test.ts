/**
 * MODE DÉMONSTRATION — ce qui est dit fictif, et ce qui ne peut pas l'être.
 */
import { describe, expect, it } from 'vitest';
import {
  DETAIL_DEMO, DETAIL_EXEMPLES, MENTION_DEMO, MENTION_EXEMPLES, estModeDemonstration,
} from '@/lib/apercu/mode-demo';

describe('détection du mode', () => {
  it('⚠️ TOUJOURS faux en production, quoi qu’on pose ailleurs', () => {
    for (const env of [
      { NODE_ENV: 'production', DEV_AUTH_BYPASS: '1' },
      { NODE_ENV: 'production', STUDIIO_DEMO: '1' },
      { NODE_ENV: 'production', DEV_AUTH_BYPASS: '1', STUDIIO_DEMO: '1' },
    ]) {
      expect(estModeDemonstration(env), JSON.stringify(env)).toBe(false);
    }
  });

  it('hors production, le contournement d’authentification suffit', () => {
    expect(estModeDemonstration({ NODE_ENV: 'development', DEV_AUTH_BYPASS: '1' })).toBe(true);
  });

  it('un drapeau dédié permet de l’annoncer sans contournement', () => {
    expect(estModeDemonstration({ NODE_ENV: 'development', STUDIIO_DEMO: '1' })).toBe(true);
  });

  it('fermé par défaut : un environnement vide n’annonce rien', () => {
    expect(estModeDemonstration({})).toBe(false);
    expect(estModeDemonstration({ NODE_ENV: 'development' })).toBe(false);
  });

  it('une valeur approximative ne l’active pas', () => {
    for (const v of ['true', 'oui', '0', '']) {
      expect(estModeDemonstration({ NODE_ENV: 'development', STUDIIO_DEMO: v }), v).toBe(false);
    }
  });
});

describe('ce que lit l’utilisateur', () => {
  it('les deux mentions sont distinctes et explicites', () => {
    expect(MENTION_DEMO).toContain('données fictives');
    expect(MENTION_EXEMPLES).toContain('non mesurées');
    expect(MENTION_DEMO).not.toBe(MENTION_EXEMPLES);
  });

  it('chaque détail dit ce qui n’est PAS réel, sans ambiguïté', () => {
    expect(DETAIL_DEMO).toMatch(/aucun client réel/);
    expect(DETAIL_DEMO).toMatch(/prestataire de paiement/);
    expect(DETAIL_EXEMPLES).toMatch(/pas une mesure/);
    expect(DETAIL_EXEMPLES).toMatch(/ne doivent pas être lus comme un revenu/);
  });
});
