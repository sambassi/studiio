#!/usr/bin/env node
/**
 * Skill Playwright — Scraping headless avec Chromium
 * Usage : node run.js <URL>
 * Retourne un JSON { title, text, links }
 */

const { chromium } = require('playwright');

const url = process.argv[2];

if (!url) {
  console.error(JSON.stringify({ error: 'Usage : node run.js <URL>' }));
  process.exit(1);
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Retirer nav, footer, bannières cookies et éléments non pertinents
    await page.evaluate(() => {
      const selectors = [
        'nav', 'footer', 'header',
        '[class*="cookie"]', '[id*="cookie"]',
        '[class*="banner"]', '[id*="banner"]',
        '[class*="popup"]', '[id*="popup"]',
        '[class*="modal"]', '[id*="modal"]',
        '[class*="consent"]', '[id*="consent"]',
        '[role="banner"]', '[role="navigation"]',
        '[role="contentinfo"]',
      ];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      });
    });

    // Extraire titre, texte et liens
    const data = await page.evaluate(() => {
      const title = document.title || '';

      // Texte principal du body
      const body = document.querySelector('main') || document.querySelector('article') || document.body;
      const text = body ? body.innerText.trim() : '';

      // Liens
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => ({
          text: a.innerText.trim(),
          href: a.href,
        }))
        .filter((l) => l.text && l.href);

      return { title, text, links };
    });

    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
