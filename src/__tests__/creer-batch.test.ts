import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadPosterFile, posterIndexForBatchItem } from '@/lib/creer/posterUpload';

/**
 * Envoi d'une affiche locale et rotation des affiches d'un lot.
 *
 * L'enjeu du premier bloc n'est pas « l'upload marche » : c'est qu'aucun data
 * URL ne rentre dans le pool par le chemin nominal. Un data URL y ferait
 * exploser le quota localStorage de l'auto-sauvegarde, en silence.
 */

const file = (name = 'affiche.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

const okSign = {
  ok: true,
  status: 200,
  json: async () => ({ success: true, signedUrl: 'https://storage.test/put', publicUrl: 'https://cdn.test/affiche.jpg' }),
};

describe('Envoi d une affiche locale', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renvoie l URL publique du stockage, jamais un data URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okSign)                       // signature
      .mockResolvedValueOnce({ ok: true, status: 200 });   // PUT
    vi.stubGlobal('fetch', fetchMock);

    const res = await uploadPosterFile(file());

    expect(res).toEqual({ url: 'https://cdn.test/affiche.jpg', dataUrl: false });
    expect(res.url.startsWith('data:')).toBe(false);
  });

  it('demande la signature avec le nom et le type reels du fichier', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okSign)
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await uploadPosterFile(file('photo bébé.png', 'image/png'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/upload/signed-url');
    expect(JSON.parse(init.body)).toEqual({
      filename: 'photo bébé.png',
      contentType: 'image/png',
      purpose: 'image',
    });
    // Le fichier part ensuite en PUT vers l'URL signee, pas vers notre API.
    expect(fetchMock.mock.calls[1][0]).toBe('https://storage.test/put');
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
  });

  it('signature refusee : repli sur data URL, signale a l appelant', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ success: false, error: 'stockage indisponible' }),
    }));

    const res = await uploadPosterFile(file());

    // Le repli existe pour ne pas regresser : avant, l'upload aboutissait
    // toujours. Mais il doit se DIRE, pour que l'UI previenne l'utilisateur.
    expect(res.dataUrl).toBe(true);
    expect(res.url.startsWith('data:')).toBe(true);
    expect(res.reason).toContain('stockage indisponible');
  });

  it('PUT refuse : repli egalement', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okSign)
      .mockResolvedValueOnce({ ok: false, status: 403 }));

    const res = await uploadPosterFile(file());

    expect(res.dataUrl).toBe(true);
    expect(res.reason).toContain('403');
  });

  it('reseau coupe : repli, et surtout aucune exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(uploadPosterFile(file())).resolves.toMatchObject({ dataUrl: true });
  });

  it('reponse de signature incomplete : repli plutot qu URL vide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ success: true, signedUrl: 'https://storage.test/put' }), // publicUrl manquante
    }));

    const res = await uploadPosterFile(file());
    expect(res.dataUrl).toBe(true);
  });
});

describe('Rotation des affiches dans un lot', () => {
  it('donne une affiche differente a chaque video et ne repete jamais deux fois de suite', () => {
    for (const poolSize of [2, 3, 5, 7]) {
      const picked = Array.from({ length: 30 }, (_, b) => posterIndexForBatchItem(b, poolSize));
      for (let i = 1; i < picked.length; i++) {
        expect({ poolSize, i, prev: picked[i - 1], cur: picked[i] })
          .not.toEqual({ poolSize, i, prev: picked[i - 1], cur: picked[i - 1] });
      }
      // Et le pool est reellement parcouru, pas bloque sur les deux premieres.
      expect(new Set(picked).size).toBe(poolSize);
    }
  });

  it('respecte un choix explicite de l utilisateur, y compris « sans photo »', () => {
    expect(posterIndexForBatchItem(3, 5, 2)).toBe(2);
    expect(posterIndexForBatchItem(3, 5, -1)).toBe(-1);
  });

  it('pool vide : aucune affiche, pas de modulo par zero', () => {
    expect(posterIndexForBatchItem(0, 0)).toBe(-1);
    expect(posterIndexForBatchItem(7, 0)).toBe(-1);
  });

  it('pool d une seule photo : repetition assumee, sans plantage', () => {
    expect(posterIndexForBatchItem(0, 1)).toBe(0);
    expect(posterIndexForBatchItem(29, 1)).toBe(0);
  });
});
