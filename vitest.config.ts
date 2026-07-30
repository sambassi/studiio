import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Timeout généreux pour les tests qui chargent des modules Next.js
    testTimeout: 15000,
    server: {
      deps: {
        // `next-auth` fait `import … from 'next/server'`. Laissé externe, il
        // est chargé par Node, dont la résolution ESM ne suit pas la carte
        // `exports` de Next : « Cannot find module …/node_modules/next/server ».
        // Tout test important — même indirectement — un module touchant à
        // l'auth échouait donc au chargement : c'est le cas de
        // credits-system.test.ts, via lib/admin.ts. Transformé par Vite, le
        // paquet passe par le resolver de Vite, qui lit bien `exports`.
        inline: ['next-auth', '@auth/core'],
      },
    },
    // Couverture de code (optionnel, activable avec --coverage)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
