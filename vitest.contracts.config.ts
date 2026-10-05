import { defineConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * Contrats des fonctionnalités verrouillées (docs/FEATURE_LOCKS.md).
 * `npm run test:contracts` — suite courte, lancée avant chaque merge et en CI.
 * `include` REMPLACE celui de la config de base (mergeConfig l'aurait concaténé).
 */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['src/__tests__/contracts/**/*.contract.test.{ts,tsx}'] },
});
