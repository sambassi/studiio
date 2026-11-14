/**
 * Vérifie DANS UN VRAI NAVIGATEUR que la prévisualisation commerciale est
 * utilisable : la page Réglages → Abonnement s'affiche, et « S'abonner » ouvre
 * le choix du moyen de paiement.
 *
 * Un test qui ne regarderait que le code HTTP laisserait passer exactement la
 * panne qu'on cherche : le serveur répond 200 pendant que la page reste blanche
 * (le contenu est rendu côté navigateur).
 *
 * Aucun paiement : on ouvre le panneau, on ne clique sur aucun moyen de payer.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3112';
const navigateur = await chromium.launch();
let code = 0;

for (const [nom, options] of [
  ['ordinateur', { viewport: { width: 1440, height: 900 } }],
  ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const page = await (await navigateur.newContext(options)).newPage();
  const dialogues = [];
  page.on('dialog', async (d) => { dialogues.push(d.message()); await d.dismiss(); });
  try {
    await page.goto(`${base}/dashboard/settings?tab=abonnement`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('text=Abonnement actuel', { timeout: 90_000 });
    const elements = await page.evaluate(() => document.body.querySelectorAll('*').length);
    if (elements < 200) throw new Error(`page quasi vide (${elements} éléments)`);

    await page.getByRole('button', { name: "S'abonner" }).nth(1).click();
    await page.waitForSelector('[data-testid="choix-paiement"]', { timeout: 30_000 });
    await page.waitForSelector('[data-testid="payer-carte"]', { timeout: 30_000 });
    if (dialogues.length) throw new Error(`alerte native : ${dialogues[0]}`);
    console.log(`OK    [${nom}] page affichée (${elements} éléments), « S'abonner » ouvre le choix du paiement`);
  } catch (e) {
    code = 1;
    console.log(`ECHEC [${nom}] ${e.message.split('\n')[0]}`);
  } finally {
    await page.context().close();
  }
}

await navigateur.close();
process.exit(code);
