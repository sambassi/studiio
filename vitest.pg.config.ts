import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Tests PostgreSQL réels — configuration SÉPARÉE, volontairement.
 *
 * Ils vivent hors de `src/`, hors du glob de `vitest.config.ts`
 * (`src/**\/*.{test,spec}.{ts,tsx}`) : le job Vitest historique ne les ramasse
 * donc pas, et son comportement ne change en rien. Sans cette séparation il
 * les aurait lancés sur un runner sans base, et la CI serait rouge pour une
 * mauvaise raison.
 *
 * `environment: 'node'` et pas `jsdom` : on ouvre de vraies sockets.
 * `setupFiles` n'est pas repris : il ne sert qu'aux tests d'application.
 * `fileParallelism: false` : les fichiers partagent une base unique et la
 * remettent à neuf entre chaque test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-pg/**/*.pg.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
