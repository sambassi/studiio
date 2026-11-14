import { defineConfig, devices } from 'playwright/test';

/**
 * E2E DU CHANTIER COMMERCIAL — isolé des autres chantiers.
 *
 *  - PORT 3100, pas 3000 : un autre worktree peut avoir son serveur en cours.
 *  - Deux profils, ordinateur et mobile : la mise en page compacte doit tenir
 *    à 390 px sans débordement horizontal.
 *  - POUR LANCER : `npm run test:e2e:commerce`. Le serveur a besoin d'une
 *    identité de session locale, donc d'un `.env.local` NON COMMITÉ (le
 *    `.gitignore` l'écarte) contenant seulement :
 *
 *        NODE_ENV=development
 *        DEV_AUTH_BYPASS=1
 *        AUTH_SECRET=<n'importe quelle chaîne locale>
 *        NEXTAUTH_URL=http://localhost:3100
 *        NEXT_PUBLIC_APP_URL=http://localhost:3100
 *        AUTH_TRUST_HOST=true
 *
 *    Aucune clé de base, de fournisseur ni de paiement : sans elles, rien ne
 *    peut partir vers un service externe, et aucune donnée de production
 *    n'est touchée. L'identité servie n'est PAS administratrice — c'est ce
 *    qui permet de vérifier la frontière d'accès.
 *
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
