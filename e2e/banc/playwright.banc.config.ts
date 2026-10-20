import { defineConfig } from 'playwright/test';
import path from 'node:path';

/**
 * Banc E2E ISOLÉ — Studiio sur `next dev` port 3100, sans aucun service réel.
 *
 *   BANC_PHASE=avant npx playwright test -c e2e/banc/playwright.banc.config.ts
 *   BANC_PHASE=apres npx playwright test -c e2e/banc/playwright.banc.config.ts
 *
 * Toute route /api/** est simulée (voir `fixtures.ts`) ; toute requête vers un
 * hôte autre que localhost est COUPÉE et comptée (attendu : 0).
 * Le serveur n'est lancé que s'il ne tourne pas déjà (`reuseExistingServer`).
 * La config principale `playwright.config.ts` (port 3000) n'est pas touchée.
 */
const ICI = __dirname;
const RACINE = path.resolve(ICI, '../..');
/** Port du `next dev` du banc (3100 par défaut ; `BANC_PORT` pour isoler deux worktrees). */
const PORT = Number(process.env.BANC_PORT || 3100);

export default defineConfig({
  testDir: ICI,
  testMatch: /.*\.spec\.ts$/,
  outputDir: path.join(ICI, 'resultats', 'artefacts'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(ICI, 'resultats', 'rapport.json') }],
    ['html', { outputFolder: path.join(ICI, 'resultats', 'rapport-html'), open: 'never' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    serviceWorkers: 'block',
    // `chromium` = Chromium complet en nouveau mode headless : le « headless
    // shell » ne produit presque aucune image depuis un canvas capturé
    // (5 images pour 8,7 s mesurées) — un artefact du banc, pas de l'app.
    channel: process.env.BANC_CANAL || 'chromium',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'ordinateur', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'tablette', use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'telephone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    cwd: RACINE,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
