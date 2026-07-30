import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadLut, clearLutCache } from '@/lib/luts/load';

/**
 * Chargement d'une LUT depuis son URL.
 *
 * L'aperçu et le compositeur chargent la MÊME LUT : le cache n'est pas un
 * confort, c'est ce qui évite de retélécharger 6 Mo à chaque rendu. Mais un
 * échec ne doit jamais être mis en cache — il condamnerait la LUT pour toute
 * la session, y compris après le retour du réseau.
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

const okText = (text: string) =>
  ({ ok: true, status: 200, text: async () => text }) as unknown as Response;

beforeEach(() => clearLutCache());

describe('loadLut', () => {
  it('charge et lit un .cube', async () => {
    const fetchFn = vi.fn(async () => okText(IDENTITY_2));
    const lut = await loadLut('https://minio.example/luts/x.cube', { fetchFn });
    expect(lut.size).toBe(2);
  });

  it('passe par le proxy pour une URL distante', async () => {
    // Sans proxy, la requête part en cross-origin sur MinIO et se prend le CORS.
    const seen: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return okText(IDENTITY_2);
    });
    await loadLut('https://minio.example/luts/x.cube', { fetchFn });
    expect(seen[0]).toContain('/api/proxy-media?url=');
  });

  it('ne retélécharge pas la même LUT', async () => {
    const fetchFn = vi.fn(async () => okText(IDENTITY_2));
    const url = 'https://minio.example/luts/x.cube';
    await loadLut(url, { fetchFn });
    await loadLut(url, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ne met PAS un échec en cache', async () => {
    // Mis en cache, il condamnerait la LUT pour toute la session — y compris
    // une fois le réseau revenu.
    let attempt = 0;
    const fetchFn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('réseau');
      return okText(IDENTITY_2);
    });
    const url = 'https://minio.example/luts/x.cube';
    await expect(loadLut(url, { fetchFn })).rejects.toThrow(/réseau/);
    const lut = await loadLut(url, { fetchFn });
    expect(lut.size).toBe(2);
  });

  it('remonte un statut HTTP en erreur plutôt que de lire le corps', async () => {
    const fetchFn = vi.fn(
      async () => ({ ok: false, status: 404, text: async () => 'Not found' }) as unknown as Response,
    );
    await expect(loadLut('https://x/y.cube', { fetchFn })).rejects.toThrow(/404/);
  });

  it('décode une LUT image par la dépendance fournie', async () => {
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
    const fetchFn = vi.fn(
      async () => ({ ok: true, status: 200, blob: async () => new Blob() }) as unknown as Response,
    );
    const decodeImage = vi.fn(async () => ({ data, width, height: width }));

    const lut = await loadLut('https://x/look.png', { fetchFn, decodeImage });

    expect(lut.size).toBe(cube);
    expect(decodeImage).toHaveBeenCalledTimes(1);
  });
});
