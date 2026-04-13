#!/usr/bin/env node
/**
 * Skill Playwright — Scraping headless avec Chromium
 * Usage : node run.js <URL>
 * Retourne un JSON { title, text, links }
 *
 * Résilience : si Playwright ne trouve pas le binaire Chromium correspondant
 * à sa version (cas typique d'un sandbox où `npx playwright install` est
 * bloqué par un proxy), on tombe sur un binaire Chromium déjà présent
 * dans un cache standard.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const url = process.argv[2];

if (!url) {
  console.error(JSON.stringify({ error: 'Usage : node run.js <URL>' }));
  process.exit(1);
}

/** Cherche un binaire Chromium déjà installé dans les caches usuels. */
function findCachedChromium() {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const bases = [
    '/opt/pw-browsers',                                    // sandbox Claude / CI
    process.env.HOME && path.join(process.env.HOME, '.cache', 'ms-playwright'), // Linux user cache
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright'), // macOS
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'), // Windows
  ].filter(Boolean);

  const candidates = [
    'chrome-linux/headless_shell',
    'chrome-linux/chrome',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-win/chrome.exe',
  ];

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    let dirs;
    try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium')); } catch { continue; }
    for (const d of dirs) {
      for (const rel of candidates) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

(async () => {
  let browser;
  try {
    const launchOpts = { headless: true };

    // Premier essai : laisser Playwright trouver son propre binaire.
    try {
      browser = await chromium.launch(launchOpts);
    } catch (launchErr) {
      const msg = String(launchErr && launchErr.message || launchErr);
      if (!/Executable doesn't exist|not found/i.test(msg)) throw launchErr;

      // Fallback : pointer vers un binaire Chromium caché déjà présent.
      const exe = findCachedChromium();
      if (!exe) throw launchErr;
      launchOpts.executablePath = exe;
      browser = await chromium.launch(launchOpts);
    }

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
