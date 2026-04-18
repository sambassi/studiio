#!/usr/bin/env node
/**
 * Verify the TikTok OAuth URL emitted by /api/social/connect.
 *
 * Expected scope and redirect URI must EXACTLY match the TikTok Developer
 * Portal config:
 *   scope        = user.info.basic,video.upload
 *   redirect_uri = https://studiio.pro/api/social/callback/tiktok
 *
 * Usage: node .claude/skills/playwright/scripts/test-tiktok-scope.js
 * Requires: dev server on :3000 with DEV_AUTH_BYPASS=1.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function findCachedChromium() {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const bases = [
    '/opt/pw-browsers',
    process.env.HOME && path.join(process.env.HOME, '.cache', 'ms-playwright'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  const candidates = [
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    let dirs; try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium')); } catch { continue; }
    for (const d of dirs) for (const rel of candidates) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (err) {
    const exe = findCachedChromium();
    if (!exe) throw err;
    return await chromium.launch({ headless: true, executablePath: exe });
  }
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const result = { steps: [] };

  try {
    // Step 1 — load the social dashboard so we're in browser context with cookies
    const resp = await page.goto(`${BASE}/dashboard/social`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.steps.push({ step: 'load-dashboard', status: resp?.status(), url: page.url() });

    // Step 2 — call /api/social/connect from the page (same-origin), capture authUrl
    const apiRes = await page.evaluate(async (base) => {
      const r = await fetch(base + '/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'tiktok' }),
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: r.status, json, text };
    }, BASE);

    result.steps.push({ step: 'api-call', status: apiRes.status, success: apiRes.json?.success, hasUrl: !!apiRes.json?.authUrl });

    const authUrl = apiRes.json?.authUrl || '';
    result.authUrl = authUrl;

    // Step 3 — parse the URL and inspect the scope param
    const parsed = new URL(authUrl);
    const scope = parsed.searchParams.get('scope') || '';
    result.parsedHost = parsed.host;
    result.parsedPath = parsed.pathname;
    result.scope = scope;

    const expectedScope = 'user.info.basic,video.upload';
    const expectedRedirectUri = 'https://studiio.pro/api/social/callback/tiktok';
    const scopeMatch = scope === expectedScope;
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    const redirectMatch = redirectUri === expectedRedirectUri;
    const hasClientKey = !!parsed.searchParams.get('client_key');
    const hasPublish = /video\.publish/.test(scope);

    result.expectedScope = expectedScope;
    result.expectedRedirectUri = expectedRedirectUri;
    result.redirectUri = redirectUri;
    result.checks = {
      scope_exact_user_info_basic_video_upload: scopeMatch,
      redirect_uri_exact_studiio_pro: redirectMatch,
      client_key_present: hasClientKey,
      no_video_publish: !hasPublish,
    };

    result.pass = scopeMatch && redirectMatch && hasClientKey && !hasPublish;
  } catch (err) {
    result.fatal = err.message;
    result.pass = false;
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
})();
