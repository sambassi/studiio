// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { deposerFichierMinio } from '@/lib/securite/medias-externes';

/**
 * Un envoi MinIO qui échoue AVANT de lire le fichier ne doit jamais laisser
 * un flux orphelin : le fichier temporaire est effacé juste après, et l'ENOENT
 * d'un flux sans écouteur ferait tomber le processus (exception non rattrapée,
 * vue en CI sur #546).
 */
describe('deposerFichierMinio', () => {
  it('putObject rejette sans lire le flux, fichier effacé ensuite : aucune exception non rattrapée', async () => {
    const fichier = path.join(os.tmpdir(), `studiio-test-depot-${process.pid}-${Date.now()}.mp4`);
    await writeFile(fichier, 'x');
    const nonRattrapees: unknown[] = [];
    const surErreur = (e: unknown) => { nonRattrapees.push(e); };
    process.on('uncaughtException', surErreur);
    try {
      const client = { putObject: async () => { throw new Error('minio indisponible'); } };
      await expect(deposerFichierMinio(client, 'media', 'externes/x.mp4', fichier, 1)).rejects.toThrow('minio indisponible');
      await unlink(fichier);
      // Laisse au flux le temps de tenter son ouverture différée.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('uncaughtException', surErreur);
    }
    expect(nonRattrapees).toEqual([]);
  });

  it('envoi réussi : le flux lu est bien celui du fichier', async () => {
    const fichier = path.join(os.tmpdir(), `studiio-test-depot-ok-${process.pid}-${Date.now()}.mp4`);
    await writeFile(fichier, 'abc');
    let lu = '';
    const client = {
      putObject: async (_b: string, _c: string, flux: NodeJS.ReadableStream) => {
        for await (const morceau of flux as AsyncIterable<Buffer>) lu += morceau.toString();
      },
    };
    await deposerFichierMinio(client, 'media', 'externes/x.mp4', fichier, 3);
    await unlink(fichier);
    expect(lu).toBe('abc');
  });
});
