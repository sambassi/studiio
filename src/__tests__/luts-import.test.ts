import { describe, it, expect, vi } from 'vitest';
import {
  importLutFile, envoyerLutApi, listerLutsApi, LUT_ACCEPT, LUT_API, type ReponseImportLut,
} from '@/lib/luts/import';
import { parseCube } from '@/lib/luts/parse';
import { ecrireCube } from '@/lib/luts/serialize';
import { MAX_LUT_BYTES, type LutAsset } from '@/lib/luts/types';

/**
 * Import d'une LUT depuis le navigateur — le chemin vers l'API commune.
 *
 * Ce que ces tests protègent :
 * - le navigateur PRÉ-VALIDE avec le socle et n'envoie rien d'illisible ;
 * - un PNG est canonicalisé en `.cube` déterministe et part avec `origine: 'png'` ;
 * - la référence rendue est CANONIQUE (empreinte, nom, intensité), sans URL ;
 * - l'envoi passe par `POST /api/creatif/luts`, jamais par l'ancien signed-url.
 */

const IDENTITY_2 = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
const CURVE_1D = 'LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n';
const E = 'a'.repeat(64);

const asset = (over: Partial<LutAsset> = {}): LutAsset => ({
  empreinte: E, cle: `u/lut/${E}.cube`, nom: 'look', titre: null, kind: '3d', origine: 'cube',
  taille: 2, octets: 100, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-09-14T00:00:00.000Z',
  ...over,
});

function cubeFile(text = IDENTITY_2, name = 'look.cube'): File {
  return new File([text], name, { type: '' });
}

/** HALD de niveau 2 : image 8×8, cube de 4. */
function haldPng(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 8;
  const cube = 4;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    const r = i % cube;
    const g = Math.floor(i / cube) % cube;
    const b = Math.floor(i / (cube * cube));
    data[i * 4] = Math.round((r / (cube - 1)) * 255);
    data[i * 4 + 1] = Math.round((g / (cube - 1)) * 255);
    data[i * 4 + 2] = Math.round((b / (cube - 1)) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, width, height: width };
}

type Envoyeur = (fichier: File, origine: 'cube' | 'png') => Promise<ReponseImportLut>;
type Decodeur = (file: Blob) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;

/** Dépendances de bord, remplacées par des doubles inertes qui journalisent. */
function deps(overrides: { envoyer?: Envoyeur; decodeImage?: Decodeur } = {}) {
  return {
    envoyer: vi.fn<Envoyeur>(overrides.envoyer ?? (async () => ({ ok: true, issue: 'creee', lut: asset() }))),
    decodeImage: vi.fn<Decodeur>(overrides.decodeImage ?? (async () => haldPng())),
  };
}

describe('importLutFile — chemin nominal', () => {
  it('un .cube 3D : pré-validé, envoyé tel quel avec origine cube, référence canonique', async () => {
    const d = deps();
    const r = await importLutFile(cubeFile(), d);
    expect(d.envoyer).toHaveBeenCalledTimes(1);
    const [fichier, origine] = d.envoyer.mock.calls[0];
    expect(origine).toBe('cube');
    expect(fichier.name).toBe('look.cube');
    expect(r.issue).toBe('creee');
    expect(r.lut.kind).toBe('3d');
    expect(r.ref).toEqual({ empreinte: E, nom: 'look', intensite: 1 });
    expect(Object.keys(r.ref).sort()).toEqual(['empreinte', 'intensite', 'nom']);
    expect(JSON.stringify(r.ref)).not.toMatch(/url|cle|data:|https?:/);
  });

  it('un .cube 1D est pré-validé et envoyé — jamais refusé parce que le rendu n’est pas câblé', async () => {
    const d = deps({ envoyer: async () => ({ ok: true, issue: 'creee', lut: asset({ kind: '1d', taille: 3 }) }) });
    const r = await importLutFile(cubeFile(CURVE_1D, 'gamma.cube'), d);
    expect(r.lut.kind).toBe('1d');
    expect(r.asset.kind).toBe('1d');
    expect(d.envoyer).toHaveBeenCalledTimes(1);
  });

  it('⚠️ un PNG est canonicalisé en .cube déterministe et part avec origine png', async () => {
    const d = deps();
    const png = new File([new Uint8Array([1, 2, 3])], 'Teal.PNG', { type: 'image/png' });
    const r = await importLutFile(png, d);
    expect(d.decodeImage).toHaveBeenCalledTimes(1);
    const [fichier, origine] = d.envoyer.mock.calls[0];
    expect(origine).toBe('png');
    expect(fichier.name).toBe('Teal.cube');
    expect(fichier.type).toBe('text/plain');
    const texte = await fichier.text();
    // Ce qui part est EXACTEMENT ce que le socle écrit pour la table lue.
    expect(texte).toBe(ecrireCube(r.lut, 'Teal'));
    expect(parseCube(texte).size).toBe(4);
    expect(parseCube(texte).title).toBe('Teal');
  });

  it('« existante » est rendu tel quel, avec la fiche de la bibliothèque', async () => {
    const d = deps({ envoyer: async () => ({ ok: true, issue: 'existante', lut: asset({ nom: 'Déjà là' }), avertissement: 'Profil couleur.' }) });
    const r = await importLutFile(cubeFile(), d);
    expect(r.issue).toBe('existante');
    expect(r.ref.nom).toBe('Déjà là');
    expect(r.avertissement).toBe('Profil couleur.');
  });

  it('accepte l’extension quelle que soit sa casse, et un .cube sans type MIME', async () => {
    const d = deps();
    const f = new File([IDENTITY_2], 'LOOK.CUBE', { type: '' });
    await importLutFile(f, d);
    expect(d.envoyer.mock.calls[0][0].name).toBe('LOOK.CUBE');
    // Le type MIME vide d'un `.cube` n'est plus un cas particulier : l'API
    // multipart lit le contenu, pas le type annoncé par le navigateur.
    expect(d.envoyer.mock.calls[0][0].type).toBe('');
  });

  it('le champ de fichier n’annonce que ce que le socle sait lire', () => {
    expect(LUT_ACCEPT.split(',')).toEqual(['.cube', '.png']);
  });
});

describe('importLutFile — refus AVANT tout envoi', () => {
  it('extension inconnue, en nommant celles qui marchent', async () => {
    const d = deps();
    await expect(importLutFile(new File(['x'], 'look.3dl'), d)).rejects.toThrow(/\.cube et \.png/);
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it(`> ${MAX_LUT_BYTES / (1024 * 1024)} Mio, sans lire le contenu`, async () => {
    const d = deps();
    const big = cubeFile('x');
    Object.defineProperty(big, 'size', { value: MAX_LUT_BYTES + 1 });
    const text = vi.spyOn(big, 'text');
    await expect(importLutFile(big, d)).rejects.toThrow(/Mo/);
    expect(text).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('un .cube tronqué ou hors bornes : rien ne part', async () => {
    const d = deps();
    await expect(importLutFile(cubeFile('LUT_3D_SIZE 2\n0 0 0\n'), d)).rejects.toThrow(/triplets/);
    await expect(importLutFile(cubeFile('LUT_3D_SIZE 66\n0 0 0\n'), d)).rejects.toThrow(/65/);
    await expect(importLutFile(cubeFile('LUT_1D_SIZE 65537\n0 0 0\n'), d)).rejects.toThrow(/65536/);
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('une image qui n’est pas une LUT : rien ne part', async () => {
    const d = deps({ decodeImage: async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) });
    await expect(importLutFile(new File(['x'], 'photo.png'), d)).rejects.toThrow();
    expect(d.envoyer).not.toHaveBeenCalled();
  });
});

describe('importLutFile — refus de l’API, en français', () => {
  const refus = (statut: number, extra: { motif?: string; error?: string } = {}) =>
    deps({ envoyer: async () => ({ ok: false, statut, ...extra }) });

  it('bibliothèque pleine (409)', async () => {
    await expect(importLutFile(cubeFile(), refus(409))).rejects.toThrow(/pleine/);
  });

  it('le message du serveur est relayé quand il en donne un', async () => {
    await expect(importLutFile(cubeFile(), refus(422, { error: 'Ce fichier n’est pas une LUT .cube valide.' })))
      .rejects.toThrow(/LUT \.cube valide/);
  });

  it('erreur serveur (500) et socle absent (503) : messages distincts, jamais un code nu', async () => {
    await expect(importLutFile(cubeFile(), refus(500))).rejects.toThrow(/Réessayez/);
    await expect(importLutFile(cubeFile(), refus(503))).rejects.toThrow(/pas encore disponible/);
    await expect(importLutFile(cubeFile(), refus(401))).rejects.toThrow(/Connectez-vous/);
  });
});

describe('envoyerLutApi / listerLutsApi — l’API commune, et elle seule', () => {
  it('POST multipart vers /api/creatif/luts avec fichier + origine ; jamais signed-url', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 201,
      json: async () => ({ ok: true, issue: 'creee', lut: asset() }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await envoyerLutApi(cubeFile(), 'png');
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LUT_API);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect((form.get('fichier') as File).name).toBe('look.cube');
    expect(form.get('origine')).toBe('png');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('signed-url');
  });

  it('un refus rend statut, motif et message — sans lever', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ ok: false, motif: 'bibliotheque_pleine', error: 'Pleine.' }),
    })) as unknown as typeof fetch;
    expect(await envoyerLutApi(cubeFile(), 'cube')).toEqual({ ok: false, statut: 409, motif: 'bibliotheque_pleine', error: 'Pleine.' });
  });

  it('listerLutsApi rend la bibliothèque, ou null si l’appel échoue', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, luts: [asset()] }) })) as unknown as typeof fetch;
    expect(await listerLutsApi()).toEqual([asset()]);
    globalThis.fetch = vi.fn(async () => { throw new Error('réseau'); }) as unknown as typeof fetch;
    expect(await listerLutsApi()).toBeNull();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) })) as unknown as typeof fetch;
    expect(await listerLutsApi()).toBeNull();
  });
});
