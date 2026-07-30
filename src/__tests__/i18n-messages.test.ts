import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Intégrité des fichiers de traduction.
 *
 * Le défaut qui a motivé ces tests est SILENCIEUX : une clé définie deux fois
 * dans le même objet JSON est acceptée sans le moindre avertissement — ni par
 * `JSON.parse`, ni par TypeScript, ni par le build. La seconde définition
 * écrase la première, et les sous-clés qui n'existaient que dans la première
 * disparaissent. Rien ne le signale : ni erreur, ni log, ni test. On ne s'en
 * aperçoit qu'en voyant un libellé brut s'afficher à l'écran.
 *
 * `JSON.parse` ne peut donc PAS servir à détecter le problème — il a déjà
 * choisi le gagnant. Il faut relire le texte et compter les clés soi-même.
 */

const LOCALES = ['fr', 'en', 'de'] as const;

const read = (locale: string) =>
  readFileSync(resolve(__dirname, '../../messages', `${locale}.json`), 'utf-8');

/**
 * Chemins des clés définies plusieurs fois dans un même objet.
 *
 * Analyse caractère par caractère plutôt qu'avec une expression régulière :
 * une accolade ou des deux-points à l'intérieur d'une valeur — « Vidéo
 * {current}/{total} », « ex: fitness » — tromperaient tout motif naïf.
 */
function findDuplicateKeys(json: string): string[] {
  const dups: string[] = [];
  const path: string[] = [];
  const seen: Array<Set<string>> = [];
  let i = 0;
  let pendingKey: string | null = null;
  /** Vrai quand la prochaine chaîne lue sera une CLÉ, pas une valeur. */
  let expectKey = false;

  while (i < json.length) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      let str = '';
      while (j < json.length) {
        if (json[j] === '\\') {
          str += json[j + 1];
          j += 2;
          continue;
        }
        if (json[j] === '"') break;
        str += json[j];
        j++;
      }
      // Une chaîne est une clé si le prochain caractère utile est « : ».
      let k = j + 1;
      while (k < json.length && /\s/.test(json[k])) k++;
      if (json[k] === ':' && expectKey) {
        const set = seen[seen.length - 1];
        if (set) {
          if (set.has(str)) dups.push([...path, str].join('.'));
          set.add(str);
        }
        pendingKey = str;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') {
      seen.push(new Set());
      path.push(pendingKey ?? '(racine)');
      pendingKey = null;
      expectKey = true;
    } else if (c === '}') {
      seen.pop();
      path.pop();
    } else if (c === '[') {
      // Dans un tableau, les chaînes sont des valeurs, jamais des clés.
      expectKey = false;
    } else if (c === ']') {
      expectKey = true;
    } else if (c === ',') {
      expectKey = seen.length > 0;
    }
    i++;
  }
  return dups;
}

/** Tous les chemins de clés, à plat. */
function flatten(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.add(key);
    for (const nested of flatten(v, key)) out.add(nested);
  }
  return out;
}

describe('Aucune clé n’est définie deux fois', () => {
  it.each(LOCALES)('%s.json', (locale) => {
    // `infographic.posterPhoto` l'était en français : la seconde définition
    // écrasait la première, et l'interface affichait ses libellés sans que
    // personne ne sache que la première existait encore dans le fichier.
    expect(findDuplicateKeys(read(locale))).toEqual([]);
  });

  it('le détecteur attrape vraiment un doublon', () => {
    // Sans cette preuve, un détecteur cassé rendrait les tests ci-dessus
    // verts pour toujours.
    const faux = `{
      "a": { "x": 1 },
      "b": { "y": 2, "y": 3 },
      "c": { "note": "un { et un : dans une valeur", "note2": "ok" }
    }`;
    expect(findDuplicateKeys(faux)).toEqual(['(racine).b.y']);
  });

  it('ne confond pas une valeur avec une clé', () => {
    // Les messages contiennent des accolades d'interpolation et des deux-points.
    const piege = `{ "a": "Vidéo {current}/{total}", "b": "ex: fitness", "c": ["x", "x"] }`;
    expect(findDuplicateKeys(piege)).toEqual([]);
  });
});

describe('Les trois langues portent les mêmes clés', () => {
  const keys = Object.fromEntries(
    LOCALES.map((l) => [l, flatten(JSON.parse(read(l)))]),
  ) as Record<(typeof LOCALES)[number], Set<string>>;

  it.each(['en', 'de'] as const)('%s ne diverge pas du français', (locale) => {
    // Une clé présente d'un seul côté, c'est un libellé brut affiché à
    // l'écran dans l'autre langue.
    const manquantes = [...keys.fr].filter((k) => !keys[locale].has(k));
    const enTrop = [...keys[locale]].filter((k) => !keys.fr.has(k));
    expect({ manquantes, enTrop }).toEqual({ manquantes: [], enTrop: [] });
  });
});

describe('Les sous-clés qu’utilise le code existent partout', () => {
  // Celles-ci n'ont survécu que parce qu'elles appartenaient à la SECONDE
  // définition — celle qui gagnait. Elles seraient parties avec elle.
  const utilisees = [
    'title',
    'subtitle',
    'searchPlaceholder',
    'import',
    'remove',
    'clickToSelect',
    'searchOrImport',
    'importFromComputer',
  ];

  it.each(LOCALES)('%s.json — infographic.posterPhoto', (locale) => {
    const messages = JSON.parse(read(locale)) as Record<string, Record<string, Record<string, string>>>;
    const bloc = messages.infographic?.posterPhoto;
    expect(bloc).toBeDefined();
    for (const k of utilisees) {
      expect(typeof bloc[k], `${locale} → ${k}`).toBe('string');
    }
  });
});
