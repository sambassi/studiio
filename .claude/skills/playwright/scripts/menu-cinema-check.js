#!/usr/bin/env node
/**
 * MENU — Cinema IA juste sous « Creer », sur ordinateur et sur mobile.
 *
 * Local uniquement (DEV_AUTH_BYPASS, CINEMA_ACTIVE). Sort en code non nul au premier ecart.
 * Usage : MENU_CHECK_BASE_URL=http://localhost:3101 node .claude/skills/playwright/scripts/menu-cinema-check.js
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.MENU_CHECK_BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = process.env.MENU_CHECK_SCREENSHOT_DIR || '/tmp/menu-cinema';
const ATTENDU = ['/dashboard', '/dashboard/creer', '/dashboard/cinema', '/dashboard/avatar'];

(async () => {
  const navigateur = await chromium.launch();
  const resultats = [];
  for (const vp of [{ nom: 'desktop-1440x900', width: 1440, height: 900, mobile: false }, { nom: 'mobile-390x844', width: 390, height: 844, mobile: true }]) {
    const page = await navigateur.newPage({ viewport: { width: vp.width, height: vp.height } });
    const erreurs = [];
    await page.goto(`${BASE_URL}/dashboard/cinema`, { waitUntil: 'networkidle' });
    // Le tiroir mobile existe toujours, decale hors ecran : « visible » ne suffit pas, il
    // faut qu'il soit REELLEMENT ouvert (translate-x-0), sinon le controle ne prouve rien.
    let barre;
    if (vp.mobile) {
      const tiroir = page.locator('aside.lg\\:hidden');
      for (let i = 0; i < 10; i++) {
        if ((await tiroir.getAttribute('class')).includes('translate-x-0')) break;
        await page.locator('button[title="Menu"]').click(); // re-clic si l'hydratation n'etait pas finie
        await page.waitForTimeout(400);
      }
      if (!(await tiroir.getAttribute('class')).includes('translate-x-0')) erreurs.push('tiroir mobile jamais ouvert');
      barre = tiroir.locator('nav');
    } else {
      barre = page.locator('aside.lg\\:flex nav');
    }
    await barre.locator('a[href="/dashboard/cinema"]').waitFor({ timeout: 15000 });
    const ordre = await barre.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    if (JSON.stringify(ordre.slice(0, 4)) !== JSON.stringify(ATTENDU)) erreurs.push(`ordre ${JSON.stringify(ordre.slice(0, 4))}`);
    if (ordre.filter((h) => h === '/dashboard/cinema').length !== 1) erreurs.push('Cinema IA en double');
    const actif = await barre.locator('a[href="/dashboard/cinema"]').getAttribute('aria-current');
    if (actif !== 'page') erreurs.push('Cinema IA non marque actif sur sa propre page');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${vp.nom}.png`) });
    resultats.push({ viewport: vp.nom, erreur: erreurs.length ? erreurs.join(' ; ') : null });
    console.log(`${erreurs.length ? 'KO' : 'OK'}    ${vp.nom}`);
    if (erreurs.length) process.exitCode = 1;
    await page.close();
  }
  await navigateur.close();
  console.log(JSON.stringify(resultats, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
