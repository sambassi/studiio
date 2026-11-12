import { defineConfig, devices } from 'playwright/test';

/**
 * E2E DU CHANTIER COMMERCIAL — isolé des autres chantiers.
 *
 *  - PORT 3100, pas 3000 : un autre worktree peut avoir son serveur en cours.
 *  - Deux profils, ordinateur et mobile : la mise en page compacte doit tenir
 *    à 390 px sans débordement horizontal.
 *  - AUCUN PAIEMENT, AUCUNE GÉNÉRATION PAYANTE : les appels d'API sont
 *    interceptés et servis depuis des fixtures, et un garde fait échouer le
 *    test si une requête part vers un prestataire de paiement ou un
 *    encaissement (`e2e/commerce/garde-paiement.ts`).
 */
export default defineConfig({
  testDir: './e2e/commerce',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx next dev -p 3100',
    port: 3100,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
