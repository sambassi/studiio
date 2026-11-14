import type { Page, TestInfo } from 'playwright/test';

/**
 * LE GARDE : aucun paiement, aucune génération payante pendant les tests.
 *
 * Les routes d'encaissement et les appels payants sont ABORTÉS et consignés.
 * Un test qui en déclenche un échoue — c'est volontairement plus strict qu'un
 * simple « ne clique pas sur Payer » : une redirection, un préchargement ou
 * un effet de bord suffirait, sinon, à partir chez le prestataire.
 */
export const CHEMINS_INTERDITS = [
  '**/api/stripe/**',
  '**/api/credits/purchase**',
  '**/api/ai/image**',
  '**/api/avatar/generate**',
  '**/api/tts/**',
  '**/api/content/ai-generate**',
  '**/api/cinema/**/produire**',
  '**://api.stripe.com/**',
  '**://checkout.stripe.com/**',
  '**://api.pawapay.io/**',
  '**://api.sandbox.pawapay.io/**',
];

export async function installerGardePaiement(page: Page): Promise<string[]> {
  const bloques: string[] = [];
  for (const motif of CHEMINS_INTERDITS) {
    await page.route(motif, async (route) => {
      bloques.push(route.request().url());
      await route.abort();
    });
  }
  return bloques;
}

/** Vrai si la page a débordé horizontalement — la mise en page a cassé. */
export async function debordeHorizontalement(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth + 1;
  });
}

export function nomProfil(info: TestInfo): string {
  return info.project.name;
}
