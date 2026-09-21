import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadPosterFile, posterIndexForBatchItem, urlPubliqueAbsolue } from '@/lib/creer/posterUpload';

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

  /**
   * En production (`STORAGE_PROVIDER=s3`), la signature renvoie une
   * `publicUrl` RELATIVE (`/storage/v1/object/public/…`). Renvoyee telle
   * quelle, elle passait a l'ecran mais mourait au rechargement : le filtre
   * `^https?://` du brouillon la jetait, et la photo « perso » disparaissait.
   */
  it('publicUrl relative (S3/MinIO) : rendue absolue sur l origine de Studiio', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          success: true,
          signedUrl: 'https://storage.test/put',
          publicUrl: '/storage/v1/object/public/media/u1/image/1-a.jpg',
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 }));

    const res = await uploadPosterFile(file());

    // jsdom sert les tests depuis une origine http(s) reelle : on la lit
    // plutot que de la supposer.
    expect(window.location.origin).toMatch(/^https?:\/\//);
    expect(res).toEqual({
      url: `${window.location.origin}/storage/v1/object/public/media/u1/image/1-a.jpg`,
      dataUrl: false,
    });
    expect(/^https?:\/\//.test(res.url)).toBe(true);
  });

  it('publicUrl deja absolue : renvoyee inchangee', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ success: true, signedUrl: 'https://storage.test/put', publicUrl: 'https://cdn/x.jpg' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 }));

    const res = await uploadPosterFile(file());
    expect(res).toEqual({ url: 'https://cdn/x.jpg', dataUrl: false });
  });

  it('publicUrl inexploitable (javascript:) : repli data URL, avec la raison', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ success: true, signedUrl: 'https://storage.test/put', publicUrl: 'javascript:alert(1)' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 }));

    const res = await uploadPosterFile(file());

    expect(res.dataUrl).toBe(true);
    expect(res.url.startsWith('data:')).toBe(true);
    expect(res.reason).toBe('URL publique inexploitable');
  });
});

describe('urlPubliqueAbsolue — normalisation de l URL publique du stockage', () => {
  const ORIGIN = 'https://studiio.pro';

  it('chemin relatif : resolu contre l origine', () => {
    expect(urlPubliqueAbsolue('/storage/v1/object/public/media/u1/image/1-a.jpg', ORIGIN))
      .toBe('https://studiio.pro/storage/v1/object/public/media/u1/image/1-a.jpg');
    expect(urlPubliqueAbsolue('storage/v1/x.jpg', ORIGIN)).toBe('https://studiio.pro/storage/v1/x.jpg');
    // Les blancs autour ne comptent pas.
    expect(urlPubliqueAbsolue('  /storage/v1/x.jpg  ', ORIGIN)).toBe('https://studiio.pro/storage/v1/x.jpg');
  });

  it('URL absolue http(s) : inchangee, a l octet pres', () => {
    expect(urlPubliqueAbsolue('https://cdn/x.jpg', ORIGIN)).toBe('https://cdn/x.jpg');
    expect(urlPubliqueAbsolue('http://cdn.test/A%20b.jpg?x=1#f', ORIGIN)).toBe('http://cdn.test/A%20b.jpg?x=1#f');
    // Meme avec une origine differente : on ne re-ancre pas une absolue.
    expect(urlPubliqueAbsolue('https://cdn/x.jpg', 'http://localhost:3000')).toBe('https://cdn/x.jpg');
  });

  it('data:, blob:, javascript: et autres schemas : null', () => {
    for (const v of [
      'data:image/jpeg;base64,AAAA',
      'blob:https://studiio.pro/abc',
      'javascript:alert(1)',
      'mailto:x@y.z',
      'file:///etc/passwd',
    ]) {
      expect(urlPubliqueAbsolue(v, ORIGIN), v).toBeNull();
    }
  });

  it('vide, blancs, ou non-chaine : null', () => {
    expect(urlPubliqueAbsolue('', ORIGIN)).toBeNull();
    expect(urlPubliqueAbsolue('   ', ORIGIN)).toBeNull();
    expect(urlPubliqueAbsolue(undefined as unknown as string, ORIGIN)).toBeNull();
  });

  it('protocol-relative « //hote/x » : autre hote refuse, notre hote accepte', () => {
    // `//evil.com/x` est une absolue vers evil.com deguisee en chemin.
    expect(urlPubliqueAbsolue('//evil.com/x.jpg', ORIGIN)).toBeNull();
    expect(urlPubliqueAbsolue('//studiio.pro.evil.com/x.jpg', ORIGIN)).toBeNull();
    // Le meme hote que l'origine : c'est chez nous, on garde le schema de l'origine.
    expect(urlPubliqueAbsolue('//studiio.pro/storage/v1/x.jpg', ORIGIN)).toBe('https://studiio.pro/storage/v1/x.jpg');
    expect(urlPubliqueAbsolue('//localhost:3000/x.jpg', 'http://localhost:3000')).toBe('http://localhost:3000/x.jpg');
    // Port different = hote different.
    expect(urlPubliqueAbsolue('//localhost:4000/x.jpg', 'http://localhost:3000')).toBeNull();
  });

  it('origine invalide ou non http(s) : null plutot qu une URL fantaisiste', () => {
    expect(urlPubliqueAbsolue('/storage/v1/x.jpg', '')).toBeNull();
    expect(urlPubliqueAbsolue('/storage/v1/x.jpg', 'null')).toBeNull();
    expect(urlPubliqueAbsolue('/storage/v1/x.jpg', 'file:///tmp')).toBeNull();
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
