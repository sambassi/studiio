import { test, expect } from 'playwright/test';
import { debordeHorizontalement, installerGardePaiement } from './garde-paiement';

/**
 * LA FRONTIÈRE ADMINISTRATEUR — ce qu'un compte ordinaire ne doit pas voir.
 *
 * Le serveur de test tourne avec le contournement d'authentification de
 * développement, qui sert une identité NON administratrice. C'est exactement
 * le cas à vérifier : les écrans de tarification, de rentabilité et de coûts
 * fournisseurs sont réservés à l'administration, et le masquage côté écran ne
 * suffirait pas.
 *
 * L'écran d'administration lui-même est couvert par les tests de composant
 * (`src/__tests__/tarifs-admin-page.test.tsx`), qui rendent la vraie page.
 */
test.beforeEach(async ({ page }) => {
  await installerGardePaiement(page);
});

const ECRANS_ADMIN = ['/admin/tarifs', '/admin/pricing', '/admin/fournisseurs'];

for (const chemin of ECRANS_ADMIN) {
  test(`${chemin} n’est pas servi à un compte non administrateur`, async ({ page }) => {
    const bloques: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/admin/')) bloques.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(chemin);
    await page.waitForLoadState('domcontentloaded');

    // Soit on est renvoyé ailleurs, soit l'écran n'affiche aucune donnée de
    // tarification. Dans les deux cas, rien de commercial ne doit être lisible.
    const texte = (await page.textContent('body')) ?? '';
    expect(texte).not.toContain('Valeur du crédit');
    expect(texte).not.toContain('Marge visée');
    expect(texte).not.toMatch(/Vendu à perte/);

    // Et si une route admin a été appelée, elle a refusé.
    for (const appel of bloques) expect(appel).toMatch(/^(401|403|404) /);
  });
}

test('aucun nom de fournisseur dans la page publique, et pas de débordement horizontal', async ({ page }, info) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const texte = ((await page.textContent('body')) ?? '').toLowerCase();
  for (const marque of ['heygen', 'replicate', 'elevenlabs', 'anthropic', 'openai', 'higgsfield']) {
    expect(texte, marque).not.toContain(marque);
  }

  expect(await debordeHorizontalement(page), `débordement horizontal en ${info.project.name}`).toBe(false);
});
