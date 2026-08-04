import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

/**
 * Ce dont le rendu serveur a besoin DANS L'IMAGE.
 *
 * ⚠️ LA COMPOSITION N'EST JAMAIS IMPORTÉE PAR LE CODE SERVEUR.
 *
 * Elle est **bundlée à la demande**, au runtime, par `@remotion/bundler`
 * depuis `process.cwd()/remotion/index.tsx`. Le traçage de Next, lui, ne
 * conserve dans `.next/standalone` que ce que le serveur importe — donc rien
 * de ce que touche la composition. Ni le dossier `remotion/`, ni les
 * composants partagés de `src/`, ni les paquets que seule la composition
 * importe.
 *
 * En production, cela donnait :
 *
 *     Remotion entry point not found: /app/remotion/index.tsx
 *
 * Et une fois ce dossier copié, la panne se serait déplacée d'un cran à
 * chaque import manquant : `@/components/ui/CardIcon`, puis `lucide-react`,
 * puis `@remotion/transitions`… Le tout invisible en développement, où l'on
 * rend au CLI depuis le dépôt complet.
 *
 * D'où ce test : il relit les imports EXTERNES du graphe de la composition et
 * exige que chacun soit nommé dans le `Dockerfile`. Une dépendance ajoutée
 * dans une phase suivante échoue ici, au lieu d'échouer en production.
 */

const racine = resolve(__dirname, '../..');
const dockerfile = readFileSync(join(racine, 'Dockerfile'), 'utf-8');
const worker = readFileSync(join(racine, 'src/lib/render/worker.ts'), 'utf-8');
const config = readFileSync(join(racine, 'remotion.config.ts'), 'utf-8');

/**
 * Paquets que le traçage de Next embarque de façon fiable, parce que du code
 * SERVEUR les importe vraiment.
 *
 * `react` et `remotion` en font partie : le worker importe `@remotion/renderer`,
 * qui en dépend. Tout le reste doit être copié explicitement.
 */
const TRACES_FIABLES = new Set(['react', 'react-dom', 'remotion']);

/**
 * Résout un import vers un fichier du dépôt, ou `null` s'il est externe.
 *
 * Le graphe se parcourt vraiment : balayer des dossiers entiers ferait entrer
 * des fichiers que la composition n'importe pas (et leurs dépendances, comme
 * `next` ou `next-auth`), et le test réclamerait des copies inutiles.
 */
function resoudre(spec: string, depuis: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(racine, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(depuis), spec);
  else return null;
  for (const suffixe of ['.tsx', '.ts', '/index.tsx', '/index.ts', '']) {
    const candidat = `${base}${suffixe}`;
    if (existsSync(candidat) && /\.tsx?$/.test(candidat)) return candidat;
  }
  return null;
}

/**
 * Paquets externes du graphe, depuis le point d'entrée.
 *
 * C'est exactement ce que webpack devra résoudre dans `node_modules` au
 * moment du bundling — donc exactement ce qui doit exister dans l'image.
 */
function paquetsExternes(): Set<string> {
  const externes = new Set<string>();
  const vus = new Set<string>();
  const file = [join(racine, 'remotion/index.tsx')];
  while (file.length) {
    const fichier = file.pop()!;
    if (vus.has(fichier) || !existsSync(fichier)) continue;
    vus.add(fichier);
    const src = readFileSync(fichier, 'utf-8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      const interne = resoudre(spec, fichier);
      if (interne) { file.push(interne); continue; }
      if (spec.startsWith('.') || spec.startsWith('@/')) continue;
      const parts = spec.split('/');
      externes.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
    }
  }
  return externes;
}

describe('Le point d entrée et son graphe sont dans l image', () => {
  it('le dossier `remotion/` est copié', () => {
    // C'est le symptôme qui a été observé en production.
    expect(dockerfile).toContain('/app/remotion ./remotion');
  });

  it('le worker le cherche bien là', () => {
    expect(worker).toContain("path.resolve(process.cwd(), 'remotion/index.tsx')");
  });

  it('`src/` est copié EN ENTIER', () => {
    // Le traçage n'en garde qu'une poignée de fichiers : un `src/` à moitié
    // présent fait échouer le bundling sur un fichier différent à chaque
    // changement de code.
    expect(dockerfile).toContain('/app/src ./src');
  });

  it('la configuration et le tsconfig suivent', () => {
    expect(dockerfile).toContain('/app/remotion.config.ts ./remotion.config.ts');
    expect(dockerfile).toContain('/app/tsconfig.json ./tsconfig.json');
  });
});

describe('Chaque paquet du bundle est copié — ou tracé de façon fiable', () => {
  it('aucun import externe n est laissé de côté', () => {
    const manquants: string[] = [];
    for (const paquet of paquetsExternes()) {
      if (TRACES_FIABLES.has(paquet)) continue;
      // Le scope `@remotion` est copie en entier : tout paquet qui en fait
      // partie est donc couvert.
      if (paquet.startsWith('@remotion/')
        && dockerfile.includes('/app/node_modules/@remotion ')) continue;
      if (!dockerfile.includes(`/app/node_modules/${paquet} `)) manquants.push(paquet);
    }
    // Message explicite : celui qui ajoute une dépendance en phase suivante
    // doit savoir quoi faire, pas seulement que « ça casse ».
    expect(
      manquants,
      `Paquets importés par la composition mais absents du Dockerfile : ${manquants.join(', ')}. `
      + 'Ajouter un `COPY --from=builder /app/node_modules/<paquet> ./node_modules/<paquet>` '
      + 'dans le stage runner — le traçage de Next ne les voit pas.',
    ).toEqual([]);
  });

  it('les icônes des cartes sont copiées', () => {
    expect(dockerfile).toContain('/app/node_modules/lucide-react ');
  });

  it('le scope `@remotion` est copié EN ENTIER', () => {
    // Pas seulement les paquets importés : le traçage MUTILE ceux qu'il
    // garde. De `@remotion/compositor-*` il ne conserve que `index.js` et
    // `package.json`, et supprime les binaires natifs — le dossier existe,
    // la dépendance a l'air présente, et le rendu échoue sur
    // `ENOENT … /compositor-linux-x64-gnu/remotion`.
    expect(dockerfile).toContain('/app/node_modules/@remotion ./node_modules/@remotion');
  });

  it('les dépendances transitives de `iris` sont couvertes par le scope', () => {
    const iris = readFileSync(
      join(racine, 'node_modules/@remotion/transitions/dist/presentations/iris.js'),
      'utf-8',
    );
    expect(iris).toContain('@remotion/shapes');
    expect(iris).toContain('@remotion/paths');
  });
});

describe('L alias `@/` doit être donné DEUX fois', () => {
  it('`remotion.config.ts` n est lu que par le CLI', () => {
    // `@remotion/cli` le charge (`load-config.js`) ; `@remotion/bundler` ne le
    // regarde jamais. Un rendu au CLI marche donc, un rendu serveur non — et
    // l'écart ne se voit qu'en production.
    const cli = join(racine, 'node_modules/@remotion/cli/dist/load-config.js');
    expect(existsSync(cli)).toBe(true);
    const bundler = readFileSync(
      join(racine, 'node_modules/@remotion/bundler/dist/bundle.js'), 'utf-8',
    );
    expect(bundler).not.toContain('remotion.config');
  });

  it('le worker passe donc l override explicitement', () => {
    expect(worker).toContain('webpackOverride: remotionWebpackOverride');
  });

  it('et les deux chemins partagent la MÊME définition', () => {
    // L'écrire deux fois laisserait les deux moteurs diverger en silence.
    expect(config).toContain('remotionWebpackOverride');
    expect(worker).toContain("from '@/lib/render/webpackOverride'");
  });
});
