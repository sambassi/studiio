/**
 * Mon avatar — voix et dictionnaire de prononciation.
 *
 * « Suggérer » atteint le VRAI handler local (`/api/voice/prononciations/suggestion`) :
 * l'env du banc n'a pas d'ANTHROPIC_API_KEY, donc le serveur ne sort jamais
 * (repli « locale » documenté dans la route) — le comportement observé est
 * celui d'une panne/absence du modèle.
 */
import type { Page } from 'playwright/test';
import { test, expect, attenduAvantCorrection } from './fixtures';

async function ouvrirVoix(page: Page): Promise<void> {
  await page.goto('/dashboard/avatar');
  const onglet = page.getByRole('tab', { name: /Voix & Prononciation/ }).or(page.getByRole('button', { name: /Voix & Prononciation/ })).first();
  await expect(onglet).toBeVisible({ timeout: 30_000 });
  await onglet.click();
  await expect(page.locator('[data-voix-panel]')).toBeVisible({ timeout: 20_000 });
}

test.describe('Mon avatar — voix et prononciation', () => {
  test('page avatar et panneau voix : captures', async ({ page, banc }) => {
    await page.goto('/dashboard/avatar');
    await page.waitForTimeout(2500);
    await banc.capture(page, 'avatar-1-page', { fullPage: true });
    await ouvrirVoix(page);
    await banc.capture(page, 'avatar-2-voix', { fullPage: true });
  });

  for (const mode of ['vrai-handler', 'modele-simule'] as const) test(`« Suggérer » sur « lien en bio » (${mode}) : jamais une quasi-copie du texte`, async ({ page, banc }) => {
    if (mode === 'vrai-handler') {
      // Handler local réel, sans clé Anthropic : règle locale seule → « Aucune suggestion ».
      banc.passerAuServeur('POST /api/voice/prononciations/suggestion');
    } else {
      // Ce que renvoie la route quand le MODÈLE répond « lien en bioo » : le garde-fou
      // serveur et client (`suggestionUtile`) ne refuse que l'égalité stricte.
      attenduAvantCorrection('« lien en bioo » accepté comme suggestion (garde-fou à égalité stricte seulement, synthèse A)');
      banc.surcharger('POST /api/voice/prononciations/suggestion', () => ({ json: { success: true, data: { suggestion: 'lien en bioo', source: 'ia' } } }));
    }
    const reponses: string[] = [];
    page.on('response', async (r) => {
      if (r.url().includes('/api/voice/prononciations/suggestion')) reponses.push(`${r.status()} ${await r.text().catch(() => '')}`);
    });
    await ouvrirVoix(page);
    await page.locator('[data-prononciation-ajouter]').click();
    await page.locator('[data-prononciation-affiche]').fill('lien en bio');
    await page.locator('[data-prononciation-suggerer]').click();
    await expect(page.locator('[data-prononciation-note]')).toBeVisible({ timeout: 20_000 });
    const formulaire = page.locator('[data-prononciation-formulaire]');
    await banc.capture(page, `avatar-3-suggerer-lien-en-bio-${mode}`, { locator: formulaire });
    const proposee = await page.locator('[data-prononciation-prononce]').inputValue();
    const note = await page.locator('[data-prononciation-note]').innerText();
    test.info().annotations.push({ type: 'suggestion', description: `prononcé=« ${proposee} » note=« ${note} » serveur=${reponses.join(' ; ') || 'non appelé (règle locale seule)'}` });
    // Cible : soit rien (« Aucune suggestion… »), soit une forme VRAIMENT différente.
    const proche = (a: string, b: string) => {
      const x = a.toLowerCase().replace(/[^a-z]/g, ''); const y = b.toLowerCase().replace(/[^a-z]/g, '');
      const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
      for (let j = 1; j <= y.length; j++) d[0][j] = j;
      for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      return d[x.length][y.length] / Math.max(1, Math.max(x.length, y.length)) < 0.25;
    };
    if (proposee.trim()) expect(proche('lien en bio', proposee), `« ${proposee} » est une quasi-copie`).toBe(false);
    else expect(note).toMatch(/Aucune suggestion/i);
  });

  test('dictionnaire : Modifier, Écouter, Enregistrer, Annuler ; sélection et écoute de voix', async ({ page, banc }) => {
    const ecoutes: string[] = [];
    page.on('request', (r) => { if (/\/api\/voice\/(prononciations\/)?ecoute/.test(r.url())) ecoutes.push(`${r.url().replace(/^.*\/api/, '/api')} ${r.postData() ?? ''}`); });
    await ouvrirVoix(page);
    // Ajouter une paire, l'écouter AVANT d'enregistrer, enregistrer.
    await page.locator('[data-prononciation-ajouter]').click();
    await page.locator('[data-prononciation-affiche]').fill('lien en bio');
    await page.locator('[data-prononciation-prononce]').fill('lien dans la bio');
    await page.locator('[data-prononciation-brouillon-ecouter]').click();
    await expect.poll(() => ecoutes.length).toBeGreaterThan(0);
    await banc.capture(page, 'avatar-4-brouillon-ecoute', { locator: page.locator('[data-prononciation-formulaire]') });
    await page.locator('[data-prononciation-valider]').click();
    await expect(page.locator('[data-prononciation="lien en bio"]')).toBeVisible();
    expect(banc.etat.prononciations).toEqual([{ affiche: 'lien en bio', prononce: 'lien dans la bio' }]);
    await banc.capture(page, 'avatar-5-enregistre', { fullPage: true });
    // Modifier → nouvelle forme → Enregistrer.
    await page.locator('[data-prononciation-modifier="lien en bio"]').click();
    await page.locator('[data-prononciation-prononce]').fill('lien dans ma bio');
    await page.locator('[data-prononciation-valider]').click();
    await expect.poll(() => banc.etat.prononciations[0]?.prononce).toBe('lien dans ma bio');
    // Écouter la ligne enregistrée.
    await page.locator('[data-prononciation-ecouter="lien en bio"]').click();
    await expect.poll(() => ecoutes.length).toBeGreaterThan(1);
    // Ajouter puis Annuler : rien n'est enregistré.
    await page.locator('[data-prononciation-ajouter]').click();
    await page.locator('[data-prononciation-affiche]').fill('3-en-1');
    await page.locator('[data-prononciation-annuler]').click();
    await expect(page.locator('[data-prononciation-formulaire]')).toHaveCount(0);
    expect(banc.etat.prononciations.length).toBe(1);
    // Sélection d'une autre voix, puis écoute de l'aperçu.
    const selecteur = page.locator('[data-voix-selecteur]');
    if (await selecteur.isVisible().catch(() => false)) await selecteur.selectOption('uv-2');
    await page.locator('[data-ecouter]').click();
    await expect(page.locator('[data-voix-panel] audio').first()).toBeAttached({ timeout: 10_000 });
    await banc.capture(page, 'avatar-6-ecoute-voix', { fullPage: true });
    test.info().annotations.push({ type: 'ecoutes', description: ecoutes.join(' | ') });
  });
});
