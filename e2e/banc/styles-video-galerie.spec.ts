/**
 * Galerie « Styles vidéo » de l'étape Style (Créer) — ordinateur, tablette, téléphone.
 *
 *   GALERIE_SORTIE=/chemin BANC_PORT=4100 npx playwright test -c e2e/banc/playwright.banc.config.ts \
 *     e2e/banc/styles-video-galerie.spec.ts
 *
 * Vérifie : aucun débordement (page ni galerie), aucun style présélectionné, un clic choisit (et pose
 * les réglages visibles en dessous), l'exemple ne joue qu'au survol / focus, détail derrière l'icône.
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect, DOSSIER_RESULTATS } from './fixtures';
import { ouvrirCreer, allerA } from './parcours';

const SORTIE = process.env.GALERIE_SORTIE || path.join(DOSSIER_RESULTATS, 'styles-video');

test('galerie des styles vidéo : épurée, sans débordement, un clic', async ({ page }, info) => {
  fs.mkdirSync(SORTIE, { recursive: true });
  await ouvrirCreer(page);
  await allerA(page, 'Style');
  const galerie = page.locator('[data-galerie-styles]');
  await expect(galerie).toBeVisible();
  // Aucun style présélectionné (default safe).
  await expect(galerie.locator('button[aria-pressed="true"]')).toHaveCount(0);
  // Aucune lecture spontanée.
  const joue = () => galerie.locator('video').evaluateAll((vs) => vs.filter((v) => !(v as HTMLVideoElement).paused).length);
  expect(await joue()).toBe(0);
  await galerie.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SORTIE, `galerie-${info.project.name}-repos.png`) });

  const mesure = await page.evaluate(() => {
    const g = document.querySelector('[data-galerie-styles]') as HTMLElement;
    const r = g.getBoundingClientRect();
    return {
      pageDeborde: document.documentElement.scrollWidth > window.innerWidth + 1,
      galerieHors: r.left < -0.5 || r.right > window.innerWidth + 0.5,
      cartesDebordent: Array.from(g.querySelectorAll('[data-style-video] > button')).some((b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1),
    };
  });
  expect(mesure).toEqual({ pageDeborde: false, galerieHors: false, cartesDebordent: false });

  // Focus clavier → l'exemple joue (muet) ; un clic choisit.
  const sport = galerie.locator('[data-style-video="sport"] > button');
  await sport.focus();
  await expect.poll(joue, { timeout: 10_000 }).toBe(1);
  await sport.click();
  await expect(sport).toHaveAttribute('aria-pressed', 'true');
  // Les réglages avancés existants reflètent le style (transition « Balayage rapide » = whip-pan).
  await expect(page.locator('[data-transition="whip-pan"]')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(SORTIE, `galerie-${info.project.name}-choisi.png`) });

  // Détail derrière l'icône d'information.
  await page.getByRole('button', { name: 'Détail du style Sport dynamique' }).click();
  await expect(page.getByText(/Rythme nerveux/)).toBeVisible();
  await page.screenshot({ path: path.join(SORTIE, `galerie-${info.project.name}-detail.png`) });
  await page.keyboard.press('Escape');

  // Retouche manuelle : respectée et signalée.
  await page.getByRole('button', { name: /^Transition/ }).first().click();
  await page.locator('[data-transition="iris"]').click();
  await galerie.scrollIntoViewIfNeeded();
  await expect(galerie.locator('[data-style-retouche]')).toContainText('Transition');
  await expect(sport).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(SORTIE, `galerie-${info.project.name}-retouche.png`) });
});
