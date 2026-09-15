// @vitest-environment node
/**
 * AVATAR-2B — la SOURCE d'un avatar (le visage) ne sort plus par le relais
 * public de stockage ; les vidéos générées du même dossier, si.
 *
 * Ce que ce fichier prouve :
 * 1. `GET` et `HEAD` sur `media/<userId>/avatar/source-<ts>.<ext>` rendent
 *    404 SANS UN SEUL APPEL MinIO — la doublure compte les appels.
 * 2. Les formes encodées et de traversée sont refusées elles aussi.
 * 3. Le refus est indistinguable d'un objet absent (même code, même corps).
 * 4. RIEN d'autre ne bouge : `media/<userId>/avatar/<uuid>.mp4` (vidéo
 *    générée) et les rushes sont servis exactement comme avant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleSourceAvatarPrivee, cleDansNamespaceAvatar } from '@/lib/storage/acces-objet';
import { estCleSourceAvatar } from '@/lib/avatar/source-cle';

const etat = vi.hoisted(() => ({
  appels: [] as Array<{ methode: string; bucket: string; cle: string }>,
  taille: 4096,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'stat', bucket, cle });
      return { size: etat.taille, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'get', bucket, cle });
      return Readable.from([Buffer.alloc(etat.taille, 7)]);
    }
    async getPartialObject(bucket: string, cle: string, _debut: number, longueur: number) {
      etat.appels.push({ methode: 'partial', bucket, cle });
      return Readable.from([Buffer.alloc(longueur, 7)]);
    }
  }
  return { Client };
});

process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { GET: LIRE, HEAD: SONDER } = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);

const ORIGINE = 'https://studiio.pro';
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const GEN = '11111111-1111-4111-8111-000000000009';

function requete(chemin: string): never {
  return new Request(`${ORIGINE}${chemin}`) as never;
}
const lire = (bucket: string, segments: string[]) =>
  LIRE(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`), { params: Promise.resolve({ bucket, path: segments }) });
const sonder = (bucket: string, segments: string[]) =>
  SONDER(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`), { params: Promise.resolve({ bucket, path: segments }) });

beforeEach(() => { etat.appels.length = 0; });

describe('cleSourceAvatarPrivee — la règle canonique, sur toutes les formes', () => {
  it('reconnaît une source, pas une vidéo générée, pas un autre namespace, pas un autre bucket', () => {
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/source-1757000000000.jpg`)).toBe(true);
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/source-1.mp4`)).toBe(true);
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/source-1-${'c'.repeat(32)}.mp4`)).toBe(true);
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/source-1-${'c'.repeat(31)}.mp4`)).toBe(false);
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/${GEN}.mp4`)).toBe(false);
    expect(cleSourceAvatarPrivee('media', `${U}/rush/source-1.mp4`)).toBe(false);
    expect(cleSourceAvatarPrivee('videos', `${U}/avatar/source-1.mp4`)).toBe(false);
    expect(cleSourceAvatarPrivee('media', `${U}/avatar/source-1.exe`)).toBe(false);
  });

  it('les formes encodées (une ou deux fois) sont reconnues comme la clé nue', () => {
    expect(cleSourceAvatarPrivee('media', `${U}%2Favatar%2Fsource-1.jpg`)).toBe(true);
    expect(cleSourceAvatarPrivee('media', `${U}%252Favatar%252Fsource-1.jpg`)).toBe(true);
  });

  it('même règle que source-cle : aucune seconde regex', () => {
    for (const cle of [`${U}/avatar/source-1.jpg`, `${U}/avatar/${GEN}.mp4`, `${U}/avatar/source-1.txt`]) {
      expect(cleSourceAvatarPrivee('media', cle)).toBe(estCleSourceAvatar(cle) && cleDansNamespaceAvatar('media', cle));
    }
  });
});

describe('relais public — la source est refusée, GET et HEAD, avant MinIO', () => {
  const NONCE = 'c'.repeat(32);
  const SOURCES = [
    ['source-1757000000000.jpg'], ['source-1757000000000.mp4'], ['source-7.webm'], ['source-7.png'],
    // Le format AVATAR-2A, avec nonce : bloqué de la même façon.
    [`source-1757000000000-${NONCE}.jpg`], [`source-1757000000000-${NONCE}.mp4`],
  ];

  it('⚠️ GET source-<ts>.<ext> → 404, MinIO jamais appelé', async () => {
    for (const nom of SOURCES) {
      const res = await lire('media', [U, 'avatar', ...nom]);
      expect(res.status, nom.join()).toBe(404);
      expect(etat.appels).toEqual([]);
    }
  });

  it('⚠️ HEAD source-<ts>.<ext> → 404, MinIO jamais appelé', async () => {
    for (const nom of SOURCES) {
      const res = await sonder('media', [U, 'avatar', ...nom]);
      expect(res.status, nom.join()).toBe(404);
      expect(etat.appels).toEqual([]);
    }
  });

  it('forme encodée équivalente → 404, GET et HEAD', async () => {
    expect((await lire('media', [`${U}%2Favatar%2Fsource-1.jpg`])).status).toBe(404);
    expect((await sonder('media', [`${U}%2Favatar%2Fsource-1.jpg`])).status).toBe(404);
    expect((await lire('media', [U, 'avatar%2Fsource-1.jpg'])).status).toBe(404);
    expect(etat.appels).toEqual([]);
  });

  it('le refus est indistinguable d’un objet absent (même code, même corps)', async () => {
    const refus = await lire('media', [U, 'avatar', 'source-1.jpg']);
    const absent = await lire('media', [U, 'avatar', '..', 'x.jpg']);
    expect(refus.status).toBe(absent.status);
    expect(await refus.text()).toBe(await absent.text());
  });
});

describe('relais public — rien d’autre ne bouge', () => {
  it('⚠️ la vidéo GÉNÉRÉE `<userId>/avatar/<uuid>.mp4` reste servie (GET 200, HEAD 200)', async () => {
    const res = await lire('media', [U, 'avatar', `${GEN}.mp4`]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(etat.appels.map((a) => a.methode)).toContain('stat');
    etat.appels.length = 0;
    const head = await sonder('media', [U, 'avatar', `${GEN}.mp4`]);
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('4096');
  });

  it('un rush et une vignette de montage : servis comme avant', async () => {
    expect((await lire('media', [U, 'rush', 'clip.mp4'])).status).toBe(200);
    expect((await lire('videos', [U, 'export-1.mp4'])).status).toBe(200);
  });

  it('les namespaces déjà fermés le restent (analyse, lut, montage)', async () => {
    expect((await lire('media', [U, 'analyse', 'a1', 'vignette-01.jpg'])).status).toBe(404);
    expect((await lire('media', [U, 'lut', 'x.cube'])).status).toBe(404);
    expect((await lire('videos', [U, 'montages', 'm.mp4'])).status).toBe(404);
    expect(etat.appels).toEqual([]);
  });
});
