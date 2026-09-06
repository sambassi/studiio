#!/usr/bin/env node
/**
 * Preuve RESPONSIVE de « Mon style » — bundle, Tailwind, Chromium, rapport.
 *
 *   node scripts/mon-style-proof/run.js
 *
 * Le panneau est monte dans un vrai navigateur, avec la vraie feuille Tailwind
 * du projet, a deux largeurs de telephone. Ce qui est mesure ne peut pas se
 * deduire du source : le debordement horizontal, la taille des cibles
 * tactiles, et le fait que le bouton d'enregistrement reste atteignable.
 */
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DIR = __dirname;
const RACINE = path.resolve(DIR, '../..');

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const chemin = (req.url || '/').split('?')[0];
    const nom = chemin === '/' ? '/page.html' : chemin;
    const fichier = path.join(DIR, path.basename(nom));
    fs.readFile(fichier, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(fichier)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** Les largeurs mesurees : iPhone 13/14 puis iPhone 14/15 Pro Max. */
const ECRANS = [
  { nom: 'mobile-375', width: 375, height: 812 },
  { nom: 'mobile-430', width: 430, height: 932 },
  { nom: 'desktop-1280', width: 1280, height: 900 },
];

(async () => {
  // ── La feuille Tailwind, generee depuis la config REELLE du projet ─────
  // Sans elle, le composant s'afficherait sans mise en page et la mesure de
  // debordement ne voudrait rien dire.
  fs.writeFileSync(path.join(DIR, 'entree.css'), '@tailwind base;@tailwind components;@tailwind utilities;\n');
  execFileSync('npx', [
    'tailwindcss', '-i', path.join(DIR, 'entree.css'),
    '-o', path.join(DIR, 'tailwind.css'), '--minify',
  ], { cwd: RACINE, stdio: 'pipe' });

  await esbuild.build({
    entryPoints: [path.join(DIR, 'harness.tsx')],
    bundle: true,
    outfile: path.join(DIR, 'bundle.js'),
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.join(RACINE, 'src') },
    logLevel: 'silent',
  });

  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const navigateur = await chromium.launch();
  const rapport = { ecrans: {}, erreurs: [] };

  try {
    for (const ecran of ECRANS) {
      const page = await navigateur.newPage({ viewport: { width: ecran.width, height: ecran.height } });
      page.on('pageerror', (e) => rapport.erreurs.push(`${ecran.nom}: ${e.message}`));
      await page.goto(url, { waitUntil: 'networkidle' });

      // Etat replie : le libelle et le bouton doivent etre la.
      const etatReplie = await page.locator('[data-mon-style-etat]').innerText();
      await page.locator('[data-mon-style-toggle]').click();
      await page.waitForSelector('[data-mon-style-enregistrer]');

      const mesures = await page.evaluate(() => {
        const doc = document.documentElement;
        const visible = (s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            largeur: Math.round(r.width), hauteur: Math.round(r.height),
            dansLeCadre: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
          };
        };
        const transitions = [...document.querySelectorAll('[data-mon-style-transition]')]
          .map((e) => e.getAttribute('data-mon-style-transition'));
        const looks = [...document.querySelectorAll('[data-mon-style-look]')]
          .map((e) => e.getAttribute('data-mon-style-look'));
        // Le plus petit bouton : une cible tactile trop petite est un defaut
        // d'accessibilite, pas un detail esthetique.
        const boutons = [...document.querySelectorAll('button')]
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width > 0);
        return {
          debordementHorizontal: doc.scrollWidth > doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          transitions,
          looks,
          enregistrer: visible('[data-mon-style-enregistrer]'),
          logo: visible('[data-mon-style-logo-choisir]'),
          hauteurBoutonMin: Math.round(Math.min(...boutons.map((r) => r.height))),
          largeurBoutonMin: Math.round(Math.min(...boutons.map((r) => r.width))),
          boutonsHorsCadre: boutons.filter(
            (r) => r.left < -0.5 || r.right > window.innerWidth + 0.5,
          ).length,
        };
      });

      // Le panneau se referme-t-il ?
      await page.locator('[data-mon-style-toggle]').click();
      const referme = (await page.locator('[data-mon-style-enregistrer]').count()) === 0;

      rapport.ecrans[ecran.nom] = { etatReplie, referme, ...mesures };
      await page.close();
    }
  } finally {
    await navigateur.close();
    server.close();
  }

  console.log(JSON.stringify(rapport, null, 2));
  const echecs = Object.entries(rapport.ecrans).filter(
    ([, m]) => m.debordementHorizontal || m.boutonsHorsCadre > 0 || !m.enregistrer?.dansLeCadre,
  );
  if (echecs.length > 0 || rapport.erreurs.length > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
