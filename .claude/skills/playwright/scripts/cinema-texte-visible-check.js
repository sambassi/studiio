#!/usr/bin/env node
/**
 * CINEMA IA — aucun nom de fournisseur externe dans le texte REELLEMENT affiche.
 *
 * Attend l'affichage effectif (cartes d'exemple presentes), ouvre un exemple pour faire
 * apparaitre le scenario et l'apercu, puis lit `innerText`. Sort en code non nul si un nom
 * interdit apparait, ou si la page n'a pas reellement ete rendue.
 * Usage : CINEMA_CHECK_BASE_URL=http://localhost:3102 node .claude/skills/playwright/scripts/cinema-texte-visible-check.js
 */
const { chromium } = require('playwright');

const BASE_URL = process.env.CINEMA_CHECK_BASE_URL || 'http://localhost:3000';
const INTERDITS = /higgsfield|replicate|kling|happy\s?horse|seedance|soul\s?2|alibaba/i;

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE_URL}/dashboard/cinema`, { waitUntil: 'networkidle' });
  const cartes = page.locator('button[aria-label^="Utiliser l’exemple"]');
  await cartes.first().waitFor({ timeout: 20000 });
  await cartes.first().click();
  await page.waitForTimeout(500);
  const texte = await page.evaluate(() => document.body.innerText);
  const trouve = texte.match(INTERDITS);
  const resultat = {
    caracteresLus: texte.length,
    exemples: await cartes.count(),
    nomFournisseurVisible: trouve ? trouve[0] : null,
  };
  console.log(JSON.stringify(resultat, null, 2));
  if (trouve || texte.length < 500 || resultat.exemples !== 3) process.exitCode = 1;
  await navigateur.close();
})().catch((e) => { console.error(e); process.exit(1); });
