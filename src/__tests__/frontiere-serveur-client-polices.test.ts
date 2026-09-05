import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { FONT_CATALOG, findFont } from '@/lib/fonts/catalog-data';
import { POLICE_IDS, POLICES_AUTORISEES } from '@/lib/autopilot/analyse/catalogues-creatifs';

/**
 * LA FRONTIERE SERVEUR / CLIENT DU CATALOGUE DE POLICES.
 *
 * ---------------------------------------------------------------------------
 * LA PANNE QUE CE FICHIER EXISTE POUR NE PLUS REVIVRE
 * ---------------------------------------------------------------------------
 *
 * `npm run build` a echoue pendant « Collecting page data », sur
 * `/api/autopilot/montages/[montagePlanId]/rendu`, avec :
 *
 *     Attempted to call map() from the server but map is on the client.
 *
 * La chaine etait : route serveur -> rendu-contrat -> profil-creatif ->
 * catalogues-creatifs -> `@/lib/fonts/catalog`, qui porte `'use client'`.
 * Next ne remet pas ses VALEURS a un module serveur : il remet une reference
 * client. `FONT_CATALOG.map(...)`, evalue AU CHARGEMENT du module, echouait.
 *
 * ⚠️ CE QUI REND CETTE REGRESSION DANGEREUSE : ni `vitest` ni `tsc` ne la
 * voient. Vitest n'applique pas la directive `'use client'`, et TypeScript non
 * plus. Seul `next build` echoue — c'est-a-dire au deploiement, sur une
 * production qu'on croyait prete. D'ou ces tests de STRUCTURE : ils ne
 * remplacent pas `npm run build`, ils font echouer PLUS TOT le geste qui le
 * casserait.
 *
 * ⚠️ ET POURQUOI LES APPELS PARESSEUX NE SAUVAIENT RIEN. `textStyle.ts`
 * importait `findFont` du meme module client et passait, parce qu'il ne
 * l'appelle qu'a l'execution. C'etait un sursis, pas une garantie : la
 * premiere evaluation au chargement l'aurait casse a son tour. Il importe
 * desormais du module pur, lui aussi.
 */

const racine = (f: string) => resolve(process.cwd(), f);
const source = (f: string) => readFileSync(racine(f), 'utf8');

/** Le code, commentaires retires — un `document.` cite dans une explication
 *  n'est pas un appel au DOM, et un test qui les confond pousse a effacer des
 *  commentaires utiles. */
function sansCommentaires(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DATA = 'src/lib/fonts/catalog-data.ts';
const CLIENT = 'src/lib/fonts/catalog.ts';

describe('1. le module de donnees est PUR', () => {
  it('il existe', () => {
    expect(existsSync(racine(DATA))).toBe(true);
  });

  it.each([
    ["'use client'", /'use client'|"use client"/],
    ['document.', /\bdocument\s*\./],
    ['window.', /\bwindow\s*\./],
    ['navigator.', /\bnavigator\s*\./],
    ['FontFace', /\bFontFace\b/],
  ])('il ne contient pas %s', (_nom, motif) => {
    expect(sansCommentaires(source(DATA))).not.toMatch(motif);
  });

  it('il n\'importe rien du module client', () => {
    expect(sansCommentaires(source(DATA))).not.toContain("from './catalog'");
    expect(sansCommentaires(source(DATA))).not.toContain("@/lib/fonts/catalog'");
  });
});

describe('2. une seule source de verite', () => {
  it('FONT_CATALOG n\'est declare QU\'UNE fois dans tout le depot', () => {
    const declarations = ['src/lib/fonts/catalog-data.ts', 'src/lib/fonts/catalog.ts']
      .filter((f) => /export const FONT_CATALOG\s*[:=]/.test(source(f)));
    expect(declarations).toEqual([DATA]);
  });

  it('le module client RE-EXPORTE les donnees au lieu de les recopier', () => {
    const code = sansCommentaires(source(CLIENT));
    expect(code).toMatch(/export\s*\{[\s\S]*FONT_CATALOG[\s\S]*\}\s*from '\.\/catalog-data'/);
    expect(code).not.toMatch(/export const FONT_CATALOG\s*[:=]/);
  });

  it('le module client garde bien sa directive et sa logique navigateur', () => {
    expect(source(CLIENT).split('\n')[0].trim()).toBe("'use client';");
    expect(sansCommentaires(source(CLIENT))).toMatch(/\bdocument\s*\./);
  });
});

describe('3. les modules atteignables depuis une route serveur', () => {
  const SERVEUR: Array<[string, string]> = [
    ['catalogue creatif du Lot 2B', 'src/lib/autopilot/analyse/catalogues-creatifs.ts'],
    ['style de texte de l\'Autopilote', 'src/lib/autopilot/textStyle.ts'],
    ['brouillon de l\'editeur', 'src/lib/creer/draft.ts'],
    ['profil creatif', 'src/lib/autopilot/analyse/profil-creatif.ts'],
    ['objectif de communication', 'src/lib/autopilot/analyse/objectif-communication.ts'],
    ['contrat de rendu', 'src/lib/autopilot/analyse/rendu-contrat.ts'],
  ];

  it.each(SERVEUR)('%s n\'importe JAMAIS `@/lib/fonts/catalog`', (_nom, fichier) => {
    const code = sansCommentaires(source(fichier));
    expect(code).not.toMatch(/from '@\/lib\/fonts\/catalog'/);
  });

  /**
   * ⚠️ `draft.ts` EST ABSENT DE CETTE LISTE, ET CE N'EST PAS UN OUBLI. Il
   * ecrit les brouillons dans `localStorage` : il touche donc `window`, sous
   * garde `typeof window === 'undefined'`. C'est un module ISOMORPHE, pas un
   * module serveur. Ce qu'on exige de lui, c'est de ne pas traverser la
   * frontiere pour une simple DONNEE — regle verifiee juste au-dessus.
   */
  const SANS_DOM = SERVEUR.filter(([, f]) => !f.endsWith('creer/draft.ts'));

  it.each(SANS_DOM)('%s ne touche ni au DOM ni a une directive client', (_nom, fichier) => {
    const code = sansCommentaires(source(fichier));
    expect(code).not.toMatch(/'use client'|"use client"/);
    expect(code).not.toMatch(/\bdocument\s*\./);
    expect(code).not.toMatch(/\bwindow\s*\./);
    expect(code).not.toMatch(/\bnavigator\s*\./);
    expect(code).not.toMatch(/\bFontFace\b/);
  });

  it('`catalogues-creatifs` lit bien le module PUR', () => {
    expect(sansCommentaires(source('src/lib/autopilot/analyse/catalogues-creatifs.ts')))
      .toContain("from '@/lib/fonts/catalog-data'");
  });

  /**
   * La cause EXACTE du build casse : une evaluation du catalogue au CHARGEMENT
   * du module, dans une chaine atteinte par une route serveur.
   */
  it('l\'evaluation au chargement porte bien sur le catalogue pur', () => {
    const code = sansCommentaires(
      source('src/lib/autopilot/analyse/catalogues-creatifs.ts'),
    );
    expect(code).toMatch(/export const POLICES_AUTORISEES[\s\S]*FONT_CATALOG\.map\(/);
  });
});

describe('4. ecran et serveur voient exactement les memes polices', () => {
  it('un identifiant par famille, sans perte ni doublon', () => {
    expect(POLICES_AUTORISEES).toHaveLength(FONT_CATALOG.length);
    expect(new Set(POLICE_IDS).size).toBe(POLICE_IDS.length);
  });

  it('chaque identifiant retrouve SA famille dans le catalogue', () => {
    for (const p of POLICES_AUTORISEES) {
      const def = findFont(p.famille);
      expect(def, p.famille).toBeDefined();
      expect(p.poidsDisponibles).toEqual(def!.weights);
      expect(p.usage).toBe(def!.group);
    }
  });

  it('Bebas Neue — la premiere police de test — est bien la des deux cotes', () => {
    expect(POLICE_IDS).toContain('bebas-neue');
    expect(findFont('Bebas Neue')).toBeDefined();
  });
});
