import { describe, it, expect } from 'vitest';
import {
  cleLutAsset, cleLutValide, empreinteValide, nomLutValide, nomParDefaut,
  tailleLutValide, lutAssetValide, lutAssetsValides, lutParEmpreinte,
  lutRefValide, refDeLutAsset, LUTS_MAX, NOM_LUT_MAX, SEGMENT_LUT,
} from '@/lib/luts/bibliotheque';
import { MAX_LUT_1D_SIZE, MAX_LUT_SIZE, type LutAsset } from '@/lib/luts/types';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const E = 'a'.repeat(64);

const fiche = (over: Partial<LutAsset> = {}): LutAsset => ({
  empreinte: E, cle: cleLutAsset(U, E), nom: 'Teal & Orange', titre: 'Teal',
  kind: '3d', origine: 'cube', taille: 33, octets: 1234,
  domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-09-14T10:00:00.000Z',
  ...over,
});

describe('La clé porte la propriété', () => {
  it('est faite du compte, du segment et de l’empreinte — jamais du nom de fichier', () => {
    expect(cleLutAsset(U, E)).toBe(`${U}/${SEGMENT_LUT}/${E}.cube`);
  });

  it('⚠️ la clé d’un autre compte est refusée', () => {
    expect(cleLutValide(cleLutAsset(U, E), U)).toBe(true);
    expect(cleLutValide(cleLutAsset(AUTRUI, E), U)).toBe(false);
    expect(cleLutValide(cleLutAsset(U, E), '')).toBe(false);
  });

  it('⚠️ aucune traversée ne sort du namespace', () => {
    for (const cle of [`${U}/lut/../rush/x.mp4`, `${U}/lut\\x.cube`, `${U}/lut/http://x`, '']) {
      expect(cleLutValide(cle, U), cle).toBe(false);
    }
  });

  it('une empreinte est un SHA-256 hexadécimal minuscule, et rien d’autre', () => {
    expect(empreinteValide(E)).toBe(true);
    expect(empreinteValide('A'.repeat(64))).toBe(false);
    expect(empreinteValide('a'.repeat(63))).toBe(false);
    expect(empreinteValide(42)).toBe(false);
  });
});

describe('Noms', () => {
  it('nettoie et borne, sans rejeter', () => {
    expect(nomLutValide('  Mon\tlook\n ')).toBe('Mon look');
    expect(nomLutValide('x'.repeat(500))).toHaveLength(NOM_LUT_MAX);
    expect(nomLutValide('   ')).toBeNull();
    expect(nomLutValide(3)).toBeNull();
  });

  it('nomParDefaut : le TITLE d’abord, sinon le fichier sans chemin ni extension', () => {
    expect(nomParDefaut('Teal', 'x.cube')).toBe('Teal');
    expect(nomParDefaut(null, '../../etc/passwd.cube')).toBe('passwd');
    expect(nomParDefaut(null, 'C:\\looks\\Cinema.PNG')).toBe('Cinema');
    expect(nomParDefaut(null, '')).toBe('Mon look');
  });
});

describe('Bornes de taille par nature', () => {
  it('3D : 2 à MAX_LUT_SIZE ; 1D : 2 à MAX_LUT_1D_SIZE', () => {
    expect(tailleLutValide('3d', MAX_LUT_SIZE)).toBe(true);
    expect(tailleLutValide('3d', MAX_LUT_SIZE + 1)).toBe(false);
    expect(tailleLutValide('1d', MAX_LUT_1D_SIZE)).toBe(true);
    expect(tailleLutValide('1d', MAX_LUT_1D_SIZE + 1)).toBe(false);
    expect(tailleLutValide('3d', 1)).toBe(false);
    expect(tailleLutValide('2d', 8)).toBe(false);
  });
});

describe('Ce qui entre dans la bibliothèque', () => {
  it('une fiche complète est relue telle quelle', () => {
    expect(lutAssetValide(fiche(), U)).toEqual(fiche());
  });

  it('une 1D d’origine PNG est une fiche valide', () => {
    const f = fiche({ kind: '1d', origine: 'png', taille: 1024 });
    expect(lutAssetValide(f, U)).toEqual(f);
  });

  it('⚠️ sans compte, on ne devine pas', () => {
    expect(lutAssetValide(fiche(), '')).toBeNull();
    expect(lutAssetValide(fiche({ cle: cleLutAsset(AUTRUI, E) }), U)).toBeNull();
  });

  it('les fiches incohérentes sont écartées, pas réparées', () => {
    expect(lutAssetValide(fiche({ empreinte: 'x' }), U)).toBeNull();
    expect(lutAssetValide(fiche({ nom: '' }), U)).toBeNull();
    expect(lutAssetValide(fiche({ kind: '4d' as never }), U)).toBeNull();
    expect(lutAssetValide(fiche({ origine: 'jpg' as never }), U)).toBeNull();
    expect(lutAssetValide(fiche({ taille: MAX_LUT_SIZE + 1 }), U)).toBeNull();
    expect(lutAssetValide(fiche({ octets: 0 }), U)).toBeNull();
    expect(lutAssetValide(null, U)).toBeNull();
  });

  it('un domaine ou une date abîmés retombent sur le défaut', () => {
    const f = lutAssetValide(fiche({ domainMax: 'x' as never, importeeLe: 'hier' }), U)!;
    expect(f.domainMax).toEqual([1, 1, 1]);
    expect(f.importeeLe).toBe(new Date(0).toISOString());
  });

  it('⚠️ les doublons d’empreinte sont fondus et le plafond est tenu', () => {
    const brut = Array.from({ length: LUTS_MAX + 5 }, (_, i) => {
      const e = i.toString(16).padStart(64, '0');
      return fiche({ empreinte: e, cle: cleLutAsset(U, e) });
    });
    const avecDoublon = [brut[0], ...brut];
    const luts = lutAssetsValides(avecDoublon, U);
    expect(luts).toHaveLength(LUTS_MAX);
    expect(new Set(luts.map((l) => l.empreinte)).size).toBe(LUTS_MAX);
    expect(lutParEmpreinte(luts, brut[1].empreinte)).toEqual(brut[1]);
    expect(lutAssetsValides('x', U)).toEqual([]);
  });
});

describe('LutRef — la référence légère', () => {
  it('se dérive d’une fiche, bornée', () => {
    expect(refDeLutAsset(fiche(), 0.6)).toEqual({ empreinte: E, nom: 'Teal & Orange', intensite: 0.6 });
    expect(refDeLutAsset(fiche(), 7).intensite).toBe(1);
  });

  it('se relit : intensité hors plage → 1, empreinte douteuse → rien', () => {
    expect(lutRefValide({ empreinte: E, nom: 'x', intensite: 0.3 })).toEqual({ empreinte: E, nom: 'x', intensite: 0.3 });
    expect(lutRefValide({ empreinte: E, nom: 'x', intensite: 4 })!.intensite).toBe(1);
    expect(lutRefValide({ empreinte: E })!.nom).toBe('');
    expect(lutRefValide({ empreinte: 'nope', nom: 'x', intensite: 1 })).toBeUndefined();
    expect(lutRefValide({ url: 'https://x/y.cube', name: 'x', intensity: 1 })).toBeUndefined();
  });

  it('ne porte jamais de table ni d’URL, même si le brouillon en avait', () => {
    const ref = lutRefValide({ empreinte: E, nom: 'x', intensite: 1, table: [1, 2], url: 'https://x' })!;
    expect(Object.keys(ref).sort()).toEqual(['empreinte', 'intensite', 'nom']);
  });
});
