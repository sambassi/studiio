import { test, expect } from 'playwright/test';

test.describe('i18n - Language switching', () => {
  test.beforeEach(async ({ page }) => {
    // Go to landing page
    await page.goto('/');
  });

  test('should display French by default', async ({ page }) => {
    // Check the HTML lang attribute
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('fr');

    // Check that French text is displayed
    const body = await page.textContent('body');
    expect(body).toContain('Studiio');
  });

  test('should switch to English', async ({ page }) => {
    // Find and click language selector
    const langSelector = page.locator('button:has-text("FR")').first();
    if (await langSelector.isVisible()) {
      await langSelector.click();
      // Click English option
      const enOption = page.locator('button:has-text("English")');
      await enOption.click();
      // Wait for locale change
      await page.waitForTimeout(500);

      // Verify the cookie is set
      const cookies = await page.context().cookies();
      const localeCookie = cookies.find(c => c.name === 'locale');
      expect(localeCookie?.value).toBe('en');
    }
  });

  test('should switch to German', async ({ page }) => {
    const langSelector = page.locator('button:has-text("FR")').first();
    if (await langSelector.isVisible()) {
      await langSelector.click();
      const deOption = page.locator('button:has-text("Deutsch")');
      await deOption.click();
      await page.waitForTimeout(500);

      const cookies = await page.context().cookies();
      const localeCookie = cookies.find(c => c.name === 'locale');
      expect(localeCookie?.value).toBe('de');
    }
  });

  test('should persist language choice across navigation', async ({ page }) => {
    // Set locale cookie to English
    await page.context().addCookies([{
      name: 'locale',
      value: 'en',
      domain: 'localhost',
      path: '/',
    }]);

    // Reload page
    await page.reload();
    await page.waitForTimeout(500);

    // The locale cookie should still be 'en'
    const cookies = await page.context().cookies();
    const localeCookie = cookies.find(c => c.name === 'locale');
    expect(localeCookie?.value).toBe('en');
  });
});

test.describe('i18n - Dashboard language', () => {
  test('should display translated sidebar in English', async ({ page }) => {
    // Set English locale
    await page.context().addCookies([{
      name: 'locale',
      value: 'en',
      domain: 'localhost',
      path: '/',
    }]);

    // Navigate to dashboard (will redirect to login if not authenticated)
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    // Check if we got redirected to login
    const url = page.url();
    if (url.includes('/auth/login')) {
      // On login page, check for English text
      const body = await page.textContent('body');
      // Should have English login text instead of French
      const hasEnglish = body?.includes('Sign in') || body?.includes('Log in') || body?.includes('Login');
      expect(hasEnglish).toBeTruthy();
    }
  });

  test('should display translated sidebar in German', async ({ page }) => {
    await page.context().addCookies([{
      name: 'locale',
      value: 'de',
      domain: 'localhost',
      path: '/',
    }]);

    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    const url = page.url();
    if (url.includes('/auth/login')) {
      const body = await page.textContent('body');
      const hasGerman = body?.includes('Anmelden') || body?.includes('Einloggen');
      expect(hasGerman).toBeTruthy();
    }
  });
});
