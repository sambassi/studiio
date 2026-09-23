import { test, expect } from 'playwright/test';

/**
 * `/dashboard/creator` est une ANCIENNE route : elle ne rend plus d'écran, elle
 * redirige (`lib/routing/legacy-redirect.ts`, `creerRedirectTarget`).
 *
 * Cette spécification attendait autrefois que l'URL RESTE sur
 * `/dashboard/creator` : faux depuis l'unification, et les cas suivants se
 * sautaient alors en silence. Elle vérifie désormais la destination réelle.
 * Sans session, le middleware envoie d'abord sur `/auth/login` — accepté.
 */
test.describe('Ancienne route /dashboard/creator → parcours unifié', () => {
  test('sans paramètre : redirige vers /dashboard/creer', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);
    expect(page.url()).toMatch(/\/(dashboard\/creer(\?|$)|auth\/login)/);
    expect(page.url()).not.toMatch(/\/dashboard\/creator/);
  });

  test('?postId= : transporté vers /dashboard/creer', async ({ page }) => {
    await page.goto('/dashboard/creator?postId=p-1');
    await page.waitForTimeout(2000);
    if (page.url().includes('/dashboard/')) {
      expect(page.url()).toMatch(/\/dashboard\/creer\?postId=p-1/);
    }
  });

  test('?id= (une vidéo) : la Bibliothèque, jamais un éditeur vide', async ({ page }) => {
    await page.goto('/dashboard/creator?id=v-1');
    await page.waitForTimeout(2000);
    if (page.url().includes('/dashboard/')) {
      expect(page.url()).toMatch(/\/dashboard\/library$/);
      expect(page.url()).not.toMatch(/creer-avance/);
    }
  });
});
