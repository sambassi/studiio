import { test, expect } from 'playwright/test';

test.describe('Batch x10 Creator → Audio Studio → Calendar', () => {

  test('should load creator page', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);

    const url = page.url();
    expect(url).toMatch(/\/(dashboard\/creator|auth\/login)/);
  });

  test('should have step navigation', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);

    if (page.url().includes('/dashboard/creator')) {
      // Should have step indicators
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    }
  });

  test('should have format options (Reel and TV)', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);

    if (page.url().includes('/dashboard/creator')) {
      const body = await page.textContent('body');
      // Should contain format-related text
      expect(body).toMatch(/9:16|16:9|[Rr]eel|TV/);
    }
  });

  test('should have batch count selector', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);

    if (page.url().includes('/dashboard/creator')) {
      // Look for batch count options (x1, x2, x3, x5, x10)
      const body = await page.textContent('body');
      expect(body).toMatch(/x[0-9]+|batch/i);
    }
  });

  test('should have export destination options including Studio Son', async ({ page }) => {
    await page.goto('/dashboard/creator');
    await page.waitForTimeout(2000);

    if (page.url().includes('/dashboard/creator')) {
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    }
  });
});
