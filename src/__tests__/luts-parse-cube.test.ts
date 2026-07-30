import { describe, it, expect } from 'vitest';
import { parseCube } from '@/lib/luts/parse';

/**
 * Parseur `.cube` (Adobe/IRIDAS).
 *
 * Les tests portent sur le COMPORTEMENT du parseur — ce qu'il produit et ce
 * qu'il refuse — jamais sur la forme du source. Un `.cube` mal formé doit
 * LEVER : un tableau à moitié rempli produirait un étalonnage silencieusement
 * faux, c'est-à-dire invisible en revue.
 */

/** Identité 2×2×2, rouge variant le plus vite (ordre imposé par le format). */
const IDENTITY_2 = `LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe('parseCube — LUT 3D', () => {
  it('lit la taille et produit size³ triplets', () => {
    const lut = parseCube(IDENTITY_2);
    expect(lut.kind).toBe('3d');
    expect(lut.size).toBe(2);
    expect(lut.table.length).toBe(2 * 2 * 2 * 3);
  });

  it('conserve l’ordre du format : le rouge varie le plus vite', () => {
    const lut = parseCube(IDENTITY_2);
    // Entrée 0 = (r0,g0,b0), entrée 1 = (r1,g0,b0) — et non (r0,g1,b0).
    expect(Array.from(lut.table.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(lut.table.slice(3, 6))).toEqual([1, 0, 0]);
    // Entrée 2 = (r0,g1,b0) : le vert n'avance qu'après un tour complet du rouge.
    expect(Array.from(lut.table.slice(6, 9))).toEqual([0, 1, 0]);
  });

  it('lit TITLE et ignore commentaires et lignes vides', () => {
    const lut = parseCube(`# Un commentaire
TITLE "Mon Look"

LUT_3D_SIZE 2

0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`);
    expect(lut.title).toBe('Mon Look');
    expect(lut.size).toBe(2);
  });

  it('applique le domaine par défaut 0→1 quand DOMAIN_MIN/MAX sont absents', () => {
    const lut = parseCube(IDENTITY_2);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('lit DOMAIN_MIN et DOMAIN_MAX quand ils sont déclarés', () => {
    const lut = parseCube(`LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 4 4 4
${IDENTITY_2.split('\n').slice(1).join('\n')}`);
    expect(lut.domainMax).toEqual([4, 4, 4]);
  });
});

describe('parseCube — LUT 1D', () => {
  it('reconnaît LUT_1D_SIZE et produit size triplets', () => {
    const lut = parseCube(`LUT_1D_SIZE 3
0 0 0
0.5 0.5 0.5
1 1 1
`);
    expect(lut.kind).toBe('1d');
    expect(lut.size).toBe(3);
    expect(lut.table.length).toBe(3 * 3);
  });
});

describe('parseCube — refus explicites', () => {
  it('lève quand il manque des triplets', () => {
    expect(() => parseCube(`LUT_3D_SIZE 2
0 0 0
1 0 0
`)).toThrow(/8 triplets.*2 lus|attendu/i);
  });

  it('lève quand il y a des triplets en trop', () => {
    expect(() => parseCube(`${IDENTITY_2}0.5 0.5 0.5\n`)).toThrow();
  });

  it('lève quand aucune taille n’est déclarée', () => {
    expect(() => parseCube('0 0 0\n1 1 1\n')).toThrow(/LUT_3D_SIZE|LUT_1D_SIZE/);
  });

  it('lève quand la taille dépasse le plafond de 64', () => {
    expect(() => parseCube('LUT_3D_SIZE 128\n')).toThrow(/64/);
  });

  it('lève quand la taille est absurde', () => {
    expect(() => parseCube('LUT_3D_SIZE 1\n0 0 0\n')).toThrow();
  });

  it('lève sur une ligne de données non numérique', () => {
    expect(() => parseCube(`LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
oups oups oups
`)).toThrow(/ligne/i);
  });

  it('lève sur un fichier vide', () => {
    expect(() => parseCube('   \n\n')).toThrow();
  });
});
