import { describe, it, expect, vi } from 'vitest';
import { importLutFile } from '@/lib/luts/import';

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

  it('remonte l’échec du téléversement plutôt que de rendre une référence vide', async () => {
    const d = deps({
      upload: vi.fn(async () => {
        throw new Error('PUT 403');
      }),
    });
    await expect(importLutFile(cubeFile(), d)).rejects.toThrow(/403/);
  });
});
