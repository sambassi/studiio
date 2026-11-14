import { test, expect } from 'playwright/test';
import { installerGardePaiement } from './garde-paiement';

/**
 * AUCUN FOURNISSEUR VISIBLE PAR UN COMPTE ORDINAIRE.
 *
 * Le serveur de test sert une identité NON administratrice : c'est exactement
 * le compte qui ne doit rien apprendre. Deux surfaces sont vérifiées, et la
 * seconde est celle qu'un audit de code ne voit pas — les URL RÉELLEMENT
 * demandées par le navigateur, chemin compris.
 */
const MARQUES = [
  'heygen', 'replicate', 'elevenlabs', 'anthropic', 'openai', 'higgsfield',
  'pawapay', 'msedge', 'flux-schnell', 'black-forest-labs', 'wan-video',
];

/** Attribution d'une banque d'images : exigée par ses conditions, donc légitime. */
const ATTRIBUTIONS_AUTORISEES = ['pexels', 'unsplash'];

test.beforeEach(async ({ page }) => {
  await installerGardePaiement(page);
  await page.route('**/api/pricing**', (route) => route.fulfill({ json: { plans: [], packs: [] } }));
  await page.route('**/api/credits/balance**', (route) => route.fulfill({ json: { success: true, credits: 120 } }));
});

// ⚠️ `/dashboard/creer` est dans la liste parce qu'un appel y avait échappé
// au premier passage : la recherche de photos par lot, dont le `fetch(` et
// l'URL sont sur deux lignes. Une relecture de code ne l'avait pas vu ; la
// liste des URL réellement demandées, si.
for (const chemin of ['/', '/dashboard/billing', '/dashboard/creer']) {
  test(`${chemin} — aucune requête du navigateur ne nomme un prestataire`, async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));

    await page.goto(chemin);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => { /* page vivante */ });

    const fautives = urls.filter((u) => {
      const bas = u.toLowerCase();
      if (ATTRIBUTIONS_AUTORISEES.some((a) => bas.includes(a))) return false;
      return MARQUES.some((m) => bas.includes(m));
    });
    expect(fautives, `requêtes nommant un prestataire : ${fautives.join(', ')}`).toEqual([]);
  });

  test(`${chemin} — aucun nom de prestataire dans le texte de la page`, async ({ page }) => {
    await page.goto(chemin);
    await page.waitForLoadState('domcontentloaded');
    const texte = ((await page.textContent('body')) ?? '').toLowerCase();
    for (const m of MARQUES) expect(texte, m).not.toContain(m);
  });
}

test('les chemins neutres répondent, et les chemins historiques aussi', async ({ page }) => {
  // L'alias et la route historique doivent tous deux répondre : les anciens
  // appels ne sont pas cassés, seuls les nouveaux passent par le chemin neutre.
  // Sans clé de fournisseur sur ce serveur, les deux répondent une erreur
  // NEUTRE — c'est précisément ce qu'on veut vérifier.
  for (const chemin of ['/api/voix/premium', '/api/tts/elevenlabs']) {
    const res = await page.request.post(`http://localhost:3100${chemin}`, {
      data: { text: 'bonjour', voiceId: 'vp-abc' },
      failOnStatusCode: false,
    });
    const corps = (await res.text()).toLowerCase();
    expect(res.status(), chemin).toBeGreaterThanOrEqual(400);
    for (const m of MARQUES) expect(corps, `${chemin} / ${m}`).not.toContain(m);
  }
});
