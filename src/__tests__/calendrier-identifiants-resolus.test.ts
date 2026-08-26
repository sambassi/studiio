import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tout composant employé dans le JSX doit être importé.
 *
 * ⚠️ `ignoreBuildErrors: true` REND CETTE FAMILLE D'ERREURS INVISIBLE.
 *
 * `next.config.js` ignore les erreurs TypeScript au build : un identifiant
 * non résolu passe donc la compilation sans un mot, et ne se manifeste qu'au
 * NAVIGATEUR, à l'exécution du code concerné. C'est ce qui est arrivé avec la
 * croix de fermeture de l'aperçu (#320) : `X` était utilisé sans être
 * importé, le build restait vert, et la page entière tombait
 * (`ReferenceError: X is not defined`) au premier clic sur l'œil.
 *
 * `tsc --noEmit` le signalait bien (`TS2304`), mais rien ne l'imposait. Ce
 * test le fait, sur les écrans les plus exposés — ceux qui rendent beaucoup
 * d'icônes conditionnellement, donc dont des branches entières ne sont jamais
 * parcourues avant la production.
 */

const FICHIERS = [
  '../app/dashboard/calendar/page.tsx',
  '../app/dashboard/creer/AssistantWizard.tsx',
  '../components/shared/MediaLibrary.tsx',
  '../components/creer/AutopilotPanel.tsx',
];

/**
 * Balises JSX en majuscule employées dans le fichier.
 *
 * ⚠️ LES GÉNÉRIQUES NE SONT PAS DU JSX. `useRef<HTMLDivElement>(null)` ou
 * `useState<Post>()` s'écrivent avec les mêmes chevrons ; les compter ferait
 * réclamer l'import de types qui n'ont rien à faire là. Un `<` de JSX n'est
 * jamais précédé d'un identifiant ni d'une parenthèse fermante — c'est ce qui
 * les sépare de façon fiable sans analyser la syntaxe.
 */
function composantsUtilises(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(^|[^A-Za-z0-9_)\]])<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
    out.add(m[2]);
  }
  return out;
}

/** Noms rendus disponibles par un import, un `const`, une `function`… */
function nomsDisponibles(src: string): Set<string> {
  const out = new Set<string>();
  // Imports : `import X from`, `import { A, B as C }`, `import * as N`.
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+'[^']+'/g)) {
    const clause = m[1];
    for (const n of clause.matchAll(/([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?/g)) {
      out.add(n[2] || n[1]);
    }
  }
  // Déclarations locales.
  for (const m of src.matchAll(/(?:const|let|function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    out.add(m[1]);
  }
  return out;
}

describe('Aucun composant employé sans être défini', () => {
  for (const rel of FICHIERS) {
    it(`${rel.split('/').pop()}`, () => {
      const src = readFileSync(resolve(__dirname, rel), 'utf-8');
      const dispo = nomsDisponibles(src);
      const manquants = [...composantsUtilises(src)].filter((c) => !dispo.has(c));
      expect(
        manquants,
        `Composants utilisés mais jamais importés ni définis : ${manquants.join(', ')}. `
        + '`ignoreBuildErrors` laisse passer ce cas au build — il tombe en `ReferenceError` '
        + 'dans le navigateur, et emporte la page entière.',
      ).toEqual([]);
    });
  }
});

describe('La croix de l aperçu — le cas qui a cassé la production', () => {
  const calendrier = readFileSync(
    resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8',
  );

  it('`X` est importé de lucide', () => {
    const bloc = calendrier.slice(0, calendrier.indexOf("} from 'lucide-react';"));
    expect(bloc).toMatch(/\n\s*X,/);
  });

  it('et l aperçu direct du montage serveur est toujours là', () => {
    // Le correctif ne doit pas avoir emporté ce que #320 apportait.
    expect(calendrier).toContain('const urlServeur = meta?.serverRendered');
    expect(calendrier).toContain('<X size={18} />');
  });
});
