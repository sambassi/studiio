#!/usr/bin/env node
/**
 * CINEMA IA — style du film, exception de scene, camera : ecran reel, bureau et mobile.
 * Local uniquement (DEV_AUTH_BYPASS=1, generation simulee). Aucun appel IA payant.
 * Usage : DIR_CHECK_BASE_URL=http://localhost:3103 node .claude/skills/playwright/scripts/cinema-direction-check.js
 */
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.DIR_CHECK_BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.DIR_CHECK_SCREENSHOT_DIR || '/tmp/cinema-direction';

(async () => {
  const nav = await chromium.launch();
  let ko = 0;
  for (const vp of [{ nom: 'desktop', width: 1440, height: 900 }, { nom: 'mobile', width: 390, height: 844 }]) {
    const page = await nav.newPage({ viewport: { width: vp.width, height: vp.height } });
    const erreurs = [];
    const posts = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/cinema/')) posts.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${BASE}/dashboard/cinema`, { waitUntil: 'networkidle' });
    const radios = page.getByRole('radio');
    await radios.first().waitFor({ timeout: 20000 });
    if ((await radios.count()) !== 6) erreurs.push('pas six styles');
    const imgs = await page.locator('[data-direction="style-film"] img').evaluateAll((l) => l.map((i) => i.complete && i.naturalWidth > 0));
    if (imgs.length !== 6 || imgs.some((x) => !x)) erreurs.push('miniatures non chargees');
    // Aucun debordement horizontal de la page.
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) erreurs.push('debordement horizontal');
    await page.getByRole('radio', { name: /Film noir/ }).click();
    if ((await page.getByRole('radio', { name: /Film noir/ }).getAttribute('aria-checked')) !== 'true') erreurs.push('style non selectionne');
    await page.locator('[data-direction="style-film"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `${vp.nom}-style.png`) });
    // Composer le scenario (generation simulee), puis regler exception et camera.
    await page.locator('textarea').first().fill('Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Nina dit : « je ne reculerai pas ». Le jour se leve sur la salle vide.');
    await page.getByRole('button', { name: /Composer/ }).first().click();
    await page.locator('[data-direction="resume"]').waitFor({ timeout: 30000 });
    if (!(await page.locator('[data-direction="resume"]').textContent()).includes('Film noir')) erreurs.push('style non transmis a la creation du film');
    const scene = page.locator('select[aria-label="Style de cette scene"]').first();
    await scene.selectOption('romantique');
    await page.waitForTimeout(800);
    const cam = page.locator('select[aria-label="Mouvement de camera de ce plan"]').first();
    await cam.selectOption('orbite');
    await page.waitForTimeout(800);
    await page.locator('[data-direction="resume"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `${vp.nom}-scenes.png`) });
    // Reouverture : le choix est relu depuis le serveur.
    await page.reload({ waitUntil: 'networkidle' });
    const ouvert = page.locator('select[aria-label="Style de cette scene"]');
    if ((await ouvert.count()) > 0 && (await ouvert.first().inputValue()) !== 'romantique') erreurs.push('exception non relue');
    if (posts.some((p) => /generation|produire/.test(p))) erreurs.push(`generation declenchee : ${posts.join(', ')}`);
    console.log(`${erreurs.length ? 'KO' : 'OK'}  ${vp.nom}  ${erreurs.join(' ; ')}  [${posts.join(' | ')}]`);
    if (erreurs.length) ko = 1;
    await page.close();
  }
  await nav.close();
  process.exitCode = ko;
})();
