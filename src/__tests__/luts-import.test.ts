import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importLutFile, uploadLutFile, LUT_ACCEPT, LUT_UPLOAD_PURPOSE } from '@/lib/luts/import';
import { purposeAcceptable } from '@/lib/storage/acces-objet';

/**
 * Import d'un fichier de LUT.
 *
 * Deux règles gouvernent ces tests :
 *
 * 1. **On valide AVANT de téléverser.** Un fichier illisible ne doit jamais
 *    atteindre le stockage : l'utilisateur verrait une LUT dans son montage,
 *    et le rendu échouerait plus tard, loin de la cause.
 * 2. **On ne persiste que la référence.** Une `.cube` de 6 Mo transformée en
 *    data URL ferait sauter le quota `localStorage` — échec silencieux de
 *    l'auto-sauvegarde — et partirait dans le `metadata` de chaque post.
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

function cubeFile(text = IDENTITY_2, name = 'look.cube'): File {
  return new File([text], name, { type: 'application/octet-stream' });
}

/** Dépendances de bord, remplacées par des doubles inertes. */
function deps(overrides: Partial<Parameters<typeof importLutFile>[1]> = {}) {
  return {
    upload: vi.fn(async () => 'https://minio.example/luts/look.cube'),
    decodeImage: vi.fn(async () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
    ...overrides,
  };
}

describe('importLutFile — chemin nominal', () => {
  it('lit un .cube, le téléverse et rend une référence persistable', async () => {
    const d = deps();
    const { ref, lut } = await importLutFile(cubeFile(), d);

    expect(lut.size).toBe(2);
    expect(ref.url).toBe('https://minio.example/luts/look.cube');
    expect(ref.name).toBe('look.cube');
    expect(ref.intensity).toBe(1);
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it('ne met aucune donnée d’image dans la référence', async () => {
    const { ref } = await importLutFile(cubeFile(), deps());
    // Tout ce qui est persisté doit tenir en quelques dizaines d'octets.
    expect(JSON.stringify(ref).length).toBeLessThan(200);
    expect(JSON.stringify(ref)).not.toContain('data:');
  });

  it('accepte l’extension quelle que soit sa casse', async () => {
    const { ref } = await importLutFile(cubeFile(IDENTITY_2, 'LOOK.CUBE'), deps());
    expect(ref.name).toBe('LOOK.CUBE');
  });

  it('décode une LUT image par la dépendance fournie', async () => {
    // HALD de niveau 2 : image 8×8, cube de 4.
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
    const d = deps({ decodeImage: vi.fn(async () => ({ data, width, height: width })) });
    const file = new File([new Uint8Array([1, 2, 3])], 'look.png', { type: 'image/png' });

    const { lut } = await importLutFile(file, d);

    expect(lut.size).toBe(cube);
    expect(d.decodeImage).toHaveBeenCalledTimes(1);
  });

  it('le champ de fichier n’annonce que ce que le parseur sait lire', () => {
    expect(LUT_ACCEPT.split(',')).toEqual(['.cube', '.png']);
  });
});

describe('importLutFile — refus', () => {
  it('refuse une extension inconnue en nommant celles qui marchent', async () => {
    const file = new File(['x'], 'look.3dl', { type: '' });
    await expect(importLutFile(file, deps())).rejects.toThrow(/\.cube/);
  });

  it('refuse un fichier trop lourd sans le lire', async () => {
    const big = new File(['x'.repeat(10)], 'look.cube', { type: '' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    await expect(importLutFile(big, deps())).rejects.toThrow(/Mo/);
  });

  it('ne téléverse RIEN quand le fichier ne se lit pas', async () => {
    const d = deps();
    await expect(importLutFile(cubeFile('LUT_3D_SIZE 2\n0 0 0\n'), d)).rejects.toThrow();
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('ne téléverse RIEN quand l’image n’est pas une LUT', async () => {
    const d = deps(); // 1×1 : aucune disposition de LUT n'a cette taille
    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    await expect(importLutFile(file, d)).rejects.toThrow();
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('remonte l’échec du téléversement plutôt que de rendre une référence vide', async () => {
    const d = deps({
      upload: vi.fn(async () => {
        throw new Error('PUT 403');
      }),
    });
    await expect(importLutFile(cubeFile(), d)).rejects.toThrow(/403/);
  });
});

/**
 * Téléversement réel — par le flux d'URL signée partagé avec les rushes.
 *
 * Un `.cube` n'a pas de type MIME connu du navigateur : `file.type` est vide,
 * et la route de signature refuse un `contentType` vide (400). Le module doit
 * donc en fournir un, sinon l'import échoue pour TOUT fichier `.cube`.
 */
describe('uploadLutFile', () => {
  beforeEach(() => {
    globalThis.XMLHttpRequest = class {
      upload = { onprogress: null };
      status = 200;
      responseText = '';
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      withCredentials = false;
      open() {}
      setRequestHeader() {}
      send() {
        setTimeout(() => this.onload?.(), 0);
      }
    } as unknown as typeof XMLHttpRequest;
  });

  function stubSignature() {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/upload/signed-url')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            signedUrl: 'https://minio.example/put',
            publicUrl: '/storage/v1/object/public/media/u/lut/1-look.cube',
            path: 'u/lut/1-look.cube',
            bucket: 'media',
            mode: 'proxy',
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('donne un type de contenu à un .cube qui n’en a pas', async () => {
    const fetchMock = stubSignature();
    const url = await uploadLutFile(new File([IDENTITY_2], 'look.cube', { type: '' }));

    expect(url).toBe('/storage/v1/object/public/media/u/lut/1-look.cube');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.contentType).toBe('application/octet-stream');
    expect(body.filename).toBe('look.cube');
  });

  it('range le fichier dans un dossier que la route accepte', async () => {
    const fetchMock = stubSignature();
    await uploadLutFile(new File([IDENTITY_2], 'look.cube', { type: '' }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.purpose).toBe(LUT_UPLOAD_PURPOSE);
    // Le même contrôle que fait la route : un dossier refusé ici le serait
    // là-bas, et l'import échouerait en 422 sans que rien dans ce module ne
    // l'explique.
    expect(purposeAcceptable(LUT_UPLOAD_PURPOSE)).toBe(true);
  });

  it('garde le type d’un PNG', async () => {
    const fetchMock = stubSignature();
    await uploadLutFile(new File([new Uint8Array([1])], 'look.png', { type: 'image/png' }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.contentType).toBe('image/png');
  });
});
