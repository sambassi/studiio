import { describe, it, expect } from 'vitest';
import {
  lireLutAsset, empreinteLut, MOTIFS_IMPORT_LUT, MESSAGES_IMPORT_LUT,
} from '@/lib/luts/import-utilisateur';
import { parseCube } from '@/lib/luts/parse';
import { ecrireCube } from '@/lib/luts/serialize';
import { MAX_LUT_1D_SIZE, MAX_LUT_BYTES, MAX_LUT_SIZE } from '@/lib/luts/types';

/**
 * Validation serveur d'une LUT importée — l'autorité finale.
 *
 * Ni l'extension ni le type MIME ne sont crus : le contenu tranche. Le
 * fichier accepté est CANONICALISÉ puis haché : c'est l'empreinte de ces
 * octets-là qui identifie la LUT.
 */

/** Un cube 3D identité de taille n, en texte. */
function cube3d(n: number, extra = ''): string {
  const lignes = [extra, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    lignes.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  }
  return `${lignes.filter((l) => l !== '').join('\n')}\n`;
}

/** Une courbe 1D identité de n points. */
function cube1d(n: number): string {
  const lignes = [`LUT_1D_SIZE ${n}`];
  for (let i = 0; i < n; i++) lignes.push(`${i / (n - 1)} ${i / (n - 1)} ${i / (n - 1)}`);
  return `${lignes.join('\n')}\n`;
}

const octets = (s: string) => Buffer.from(s, 'utf8');

describe('lireLutAsset — ce qui est accepté', () => {
  it('un .cube 3D valide, mesuré et canonicalisé', () => {
    const r = lireLutAsset(octets(cube3d(2, 'TITLE "Teal"')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mesure.kind).toBe('3d');
    expect(r.mesure.taille).toBe(2);
    expect(r.mesure.titre).toBe('Teal');
    expect(r.mesure.domainMin).toEqual([0, 0, 0]);
    expect(r.mesure.domainMax).toEqual([1, 1, 1]);
    expect(r.mesure.empreinte).toMatch(/^[0-9a-f]{64}$/);
    // Les octets stockés sont la forme canonique, relisible par le seul parseur.
    expect(r.mesure.canonique.toString('utf8')).toBe(ecrireCube(r.mesure.lut));
    expect(r.mesure.octets).toBe(r.mesure.canonique.length);
    expect(parseCube(r.mesure.canonique.toString('utf8')).size).toBe(2);
  });

  it('⚠️ un .cube 1D valide est ACCEPTÉ, avec sa nature', () => {
    const r = lireLutAsset(octets(cube1d(1024)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mesure.kind).toBe('1d');
    expect(r.mesure.taille).toBe(1024);
    expect(r.mesure.canonique.toString('utf8')).toContain('LUT_1D_SIZE 1024');
  });

  it(`la taille ${MAX_LUT_SIZE} (DaVinci Resolve) est acceptée`, () => {
    const r = lireLutAsset(octets(cube3d(MAX_LUT_SIZE)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mesure.taille).toBe(MAX_LUT_SIZE);
  });

  it('le domaine déclaré est conservé', () => {
    const r = lireLutAsset(octets(`DOMAIN_MIN 0 0 0\nDOMAIN_MAX 4 4 4\n${cube3d(2)}`));
    expect(r.ok && r.mesure.domainMax).toEqual([4, 4, 4]);
    expect(r.ok && r.mesure.canonique.toString('utf8')).toContain('DOMAIN_MAX 4.000000 4.000000 4.000000');
  });

  it('un BOM UTF-8 en tête n’invalide pas le fichier', () => {
    const avecBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), octets(cube3d(2))]);
    const r = lireLutAsset(avecBom);
    expect(r.ok).toBe(true);
  });

  it('la mise en forme d’origine ne change ni l’empreinte ni les octets stockés', () => {
    const a = lireLutAsset(octets(cube3d(2)));
    const b = lireLutAsset(octets(`# export\n\n${cube3d(2).replace(/\n/g, '   \n')}`));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.mesure.empreinte).toBe(a.mesure.empreinte);
    expect(b.mesure.canonique.equals(a.mesure.canonique)).toBe(true);
  });
});

describe('lireLutAsset — ce qui est refusé, et pourquoi', () => {
  it('fichier absent / vide / blanc', () => {
    expect(lireLutAsset(null)).toEqual({ ok: false, motif: 'fichier_absent' });
    expect(lireLutAsset(Buffer.alloc(0))).toEqual({ ok: false, motif: 'fichier_vide' });
    expect(lireLutAsset(octets('   \n\n'))).toEqual({ ok: false, motif: 'fichier_vide' });
  });

  it(`refuse au-delà de ${MAX_LUT_BYTES / (1024 * 1024)} Mio SANS lire le contenu`, () => {
    const gros = Buffer.alloc(MAX_LUT_BYTES + 1, 0x20);
    expect(lireLutAsset(gros)).toEqual({ ok: false, motif: 'trop_volumineux' });
  });

  it('refuse un binaire (octet NUL) avant tout parsing', () => {
    const bin = Buffer.concat([octets('LUT_3D_SIZE 2\n'), Buffer.from([0, 1, 2, 3])]);
    expect(lireLutAsset(bin)).toEqual({ ok: false, motif: 'binaire' });
  });

  it(`refuse un cube de ${MAX_LUT_SIZE + 1} pas comme hors bornes`, () => {
    expect(lireLutAsset(octets(`LUT_3D_SIZE ${MAX_LUT_SIZE + 1}\n0 0 0\n`)))
      .toEqual({ ok: false, motif: 'taille_hors_bornes' });
  });

  it(`refuse une 1D de plus de ${MAX_LUT_1D_SIZE} points`, () => {
    expect(lireLutAsset(octets(`LUT_1D_SIZE ${MAX_LUT_1D_SIZE + 1}\n0 0 0\n`)))
      .toEqual({ ok: false, motif: 'taille_hors_bornes' });
  });

  it('un .cube tronqué ou du texte quelconque : cube_invalide, sans écho du parseur', () => {
    expect(lireLutAsset(octets('LUT_3D_SIZE 2\n0 0 0\n'))).toEqual({ ok: false, motif: 'cube_invalide' });
    expect(lireLutAsset(octets('bonjour\nceci est un .txt renommé\n'))).toEqual({ ok: false, motif: 'cube_invalide' });
  });

  it('chaque motif a un message', () => {
    for (const m of MOTIFS_IMPORT_LUT) expect(MESSAGES_IMPORT_LUT[m].length).toBeGreaterThan(0);
  });
});

describe('empreinteLut', () => {
  it('est stable pour les mêmes octets, et distincte pour des octets différents', () => {
    expect(empreinteLut(octets('abc'))).toBe(empreinteLut(Buffer.from('abc')));
    expect(empreinteLut(octets('abc'))).not.toBe(empreinteLut(octets('abd')));
    expect(empreinteLut(octets('abc'))).toHaveLength(64);
  });

  it('⚠️ deux tables différentes ont deux empreintes', () => {
    const a = lireLutAsset(octets(cube3d(2)));
    const autre = cube3d(2).replace('1 1 1\n', '0.5 0.5 0.5\n');
    const b = lireLutAsset(octets(autre));
    expect(a.ok && b.ok && a.mesure.empreinte !== b.mesure.empreinte).toBe(true);
  });
});
