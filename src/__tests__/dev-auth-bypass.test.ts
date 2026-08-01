import { describe, it, expect } from 'vitest';
import { isDevAuthBypassEnabled } from '@/lib/auth/config';

/**
 * Contournement d'authentification de développement.
 *
 * Le test qui compte est le premier : **en production, le contournement est
 * inactif quoi qu'il arrive**. Les autres décrivent la porte étroite dans
 * laquelle il s'ouvre en local.
 */

describe('En production, le contournement est INACTIF — sans exception', () => {
  it('reste inactif même avec DEV_AUTH_BYPASS=1', () => {
    expect(isDevAuthBypassEnabled({ NODE_ENV: 'production', DEV_AUTH_BYPASS: '1' })).toBe(false);
  });

  it('reste inactif quelle que soit la valeur du drapeau', () => {
    for (const v of ['1', 'true', 'yes', 'TRUE', 'on', '0', '', undefined]) {
      expect(
        isDevAuthBypassEnabled({ NODE_ENV: 'production', DEV_AUTH_BYPASS: v as string }),
        `DEV_AUTH_BYPASS=${String(v)}`,
      ).toBe(false);
    }
  });
});

describe('Hors production, il faut encore un opt-in explicite', () => {
  it("s'active en développement avec exactement '1'", () => {
    expect(isDevAuthBypassEnabled({ NODE_ENV: 'development', DEV_AUTH_BYPASS: '1' })).toBe(true);
    expect(isDevAuthBypassEnabled({ NODE_ENV: 'test', DEV_AUTH_BYPASS: '1' })).toBe(true);
  });

  it('reste inactif sans le drapeau — le défaut local est l authentification', () => {
    expect(isDevAuthBypassEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevAuthBypassEnabled({ NODE_ENV: 'development', DEV_AUTH_BYPASS: '' })).toBe(false);
  });

  it('refuse les valeurs approchantes : seul « 1 » ouvre la porte', () => {
    for (const v of ['true', 'yes', 'on', 'TRUE', '01', ' 1', '1 ', '2']) {
      expect(
        isDevAuthBypassEnabled({ NODE_ENV: 'development', DEV_AUTH_BYPASS: v }),
        `DEV_AUTH_BYPASS=${v}`,
      ).toBe(false);
    }
  });

  it('NODE_ENV absent est traité comme non-production, drapeau toujours requis', () => {
    expect(isDevAuthBypassEnabled({ DEV_AUTH_BYPASS: '1' })).toBe(true);
    expect(isDevAuthBypassEnabled({})).toBe(false);
  });
});

describe('La décision ne dépend que du serveur', () => {
  it("n'utilise que NODE_ENV et DEV_AUTH_BYPASS, rien d autre", () => {
    // Un environnement bourré de valeurs qu'un client pourrait influencer
    // (en-têtes, cookies, hôte) ne change rien : seules les deux clés comptent.
    const pollué = {
      NODE_ENV: 'production',
      DEV_AUTH_BYPASS: '0',
      HTTP_X_DEV_AUTH_BYPASS: '1',
      COOKIE: 'dev_auth_bypass=1',
      HOST: 'localhost',
      NEXT_PUBLIC_DEV_AUTH_BYPASS: '1',
    } as unknown as { NODE_ENV?: string; DEV_AUTH_BYPASS?: string };
    expect(isDevAuthBypassEnabled(pollué)).toBe(false);
  });

  it('est une fonction pure : même entrée, même résultat', () => {
    const env = { NODE_ENV: 'development', DEV_AUTH_BYPASS: '1' };
    expect(isDevAuthBypassEnabled(env)).toBe(isDevAuthBypassEnabled(env));
  });
});

describe('Le code source ne lit jamais le client pour cette décision', () => {
  it('la garde ne mentionne ni cookie, ni en-tête, ni paramètre d URL', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(__dirname, '../lib/auth/config.ts'), 'utf-8');
    const garde = src.slice(
      src.indexOf('export function isDevAuthBypassEnabled'),
      src.indexOf('export const DEV_SESSION'),
    );
    expect(garde.length).toBeGreaterThan(50);
    for (const interdit of ['cookies', 'headers', 'searchParams', 'req.', 'request']) {
      expect(garde, interdit).not.toContain(interdit);
    }
  });

  it('le drapeau est figé au chargement, pas recalculé par requête', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(__dirname, '../lib/auth/config.ts'), 'utf-8');
    expect(src).toContain('export const DEV_AUTH_BYPASS = isDevAuthBypassEnabled()');
    // Le middleware consomme la constante, il ne réévalue pas l'environnement.
    const mw = readFileSync(resolve(__dirname, '../middleware.ts'), 'utf-8');
    expect(mw).toContain('DEV_AUTH_BYPASS');
    expect(mw).not.toContain('process.env');
  });
});
