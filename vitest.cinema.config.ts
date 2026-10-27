import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * CINEMA IA — banc de production REELLE, configuration separee.
 *
 * Pourquoi il ne peut PAS vivre dans `vitest.config.ts` :
 *
 *  1. `setupFiles: src/__tests__/setup.ts` interdit toute socket sortante —
 *     une bonne regle, qui existe pour qu'aucun test n'appelle un fournisseur
 *     payant par accident. Mais Remotion ouvre une socket LOCALE (choix de
 *     port, `getPort`) et telecharge Chrome Headless Shell : le garde-fou les
 *     refuse tous les deux. Il n'est pas affaibli ici, il est CONTOURNE dans
 *     un fichier a part, qu'on lance a la main.
 *  2. `environment: 'jsdom'` casse esbuild (« TextEncoder … incorrectly
 *     false »), que le bundler Remotion charge. Un rendu video n'a rien a
 *     faire dans un DOM simule.
 *
 * Lancement :  npm run test:cinema
 * Pre-requis : Chrome Headless Shell installe (`npx remotion browser ensure`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-cinema/**/*.cinema.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
