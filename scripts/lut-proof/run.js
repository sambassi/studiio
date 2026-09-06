#!/usr/bin/env node
/**
 * Preuve de l'étalonnage du rush — bundle, lance Chromium, imprime le rapport.
 *
 *   node scripts/lut-proof/run.js
 *
 * Chromium est lancé avec un vrai pipeline GPU logiciel (SwiftShader). Les
 * chiffres obtenus sont donc un PLANCHER : une machine d'utilisateur, avec un
 * GPU réel, fait mieux. C'est le bon sens de l'erreur pour une preuve.
 */
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DIR = __dirname;

/**
 * Petit serveur statique. `file://` refuse les modules ES (CORS : « origin
 * null »), et le banc a besoin d'un vrai contexte http pour que MediaRecorder
 * et WebGL se comportent comme en production.
 */
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript' };
  const server = http.createServer((req, res) => {
    const name = (req.url || '/').split('?')[0] === '/' ? '/page.html' : req.url.split('?')[0];
    const file = path.join(DIR, path.basename(name));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  await esbuild.build({
    entryPoints: [path.join(DIR, 'harness.ts')],
    bundle: true,
    format: 'esm',
    target: 'chrome110',
    outfile: path.join(DIR, 'bundle.js'),
    logLevel: 'error',
  });

  const server = await serve();
  const port = server.address().port;

  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-gpu-sandbox',
    ],
  });
  const logs = [];

  /**
   * Une PAGE NEUVE par mesure. Deux `MediaRecorder` successifs dans la même
   * page ne produisent pas des fichiers comparables — le second sort tronqué,
   * parfois vide. Le témoin « sans filtre » et la mesure « avec filtre »
   * doivent partir du même état, sinon on mesure l'ordre d'exécution autant
   * que l'étalonnage.
   */
  const run = async (mode) => {
    const page = await browser.newPage();
    page.on('console', (m) => logs.push(`[${mode}][${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[${mode}][pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/page.html?mode=${mode}`);
    try {
      // La 2e position est l'ARGUMENT passé à la fonction, pas les options.
      await page.waitForFunction('window.__LUT_REPORT__ !== undefined', null, { timeout: 240000 });
      return await page.evaluate('window.__LUT_REPORT__');
    } catch (err) {
      // Un banc qui reste muet n'apprend rien : on remonte l'étape atteinte.
      const stage = await page.evaluate('window.__LUT_STAGE__').catch(() => null);
      return { error: String(err.message), stageAtteinte: stage };
    } finally {
      await page.close();
    }
  };

  const analyse = await run('analyse');
  const sansLut = await run('temps-reel-sans-lut');
  const avecLut = await run('temps-reel-avec-lut');
  const report = {
    ...analyse,
    tempsReelSansLut: sansLut.capture ?? sansLut,
    tempsReelAvecLut: avecLut.capture ?? avecLut,
  };

  await browser.close();
  server.close();
  console.log(JSON.stringify({ report, logs }, null, 2));
  process.exit(report && report.error ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
