import { test, expect } from 'playwright/test';
import { debordeHorizontalement, installerGardePaiement } from './garde-paiement';

/**
 * LA RECHARGE DE CRÉDITS, VUE PAR L'UTILISATEUR.
 *
 * Les offres sont servies depuis une fixture : aucune base, aucun prestataire.
 * Le garde de paiement ABORTE toute requête d'encaissement, donc ces tests ne
 * peuvent pas déclencher de transaction même en cas d'erreur de scénario.
 */
const PRICING = {
  plans: [
    { key: 'free', name: 'Gratuit', price_cents: 0, yearly_price_cents: 0, credits: 10, features: ['10 crédits/mois'], popular: false, active: true, watermark: true },
    { key: 'starter', name: 'Starter', price_cents: 1900, yearly_price_cents: 1583, credits: 150, features: ['150 crédits/mois'], popular: false, active: true, watermark: false },
    { key: 'pro', name: 'Pro', price_cents: 4900, yearly_price_cents: 4083, credits: 600, features: ['600 crédits/mois'], popular: true, active: true, watermark: false },
  ],
  packs: [
    { key: 'small', name: '50 crédits', amount: 50, price_cents: 900, popular: false, active: true },
    { key: 'medium', name: '200 crédits', amount: 200, price_cents: 2900, popular: true, active: true },
  ],
};

test.beforeEach(async ({ page }) => {
  await installerGardePaiement(page);
  await page.route('**/api/pricing**', (route) => route.fulfill({ json: PRICING }));
  await page.route('**/api/credits/balance**', (route) => route.fulfill({ json: { success: true, credits: 120 } }));
  await page.route('**/api/billing/summary**', (route) => route.fulfill({
    json: { success: true, credits: 120, plan: 'pro', subscription: null, transactions: [] },
  }));
});

test('la page d’abonnement affiche les formules et les recharges, sans rien encaisser', async ({ page }, info) => {
  const partis: string[] = [];
  page.on('request', (r) => {
    if (/stripe|purchase|pawapay/i.test(r.url())) partis.push(r.url());
  });

  await page.goto('/dashboard/billing');
  await page.waitForLoadState('domcontentloaded');
  // L'écran est entièrement rendu côté navigateur : on attend un repère.
  await expect(page.locator('body')).toContainText(/crédit/i, { timeout: 20_000 });

  const texte = (await page.textContent('body')) ?? '';
  expect(texte).toMatch(/Pro/);

  // Rien n'est parti vers un encaissement : aucun clic de paiement, et le
  // garde aurait de toute façon aborté la requête.
  expect(partis, `requêtes de paiement parties : ${partis.join(', ')}`).toEqual([]);

  expect(await debordeHorizontalement(page), `débordement horizontal en ${info.project.name}`).toBe(false);
});

test('aucun nom de fournisseur n’est lisible sur la page d’abonnement', async ({ page }) => {
  await page.goto('/dashboard/billing');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toContainText(/crédit/i, { timeout: 20_000 });

  const texte = ((await page.textContent('body')) ?? '').toLowerCase();
  for (const marque of ['heygen', 'replicate', 'elevenlabs', 'anthropic', 'openai', 'higgsfield', 'pawapay']) {
    expect(texte, marque).not.toContain(marque);
  }
});
