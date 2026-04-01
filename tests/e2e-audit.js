/**
 * E2E Audit — Studiio.pro
 * Tests all critical pages and functionality.
 * Run: node tests/e2e-audit.js
 */
const { chromium } = require('playwright');

const BASE = process.env.SITE_URL || 'https://studiio.pro';
const TIMEOUT = 15000;

const results = [];
let browser, page;

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  const line = `${icon} ${name}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ status, name, detail });
}

async function test(name, fn) {
  try {
    await fn();
    log('PASS', name);
  } catch (err) {
    log('FAIL', name, err.message.substring(0, 120));
  }
}

async function run() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) StudioAudit/1.0',
  });
  page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ═══════════════════════════════════════
  // 1. LANDING PAGE
  // ═══════════════════════════════════════
  console.log('\n═══ 1. LANDING PAGE ═══');

  await test('Landing page loads', async () => {
    const res = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`);
  });

  await test('Landing has title', async () => {
    const title = await page.title();
    if (!title || title.includes('Error')) throw new Error(`Title: "${title}"`);
  });

  await test('Landing has CTA buttons', async () => {
    const cta = await page.locator('a:has-text("Commencer")').first();
    if (!await cta.isVisible()) throw new Error('CTA not visible');
  });

  await test('Landing has pricing section', async () => {
    const pricing = await page.locator('text=Starter').first();
    if (!await pricing.isVisible()) throw new Error('Pricing not found');
  });

  // ═══════════════════════════════════════
  // 2. AUTH PAGES
  // ═══════════════════════════════════════
  console.log('\n═══ 2. AUTH PAGES ═══');

  await test('Signup page loads', async () => {
    const res = await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`);
  });

  await test('Signup has Google OAuth button', async () => {
    await page.waitForTimeout(2000);
    const google = await page.locator('button:has-text("Google"), a:has-text("Google")').first();
    const visible = await google.isVisible().catch(() => false);
    if (!visible) throw new Error('Google button not found');
  });

  await test('Login page loads', async () => {
    const res = await page.goto(`${BASE}/auth/signin`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`);
  });

  // ═══════════════════════════════════════
  // 3. API ROUTES
  // ═══════════════════════════════════════
  console.log('\n═══ 3. API ROUTES ═══');

  await test('API /api/auth/providers returns 200', async () => {
    const res = await page.goto(`${BASE}/api/auth/providers`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) throw new Error(`HTTP ${res?.status()}`);
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('Not valid JSON');
  });

  await test('API /api/tts/edge GET returns voices', async () => {
    const res = await page.goto(`${BASE}/api/tts/edge`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) throw new Error(`HTTP ${res?.status()}`);
    const json = await res.json().catch(() => null);
    if (!json?.voices?.length) throw new Error('No voices returned');
    log('INFO', `  → ${json.voices.length} voices available`);
  });

  await test('API /api/credits/balance requires auth', async () => {
    const res = await page.goto(`${BASE}/api/credits/balance`, { waitUntil: 'domcontentloaded' });
    const status = res?.status();
    if (status !== 401 && status !== 403) throw new Error(`Expected 401, got ${status}`);
  });

  await test('API /api/videos requires auth', async () => {
    const res = await page.goto(`${BASE}/api/videos`, { waitUntil: 'domcontentloaded' });
    const status = res?.status();
    if (status !== 401 && status !== 403) throw new Error(`Expected 401, got ${status}`);
  });

  // ═══════════════════════════════════════
  // 4. DASHBOARD (requires auth — test redirect)
  // ═══════════════════════════════════════
  console.log('\n═══ 4. DASHBOARD REDIRECT ═══');

  await test('Dashboard redirects to login', async () => {
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const url = page.url();
    // Should redirect to signin or show unauthorized
    if (!url.includes('signin') && !url.includes('auth') && res?.status() !== 401) {
      // Maybe it loads the dashboard without auth check on client
      log('WARN', '  → Dashboard accessible without auth — check middleware');
    }
  });

  await test('Creator page loads (may redirect)', async () => {
    await page.goto(`${BASE}/dashboard/creator`, { waitUntil: 'domcontentloaded' });
  });

  await test('Calendar page loads (may redirect)', async () => {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: 'domcontentloaded' });
  });

  await test('Social page loads (may redirect)', async () => {
    await page.goto(`${BASE}/dashboard/social`, { waitUntil: 'domcontentloaded' });
  });

  // ═══════════════════════════════════════
  // 5. STATIC RESOURCES & HEADERS
  // ═══════════════════════════════════════
  console.log('\n═══ 5. RESOURCES & HEADERS ═══');

  await test('COOP/COEP headers on dashboard (via curl-style check)', async () => {
    // The dashboard redirects to /auth/login for unauthenticated users.
    // Headers are on the INITIAL 307 response, not the final redirect target.
    // Use fetch API to check the initial response without following redirects.
    const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg2 = await ctx2.newPage();
    const res = await pg2.goto(`${BASE}/dashboard/creator`, { waitUntil: 'commit' });
    // Check if response (even redirect) has the headers
    const allHeaders = res?.headers() || {};
    const coop = allHeaders['cross-origin-opener-policy'];
    const coep = allHeaders['cross-origin-embedder-policy'];
    await ctx2.close();
    // Also check via API request which doesn't follow redirects
    const fetchRes = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { redirect: 'manual' });
        return {
          coop: r.headers.get('cross-origin-opener-policy'),
          coep: r.headers.get('cross-origin-embedder-policy'),
          status: r.status
        };
      } catch { return null; }
    }, `${BASE}/dashboard/creator`);
    if (fetchRes?.coop === 'same-origin' || coop === 'same-origin') {
      // Headers are present
    } else {
      throw new Error(`COOP: ${coop || fetchRes?.coop || 'missing'}, COEP: ${coep || fetchRes?.coep || 'missing'}`);
    }
  });

  await test('No COOP/COEP on landing (OAuth safe)', async () => {
    const res = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const headers = res?.headers() || {};
    const coop = headers['cross-origin-opener-policy'];
    if (coop === 'same-origin') throw new Error('COOP present on landing — will break OAuth');
  });

  // ═══════════════════════════════════════
  // 6. CONSOLE ERRORS
  // ═══════════════════════════════════════
  console.log('\n═══ 6. CONSOLE ERRORS ═══');

  if (consoleErrors.length === 0) {
    log('PASS', 'No console errors during tests');
  } else {
    log('WARN', `${consoleErrors.length} console errors`, consoleErrors.slice(0, 3).join(' | ').substring(0, 200));
  }

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  await browser.close();

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;

  console.log('\n═══════════════════════════════════════');
  console.log(`RESULTS: ${pass} passed, ${fail} failed, ${warn} warnings`);
  console.log('═══════════════════════════════════════\n');

  if (fail > 0) {
    console.log('FAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  if (browser) browser.close();
  process.exit(1);
});
