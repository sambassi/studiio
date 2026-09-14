import { describe, it, expect } from 'vitest';
import { parseCube } from '@/lib/luts/parse';
import { ecrireCube, doserLut } from '@/lib/luts/serialize';
import type { Lut } from '@/lib/luts/types';

/**
 * Écriture `.cube` et dosage — le socle commun.
 *
 * Ce que ces tests protègent :
 * - **déterminisme** : mêmes valeurs → mêmes octets, sinon l'empreinte
 *   n'identifie rien et la déduplication est une illusion ;
 * - **aller-retour** : ce qui est écrit se relit à l'identique par le SEUL
 *   parseur du dépôt — pas de second parseur, pas de dialecte maison ;
 * - **dosage exact** : 0 = identité, 1 = la table même, 0,5 = le milieu.
 */

const identity3d = (n: number): Lut => {
  const table = new Float32Array(n * n * n * 3);
  let k = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    table[k++] = r / (n - 1); table[k++] = g / (n - 1); table[k++] = b / (n - 1);
  }
  return { kind: '3d', size: n, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
};

const curve1d = (n: number, f: (x: number) => number): Lut => {
  const table = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = f(i / (n - 1));
    table[i * 3] = v; table[i * 3 + 1] = v; table[i * 3 + 2] = v;
  }
  return { kind: '1d', size: n, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
};

describe('ecrireCube — forme', () => {
  it('écrit un cube 3D lisible par parseCube, sans rien d’implicite', () => {
    const texte = ecrireCube(identity3d(2), 'Neutre');
    expect(texte.split('\n')[0]).toBe('TITLE "Neutre"');
    expect(texte).toContain('LUT_3D_SIZE 2');
    // Domaine par défaut : rien à écrire.
    expect(texte).not.toContain('DOMAIN_');
    expect(texte.endsWith('\n')).toBe(true);
  });

  it('écrit une 1D avec LUT_1D_SIZE', () => {
    const texte = ecrireCube(curve1d(4, (x) => x));
    expect(texte).toContain('LUT_1D_SIZE 4');
    expect(texte).not.toContain('LUT_3D_SIZE');
  });

  it('n’écrit le domaine que s’il diffère du défaut', () => {
    const lut = { ...identity3d(2), domainMin: [0, 0, 0] as [number, number, number], domainMax: [2, 2, 2] as [number, number, number] };
    const texte = ecrireCube(lut);
    expect(texte).not.toContain('DOMAIN_MIN');
    expect(texte).toContain('DOMAIN_MAX 2.000000 2.000000 2.000000');
  });

  it('un titre ne peut pas casser le fichier', () => {
    const texte = ecrireCube(identity3d(2), 'Mon "look"\nLUT_3D_SIZE 99');
    expect(parseCube(texte).size).toBe(2);
    expect(texte.split('\n').filter((l) => l.startsWith('LUT_3D_SIZE'))).toHaveLength(1);
  });
});

describe('ecrireCube — déterminisme', () => {
  it('mêmes valeurs → mêmes octets, quelle que soit la mise en forme d’origine', () => {
    const a = parseCube('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    const b = parseCube(
      '# commentaire\nTITLE "x"\nLUT_3D_SIZE   2\n\n0.0 0.0 0.0\n1.000000 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
    );
    // Le titre n'est pas une valeur : on l'écrit à l'identique pour comparer les tables.
    expect(ecrireCube(a, 'x')).toBe(ecrireCube(b, 'x'));
  });

  it('est un point fixe : écrire ce qu’on a relu redonne les mêmes octets', () => {
    const lut = curve1d(16, (x) => Math.sqrt(x));
    const une = ecrireCube(lut);
    const deux = ecrireCube(parseCube(une));
    expect(deux).toBe(une);
  });

  it('ne produit jamais « -0.000000 »', () => {
    const lut = identity3d(2);
    lut.table[0] = -0;
    expect(ecrireCube(lut)).not.toContain('-0.000000');
  });
});

describe('aller-retour parseCube(ecrireCube(x))', () => {
  it('conserve un cube 3D à 1e-6 près', () => {
    const src = identity3d(3);
    src.table[4] = 0.123456789;
    const lu = parseCube(ecrireCube(src));
    expect(lu.kind).toBe('3d');
    expect(lu.size).toBe(3);
    for (let i = 0; i < src.table.length; i++) {
      expect(Math.abs(lu.table[i] - src.table[i])).toBeLessThan(1e-6);
    }
  });

  it('conserve une 1D, son domaine et son titre', () => {
    const src = { ...curve1d(8, (x) => x * x), title: 'Gamma', domainMin: [0, 0, 0] as [number, number, number], domainMax: [4, 4, 4] as [number, number, number] };
    const lu = parseCube(ecrireCube(src));
    expect(lu.kind).toBe('1d');
    expect(lu.size).toBe(8);
    expect(lu.title).toBe('Gamma');
    expect(lu.domainMax).toEqual([4, 4, 4]);
  });
});

describe('doserLut', () => {
  it('à 1, rend la table telle quelle', () => {
    const lut = curve1d(4, (x) => x * 0.5);
    expect(doserLut(lut, 1)).toBe(lut);
  });

  it('à 0, rend l’identité exacte — sur un 3D comme sur une 1D', () => {
    const cube = identity3d(3);
    cube.table.fill(0.7);
    const dose = doserLut(cube, 0);
    expect(Array.from(dose.table)).toEqual(Array.from(identity3d(3).table));

    const courbe = doserLut(curve1d(5, () => 0.9), 0);
    expect(Array.from(courbe.table)).toEqual(Array.from(curve1d(5, (x) => x).table));
  });

  it('à 0,5, prend le milieu entre l’identité et la table', () => {
    const lut = curve1d(3, () => 1); // tout vers le blanc
    const dose = doserLut(lut, 0.5);
    // nœud 0 : identité 0, table 1 → 0,5 ; nœud 2 : identité 1, table 1 → 1
    expect(dose.table[0]).toBeCloseTo(0.5, 6);
    expect(dose.table[3]).toBeCloseTo(0.75, 6);
    expect(dose.table[6]).toBeCloseTo(1, 6);
  });

  it('respecte le domaine de la LUT pour calculer l’identité', () => {
    const lut = { ...curve1d(2, () => 0), domainMax: [2, 2, 2] as [number, number, number] };
    const dose = doserLut(lut, 0);
    expect(dose.table[3]).toBeCloseTo(2, 6);
  });

  it('ne mute pas la table d’origine', () => {
    const lut = curve1d(3, () => 1);
    const avant = Array.from(lut.table);
    doserLut(lut, 0.3);
    expect(Array.from(lut.table)).toEqual(avant);
  });
});
