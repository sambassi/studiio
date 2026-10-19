import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PR-B — PROTÉGER LES RENDUS PAYÉS CONTRE L'ÉCRASEMENT.
 *
 * `PUT /api/storage/upload` lit `bucket` et `path` dans la chaîne de requête.
 * Sa seule garde était `path.startsWith(uid + '/')` : un compte pouvait donc
 * RÉÉCRIRE `<uid>/rendus/<id>.webm`, la preuve d'un rendu confirmé et facturé
 * (démontré par la QA : 14 976 890 o → 720 o, ligne restée `confirmed`), et de
 * même ses vignettes d'analyse, ses LUT, la source de son avatar, ses
 * conversions.
 *
 * Les routes sont appelées pour de vrai, sur un stockage simulé qui
 * journalise : la preuve qu'une garde mord, c'est que MinIO n'a PAS été
 * écrit — et que l'objet payé est resté octet pour octet.
 */

const etat = vi.hoisted(() => ({
  objets: new Map<string, Buffer>(),
  journal: [] as Array<{ op: string; bucket: string; cle: string }>,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async putObject(bucket: string, cle: string, flux: unknown) {
      etat.journal.push({ op: 'put', bucket, cle });
      const morceaux: Buffer[] = [];
      for await (const m of flux as AsyncIterable<Buffer>) morceaux.push(Buffer.from(m));
      etat.objets.set(`${bucket}/${cle}`, Buffer.concat(morceaux));
      return { etag: 'e' };
    }
    async statObject(bucket: string, cle: string) {
      const o = etat.objets.get(`${bucket}/${cle}`);
      if (!o) throw Object.assign(new Error('Not found'), { code: 'NoSuchKey' });
      return { size: o.length, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      return Readable.from([etat.objets.get(`${bucket}/${cle}`) ?? Buffer.alloc(0)]);
    }
    async initiateNewMultipartUpload(bucket: string, cle: string) {
      etat.journal.push({ op: 'initiate', bucket, cle });
      return 'upload-1';
    }
    async presignedUrl(_m: string, bucket: string, cle: string) {
      etat.journal.push({ op: 'presigne-part', bucket, cle });
      return `https://minio.test/${bucket}/${cle}?part`;
    }
    async presignedPutObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'presigne', bucket, cle });
      return `https://minio.test/${bucket}/${cle}?signature=x`;
    }
    async completeMultipartUpload(bucket: string, cle: string) {
      etat.journal.push({ op: 'complete', bucket, cle });
      return { etag: 'e' };
    }
    async abortMultipartUpload(bucket: string, cle: string) {
      etat.journal.push({ op: 'abort', bucket, cle });
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

process.env.STORAGE_PROVIDER = 's3';
process.env.MINIO_SECRET_KEY = 'secret-de-test';
delete process.env.MINIO_PUBLIC_ENDPOINT;

const { PUT } = await import('@/app/api/storage/upload/route');
const signe = await import('@/app/api/upload/signed-url/route');
const multipart = await import('@/app/api/upload/multipart/route');
const morceau = await import('@/app/api/upload/multipart/part/route');
const { purposeAcceptable, cleEnvoiGeneriqueAcceptable } = await import('@/lib/storage/acces-objet');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const PAYE = Buffer.alloc(4096, 7); // le rendu confirmé, tel que payé

function connecter(uid: string) { session.courante = { user: { id: uid } }; }

async function envoyer(bucket: string, path: string, corps = Buffer.from('ECRASE')): Promise<Response> {
  const url = `https://studiio.pro/api/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
  return PUT(new Request(url, {
    method: 'PUT', body: corps, headers: { 'content-type': 'video/webm' },
    // @ts-expect-error — option Node pour un corps en flux
    duplex: 'half',
  }) as never);
}

/** Envoi brut : la chaîne de requête est passée telle quelle (formes encodées). */
async function envoyerBrut(requete: string): Promise<Response> {
  return PUT(new Request(`https://studiio.pro/api/storage/upload?${requete}`, {
    method: 'PUT', body: Buffer.from('ECRASE'),
    // @ts-expect-error — option Node pour un corps en flux
    duplex: 'half',
  }) as never);
}

beforeEach(() => {
  etat.objets.clear();
  etat.journal.length = 0;
  etat.objets.set(`media/${A}/rendus/r-a.webm`, PAYE);
  etat.objets.set(`media/${B}/rendus/r-b.webm`, PAYE);
  session.courante = null;
});

describe('Un rendu confirmé ne peut plus être réécrit par l envoi générique (PUT)', () => {
  it('B ne peut pas écraser le rendu confirmé de A', async () => {
    connecter(B);
    const r = await envoyer('media', `${A}/rendus/r-a.webm`);
    expect(r.status).toBe(403);
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
    expect(etat.objets.get(`media/${A}/rendus/r-a.webm`)).toEqual(PAYE);
  });

  it('DISCRIMINANT — B ne peut pas écraser SON PROPRE rendu confirmé', async () => {
    connecter(B);
    const r = await envoyer('media', `${B}/rendus/r-b.webm`);
    expect(r.status).toBe(403);
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
    expect(etat.objets.get(`media/${B}/rendus/r-b.webm`)).toEqual(PAYE);
  });

  it('même refus dans tous les compartiments autorisés', async () => {
    connecter(B);
    for (const bucket of ['media', 'videos', 'audio', 'images']) {
      expect((await envoyer(bucket, `${B}/rendus/r-b.webm`)).status, bucket).toBe(403);
    }
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
  });

  it.each([
    ['converted', `${'B'}/converted/converted_1760000000000.mp4`],
    ['analyse', `${'B'}/analyse/an-1/vignette-01.jpg`],
    ['lut', `${'B'}/lut/abc.cube`],
    ['avatar', `${'B'}/avatar/source-1760000000000.jpg`],
    ['avatar (vidéo générée)', `${'B'}/avatar/1760000000000-x.mp4`],
    ['montages', `${'B'}/autopilote/montages/m1/montage.mp4`],
    ['autopilote', `${'B'}/autopilote-job1.mp4`],
    ['couvertures', `${'B'}/couvertures/frame_1760000000000.jpg`],
    ['rendus horodaté', `${'B'}/rendus/1760000000000-x.webm`],
  ])('espace réservé « %s » refusé', async (_nom, modele) => {
    connecter(B);
    const r = await envoyer('media', modele.replace(/^B\//, `${B}/`));
    expect(r.status).toBe(403);
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
  });

  it.each([
    ['..', `${B}/rush/../rendus/r-b.webm`],
    ['.. vers un autre compte', `${B}/../${A}/rendus/r-a.webm`],
    ['%2e%2e', `${B}/rush/%2e%2e/rendus/r-b.webm`],
    ['%2f', `${B}/rush%2frendus/r-b.webm`],
    ['%252f (double encodage)', `${B}/rush%252frendus/r-b.webm`],
    ['casse Rendus', `${B}/Rendus/1760000000000-x.webm`],
    ['casse RENDUS', `${B}/RENDUS/1760000000000-x.webm`],
    ['//', `${B}//rendus/r-b.webm`],
    ['segment vide final', `${B}/rush/`],
    ['segment imbriqué', `${B}/rush/x/rendus/r-b.webm`],
    ['antislash', `${B}/rush\\..\\rendus/r-b.webm`],
    ['schéma', `${B}/rush/https://x`],
    ['préfixe voisin', `${B}x/rush/1760000000000-a.mp4`],
    ['clé déterministe d un purpose légitime', `${B}/image/gen-1-affiche-ia.png`],
  ])('forme « %s » refusée', async (_nom, path) => {
    connecter(B);
    const r = await envoyer('media', path);
    expect(r.status).toBe(403);
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
  });

  it('formes encodées brutes dans la chaîne de requête (%2e / %2f / %25)', async () => {
    connecter(B);
    for (const q of [
      `bucket=media&path=${B}%2Frush%2F..%2Frendus%2Fr-b.webm`,
      `bucket=media&path=${B}%2F%2e%2e%2F${A}%2Frendus%2Fr-a.webm`,
      `bucket=media&path=${B}%2Frush%252F..%252Frendus%2Fr-b.webm`,
    ]) {
      expect((await envoyerBrut(q)).status, q).toBe(403);
    }
    expect(etat.journal.filter((j) => j.op === 'put')).toEqual([]);
  });

  it('autre compte : toujours 403 (inchangé)', async () => {
    connecter(B);
    expect((await envoyer('media', `${A}/rush/1760000000000-a.mp4`)).status).toBe(403);
  });

  it('sans session : 401 (inchangé)', async () => {
    expect((await envoyer('media', `${B}/rush/1760000000000-a.mp4`)).status).toBe(401);
  });
});

describe('Le PUT applique `purposeAcceptable`, comme les routes POST', () => {
  it('purposeAcceptable refuse les espaces réservés, sans casse', () => {
    for (const p of ['rendus', 'converted', 'analyse', 'lut', 'avatar', 'montages', 'autopilote',
      'couvertures', 'fiches-contenu', 'Rendus', 'CONVERTED', 'Analyse', '%2e%2e', 'rush%2frendus']) {
      expect(purposeAcceptable(p), p).toBe(false);
    }
  });

  it('le POST signed-url refuse purpose « rendus » / « converted » — rien n est délivré', async () => {
    connecter(B);
    for (const purpose of ['rendus', 'converted', 'Rendus', 'montages', 'couvertures']) {
      const res = await signe.POST(new Request('https://studiio.pro/api/upload/signed-url', {
        method: 'POST',
        body: JSON.stringify({ filename: 'x.webm', contentType: 'video/webm', purpose }),
      }) as never);
      expect(res.status, purpose).toBe(422);
    }
  });
});

describe('Multipart : les clés venues de la requête suivent la même règle', () => {
  it('initiate refuse purpose « rendus » : aucun envoi initié', async () => {
    connecter(B);
    const res = await multipart.POST(new Request('https://studiio.pro/api/upload/multipart', {
      method: 'POST',
      body: JSON.stringify({ action: 'initiate', filename: 'x.webm', contentType: 'video/webm', purpose: 'rendus' }),
    }) as never);
    expect(res.status).toBe(422);
    expect(etat.journal.filter((j) => j.op === 'initiate')).toEqual([]);
  });

  it('sign-part / complete refusent une clé sous rendus/', async () => {
    connecter(B);
    for (const action of ['sign-part', 'complete']) {
      const res = await multipart.POST(new Request('https://studiio.pro/api/upload/multipart', {
        method: 'POST',
        body: JSON.stringify({
          action, bucket: 'media', key: `${B}/rendus/r-b.webm`, uploadId: 'u', partNumber: 1,
          parts: [{ PartNumber: 1, ETag: 'e' }],
        }),
      }) as never);
      expect(res.status, action).toBe(403);
    }
    expect(etat.journal.filter((j) => j.op === 'complete')).toEqual([]);
  });

  it('le relais de morceau refuse une clé sous rendus/', async () => {
    connecter(B);
    const q = new URLSearchParams({ bucket: 'media', key: `${B}/rendus/r-b.webm`, uploadId: 'u', partNumber: '1' });
    const { NextRequest } = await import('next/server');
    const res = await morceau.PUT(new NextRequest(`https://studiio.pro/api/upload/multipart/part?${q}`, {
      method: 'PUT', body: Buffer.from('x'),
      // @ts-expect-error — option Node pour un corps en flux
      duplex: 'half',
    }));
    expect(res.status).toBe(403);
  });

  it('NON-RÉGRESSION — initiate puis sign-part sur la clé délivrée passe', async () => {
    connecter(B);
    const ini = await multipart.POST(new Request('https://studiio.pro/api/upload/multipart', {
      method: 'POST',
      body: JSON.stringify({ action: 'initiate', filename: 'Gros Rush.mp4', contentType: 'video/mp4', purpose: 'rush' }),
    }) as never);
    expect(ini.status).toBe(200);
    const { key, bucket, uploadId } = await ini.json() as { key: string; bucket: string; uploadId: string };
    const sp = await multipart.POST(new Request('https://studiio.pro/api/upload/multipart', {
      method: 'POST',
      body: JSON.stringify({ action: 'sign-part', bucket, key, uploadId, partNumber: 1 }),
    }) as never);
    expect(sp.status).toBe(200);
  });
});

describe('NON-RÉGRESSION — envois légitimes : signed-url puis PUT vers la signedUrl rendue', () => {
  // Les `purpose` réellement envoyés par le navigateur (git grep) : Créer /
  // Autopilote (rush, music, voice, montage), Calendrier Import (rush,
  // thumbnail), Infographie (logo, poster), affiche (image), Médiathèque
  // (library), détecteur de clips (clip), conversion du Bureau (convert),
  // admin landing (demo), et le défaut (absent → rush).
  it.each([
    ['rush', 'video/mp4', 'Mon Rush (final).mp4'],
    ['music', 'audio/mpeg', 'Musique été.mp3'],
    ['voice', 'audio/webm', 'voix.webm'],
    ['thumbnail', 'image/jpeg', 'thumb.jpg'],
    ['image', 'image/png', 'affiche.png'],
    ['library', 'video/mp4', 'clip.mp4'],
    ['logo', 'image/png', 'logo.png'],
    ['poster', 'image/png', 'poster.png'],
    ['clip', 'video/mp4', 'clip.mp4'],
    ['montage', 'video/mp4', 'montage.mp4'],
    ['convert', 'video/webm', 'export.webm'],
    ['demo', 'video/mp4', 'demo.mp4'],
    [undefined, 'video/mp4', 'sans-purpose.mp4'],
  ])('purpose « %s » : la clé délivrée est acceptée par le PUT', async (purpose, contentType, filename) => {
    connecter(B);
    const res = await signe.POST(new Request('https://studiio.pro/api/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({ filename, contentType, ...(purpose ? { purpose } : {}) }),
    }) as never);
    expect(res.status).toBe(200);
    const { signedUrl, mode, path, bucket } = await res.json() as {
      signedUrl: string; mode: string; path: string; bucket: string;
    };
    expect(mode).toBe('proxy');
    const put = await PUT(new Request(`https://studiio.pro${signedUrl}`, {
      method: 'PUT', body: Buffer.from('OCTETS'),
      // @ts-expect-error — option Node pour un corps en flux
      duplex: 'half',
    }) as never);
    expect(put.status).toBe(200);
    expect(etat.objets.get(`${bucket}/${path}`)?.toString()).toBe('OCTETS');
  });

  it('cleEnvoiGeneriqueAcceptable accepte la forme délivrée, et elle seule', () => {
    expect(cleEnvoiGeneriqueAcceptable(`${B}/rush/1760000000000-mon_rush.mp4`, B)).toBe(true);
    expect(cleEnvoiGeneriqueAcceptable(`${B}/rush/1760000000000-mon_rush.mp4`, A)).toBe(false);
    expect(cleEnvoiGeneriqueAcceptable(`${B}/rendus/1760000000000-x.webm`, B)).toBe(false);
    expect(cleEnvoiGeneriqueAcceptable(`${B}/rush/123-x.mp4`, B)).toBe(false);
  });
});

describe('NON-RÉGRESSION — le flux légitime de rendu ne passe PAS par l envoi générique', () => {
  const lire = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');

  it('jobs → upload réservé → confirm : chemin dédié, intact', () => {
    // Le relais du rendu écrit l'objet de SA ligne `rendus` (bucket + clé lus en
    // base), il ne dépend pas de la garde générique.
    const relais = lire('src/app/api/render/jobs/[id]/upload/route.ts');
    expect(relais).toContain('export async function PUT');
    expect(relais).not.toContain('cleEnvoiGeneriqueAcceptable');
    expect(lire('src/lib/rendus/cible-upload.ts')).not.toContain('/api/storage/upload?');
    expect(lire('src/lib/rendus/service.ts')).toContain('`${userId}/rendus/${id}.webm`');
  });

  it('avatar source et LUT gardent leur route dédiée (pas l envoi générique)', () => {
    expect(lire('src/lib/luts/import.ts')).toContain('Jamais `/api/upload/signed-url`');
  });
});
