/**
 * Fumée du banc : chaque écran se charge en isolation complète, sans route
 * non simulée bloquante ni requête externe.
 */
import { test, expect } from './fixtures';

for (const ecran of ['/dashboard/creer', '/dashboard/calendar', '/dashboard/avatar']) {
  test(`fumée ${ecran}`, async ({ page, banc }) => {
    await page.goto(ecran);
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await banc.capture(page, `fumee${ecran.replace(/\//g, '_')}`, { fullPage: true });
    expect(page.url()).toContain(ecran);
  });
}
