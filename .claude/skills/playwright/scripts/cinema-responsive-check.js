#!/usr/bin/env node
/**
 * CINEMA IA — verification responsive REELLE (vrai viewport Playwright, pas un
 * redimensionnement de fenetre d'extension). Local uniquement : DEV_AUTH_BYPASS,
 * generation simulee, aucun appel IA payant, aucune base de donnees reelle.
 *
 * Usage : node .claude/skills/playwright/scripts/cinema-responsive-check.js
 * Prerequis : `npm run dev` doit tourner sur http://localhost:3000, avec un
 * .env.local local contenant DEV_AUTH_BYPASS=1, CINEMA_ACTIVE=true,
 * CINEMA_GENERATION_SIMULEE=true et un AUTH_SECRET quelconque.
 *
 * Sort avec un code non nul et un message clair des qu'une verification echoue :
 * ce script est un test, pas un journal qui continue en silence.
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.CINEMA_CHECK_BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = process.env.CINEMA_CHECK_SCREENSHOT_DIR
  || '/private/tmp/claude-501/-Users-afroboost-studiio/e72f3a99-bc82-496b-a01c-0b1c05644cb1/scratchpad/cinema-responsive';

const VIEWPORTS = [
  { nom: 'desktop-1440x900', width: 1440, height: 900, categorie: 'desktop' },
  { nom: 'desktop-1024x768', width: 1024, height: 768, categorie: 'desktop' },
  { nom: 'tablette-768x1024', width: 768, height: 1024, categorie: 'tablette' },
  { nom: 'mobile-390x844', width: 390, height: 844, categorie: 'mobile' },
  { nom: 'mobile-360x800', width: 360, height: 800, categorie: 'mobile' },
];

function echec(message) {
  console.error(`ECHEC : ${message}`);
  process.exitCode = 1;
}

async function composerSiAbsent(page) {
  const bouton = page.getByRole('button', { name: /composer le scenario/i });
  const dejaDesScenes = await page.locator('text=/Scenes \\(\\d+\\)/').count();
  if (dejaDesScenes > 0) return;
  await bouton.click();
  // La composition est synchrone cote serveur (deterministe, locale) : attendre
  // l'apparition du carrousel de scenes plutot qu'un delai arbitraire.
  await page.locator('text=/Scenes \\(\\d+\\)/').first().waitFor({ timeout: 20_000 });
}

async function verifierViewport(browser, vp) {
  const resultats = { viewport: vp.nom, erreurs: [] };
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/dashboard/cinema`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.locator('h1:has-text("Cinema IA")').waitFor({ timeout: 15_000 });

    await composerSiAbsent(page);

    // --- Debordement horizontal ---
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (scrollWidth > clientWidth + 1) {
      resultats.erreurs.push(`debordement horizontal : scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
    }

    // --- Une seule instance de l'apercu ---
    const nbApercu = await page.locator('#cinema-apercu').count();
    if (nbApercu !== 1) resultats.erreurs.push(`#cinema-apercu trouve ${nbApercu} fois (attendu 1)`);
    const nbTitreApercu = await page.locator('text=/6\\. Apercu/').count();
    if (nbTitreApercu !== 1) resultats.erreurs.push(`titre « 6. Apercu » trouve ${nbTitreApercu} fois (attendu 1)`);

    // --- Navigation entre etapes : la saisie du titre doit survivre ---
    const champTitre = page.locator('input[placeholder="Titre du film"]');
    const titreAvant = await champTitre.inputValue();
    await page.getByRole('button', { name: /Aller a l.etape Personnages/i }).click();
    await page.waitForTimeout(400); // laisse le scroll/replis se stabiliser
    await page.getByRole('button', { name: /Aller a l.etape Histoire/i }).click();
    await page.waitForTimeout(400);
    const titreApres = await champTitre.inputValue();
    if (titreApres !== titreAvant) {
      resultats.erreurs.push(`la saisie du titre n'a pas survecu a la navigation (« ${titreAvant} » -> « ${titreApres} »)`);
    }

    // --- Accordeon exclusif : apres avoir clique Personnages, le panneau 1 doit etre referme ---
    await page.getByRole('button', { name: /Aller a l.etape Personnages/i }).click();
    await page.waitForTimeout(400);
    const panneau1Ouvert = await page.locator('#panneau-cinema-1-contenu').count();
    if (panneau1Ouvert !== 0) resultats.erreurs.push('le panneau Histoire reste ouvert apres avoir navigue vers Personnages (accordeon non exclusif)');
    const panneau2Ouvert = await page.locator('#panneau-cinema-2-contenu').count();
    if (panneau2Ouvert !== 1) resultats.erreurs.push('le panneau Personnages ne s\'est pas ouvert via le rail');

    // --- Desktop : l'apercu reste visible sans scroller toute la page ---
    // Remonter la fenetre d'abord : les verifications precedentes ont deja navigue
    // entre etapes (scrollIntoView), la position courante n'est plus le chargement initial.
    if (vp.categorie === 'desktop') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const apercuBox = await page.locator('#cinema-apercu').boundingBox();
      if (!apercuBox || apercuBox.y < 0 || apercuBox.y > vp.height) {
        resultats.erreurs.push(`l'apercu n'est pas dans la fenetre visible initiale (y=${apercuBox?.y})`);
      }
      // Simule un scroll de la colonne de gauche uniquement, l'apercu doit rester en place (sticky).
      const colonneGauche = page.locator('[class*="overflow-y-auto"]').first();
      await colonneGauche.evaluate((el) => { el.scrollTop = 300; });
      await page.waitForTimeout(200);
      const apercuBoxApres = await page.locator('#cinema-apercu').boundingBox();
      if (!apercuBoxApres || apercuBoxApres.y < 0 || apercuBoxApres.y > vp.height) {
        resultats.erreurs.push('l\'apercu sort du cadre visible apres defilement de la colonne de gauche (sticky casse)');
      }
    }

    // --- Mobile : l'apercu doit etre atteignable sans defilement interminable ---
    if (vp.categorie === 'mobile') {
      const apercuBox = await page.locator('#cinema-apercu').boundingBox();
      // La pile mobile place l'apercu en premier (order-1) : il doit etre visible dans les ~2 premiers ecrans.
      if (!apercuBox || apercuBox.y > vp.height * 2) {
        resultats.erreurs.push(`sur mobile, l'apercu est trop bas dans la page (y=${apercuBox?.y}, attendu < ${vp.height * 2})`);
      }
    }

    // --- Capture d'ecran ---
    const fichier = path.join(SCREENSHOT_DIR, `${vp.nom}.png`);
    await page.screenshot({ path: fichier, fullPage: true });
    resultats.capture = fichier;
  } catch (e) {
    resultats.erreurs.push(`exception : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await context.close();
  }
  return resultats;
}

async function main() {
  const fs = require('fs');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const tous = [];
  for (const vp of VIEWPORTS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await verifierViewport(browser, vp);
    tous.push(r);
  }
  await browser.close();

  for (const r of tous) {
    if (r.erreurs.length === 0) {
      console.log(`OK  ${r.viewport} — capture : ${r.capture}`);
    } else {
      echec(`${r.viewport} :\n  - ${r.erreurs.join('\n  - ')}`);
    }
  }

  console.log(JSON.stringify(tous, null, 2));
  if (tous.some((r) => r.erreurs.length > 0)) process.exit(1);
}

main().catch((e) => {
  console.error('Erreur fatale du script :', e);
  process.exit(1);
});
