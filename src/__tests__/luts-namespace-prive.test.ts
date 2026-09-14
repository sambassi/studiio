import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleDansNamespaceLut, cleDansNamespaceAnalyse, cleDansNamespaceMontage,
  purposeAcceptable, SEGMENT_NAMESPACE_LUT, BUCKET_NAMESPACE_LUT,
} from '@/lib/storage/acces-objet';
import { cleLutAsset, SEGMENT_LUT } from '@/lib/luts/bibliotheque';

/**
 * Le namespace PRIVÉ des LUT importées.
 *
 * Une LUT importée vit sous `<userId>/lut/<empreinte>.cube` dans `media`. Ce
 * chemin est refusé à la LECTURE par le relais public (un look est un
 * travail privé, jamais un lien permanent) et à l'ÉCRITURE par les routes
 * d'envoi génériques (seule la route de la bibliothèque, à venir, construit
 * cette clé — le navigateur ne la choisit pas).
 *
 * La preuve qu'une garde mord : MinIO n'est pas interrogé du tout. Les
 * routes sont appelées pour de vrai, sur un stockage simulé qui journalise.
 */

const etat = vi.hoisted(() => ({
  objets: new Map<string, Buffer>(),
  journal: [] as Array<{ op: string; bucket: string; cle: string }>,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  const lire = (bucket: string, cle: string): Buffer => {
    const octets = etat.objets.get(`${bucket}/${cle}`);
    if (!octets) throw Object.assign(new Error('Not found'), { code: 'NoSuchKey' });
    return octets;
  };
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'stat', bucket, cle });
      return { size: lire(bucket, cle).length, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'objet', bucket, cle });
      return Readable.from([lire(bucket, cle)]);
    }
    async getPartialObject(bucket: string, cle: string, debut: number, longueur: number) {
      etat.journal.push({ op: 'partiel', bucket, cle });
      return Readable.from([lire(bucket, cle).subarray(debut, debut + longueur)]);
    }
    async presignedPutObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'presigne', bucket, cle });
      return `https://minio.test/${bucket}/${cle}?signature=x`;
    }
  }
  return { Client };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => session.courante,
  DEV_AUTH_BYPASS: false,
}));
vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: { storage: { from: () => ({}) } },
}));

// Lues AU CHARGEMENT du module de route : posées avant.
process.env.STORAGE_PROVIDER = 's3';
process.env.MINIO_SECRET_KEY = 'secret-de-test';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const relais = await import('@/app/storage/v1/object/public/[bucket]/[...path]/route');
type Contexte = { params: Promise<{ bucket: string; path: string[] }> };
type Gestionnaire = (req: unknown, ctx: Contexte) => Promise<Response>;
const GET = relais.GET as unknown as Gestionnaire;
const HEAD = relais.HEAD as unknown as Gestionnaire;

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const E = 'c'.repeat(64);
const CLE_LUT = cleLutAsset(U, E);

const requete = (bucket: string, cle: string) =>
  new Request(`https://studiio.pro/storage/v1/object/public/${bucket}/${cle}`);
const contexte = (bucket: string, cle: string): Contexte =>
  ({ params: Promise.resolve({ bucket, path: cle.split('/') }) });

beforeEach(() => {
  etat.objets.clear();
  etat.journal.length = 0;
  etat.objets.set(`media/${CLE_LUT}`, Buffer.from('LUT_3D_SIZE 2\n'));
  etat.objets.set(`media/${U}/rush/1-a.mp4`, Buffer.from('mp4'));
  session.courante = { user: { id: U } };
});

describe('1. Le namespace', () => {
  it('1.1 ⚠️ la clé d’une LUT est dans le namespace refusé — même segment des deux côtés', () => {
    expect(SEGMENT_LUT).toBe(SEGMENT_NAMESPACE_LUT);
    expect(cleDansNamespaceLut(BUCKET_NAMESPACE_LUT, CLE_LUT)).toBe(true);
  });

  it('1.2 ne mord pas sur les autres compartiments ni sur les voisins de `media`', () => {
    expect(cleDansNamespaceLut('videos', CLE_LUT)).toBe(false);
    expect(cleDansNamespaceLut('media', `${U}/rush/lut.cube`)).toBe(false);
    expect(cleDansNamespaceLut('media', `${U}/luts/x.cube`)).toBe(false);
  });

  it('1.3 ⚠️ les formes encodées sont couvertes', () => {
    for (const cle of [`${U}/%6cut/${E}.cube`, `${U}/lut%2F${E}.cube`, `${U}/lut/sous/${E}.cube`]) {
      expect(cleDansNamespaceLut('media', cle), cle).toBe(true);
    }
  });

  it('1.4 les namespaces voisins n’ont pas bougé', () => {
    expect(cleDansNamespaceAnalyse('media', `${U}/analyse/a1/v.jpg`)).toBe(true);
    expect(cleDansNamespaceMontage('videos', `${U}/montages/m1.mp4`)).toBe(true);
  });
});

describe('2. Le relais public refuse une LUT — avant tout appel au stockage', () => {
  it('2.1 GET → 404, MinIO jamais interrogé', async () => {
    const res = await GET(requete('media', CLE_LUT), contexte('media', CLE_LUT));
    expect(res.status).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  it('2.2 HEAD → 404, MinIO jamais interrogé', async () => {
    const res = await HEAD(requete('media', CLE_LUT), contexte('media', CLE_LUT));
    expect(res.status).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  it('2.3 la forme encodée ne contourne pas le refus', async () => {
    const cle = `${U}/%6cut/${E}.cube`;
    const res = await GET(requete('media', cle), contexte('media', cle));
    expect(res.status).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  it('2.4 un rush du même compte passe toujours — la garde ne mord que le namespace', async () => {
    const cle = `${U}/rush/1-a.mp4`;
    const res = await GET(requete('media', cle), contexte('media', cle));
    expect(res.status).toBe(200);
    expect(etat.journal.some((j) => j.cle === cle)).toBe(true);
  });
});

describe('3. On refuse à l’écriture ce qu’on refuse à la lecture', () => {
  it('3.1 purposeAcceptable("lut") est faux ; les autres passent', () => {
    expect(purposeAcceptable('lut')).toBe(false);
    expect(purposeAcceptable('rush')).toBe(true);
    expect(purposeAcceptable('library')).toBe(true);
    expect(purposeAcceptable('image')).toBe(true);
  });

  it('3.2 ⚠️ /api/upload/signed-url refuse purpose "lut" en 422, sans délivrer de clé', async () => {
    delete process.env.MINIO_PUBLIC_ENDPOINT;
    const { POST } = await import('@/app/api/upload/signed-url/route');
    const res = await POST(new Request('https://studiio.pro/api/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({ filename: 'look.cube', contentType: 'application/octet-stream', purpose: 'lut' }),
    }) as never);
    expect(res.status).toBe(422);
    const corps = await res.json() as { success: boolean; path?: string };
    expect(corps.success).toBe(false);
    expect(corps.path).toBeUndefined();
    expect(etat.journal.filter((j) => j.op === 'presigne')).toEqual([]);
  });
});
