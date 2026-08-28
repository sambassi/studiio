/**
 * Le montage part en HTTPS, vers la clé du serveur — et nulle part ailleurs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI S'ETAIT PASSE EN PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Composition reussie, WebM de 8,5 Mo, 65 fragments — puis Chrome :
 *
 *   Mixed Content: The page at https://studiio.pro/dashboard/creer requested
 *   an insecure resource http://studiio-minio:9000/... This request has been
 *   blocked.
 *
 * `/api/render/jobs` signait l'URL d'envoi avec le client Supabase, dont
 * l'endpoint est le nom Docker du conteneur MinIO. Aucun debit, aucun post,
 * et huit megaoctets composes pour rien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CES TESTS PROTEGENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ils appellent les VRAIS gestionnaires de route. Une assertion sur la
 * source dirait qu'une garde est ecrite ; elle ne dirait pas ce que la route
 * repond quand une variable d'environnement est mal remplie — or c'est
 * exactement ce qui est arrive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  urlSortieSure, urlRelais, urlPubliqueRendu, cibleTeleversement,
  typeTeleversementAutorise, TAILLE_MAXIMALE, PRESIGNE_TTL_S,
} from '@/lib/rendus/cible-upload';

// ── Doublures ────────────────────────────────────────────────────────────

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** La tentative telle qu'elle vit en base. Les tests la reglent. */
let ligneRendu: Record<string, unknown> | null;
let socleAbsent = false;
const cloturesRpc: Array<{ etat: string; motif: string }> = [];
const reservations: Array<Record<string, unknown>> = [];

vi.mock('@/lib/rendus/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rendus/service')>('@/lib/rendus/service');
  return {
    ...actual,
    lireRendu: async () => ({ rendu: ligneRendu, socleAbsent }),
    cloreRendu: async (_u: string, _i: string, etat: string, motif: string) => {
      cloturesRpc.push({ etat, motif });
      return { ok: true, etat };
    },
    reserverRendu: async (userId: string, operation: string, format: string) => {
      reservations.push({ userId, operation, format });
      return {
        rendu: {
          id: 'job-1', bucket: 'media', cle: 'moi/rendus/job-1.webm',
          cout: 10, format, operation, politique: 'credits',
        },
        motif: null,
      };
    },
  };
});

/** Ce que MinIO fait quand on lui ecrit. */
let putEchoue = false;
let statEchoue = false;
const ecritures: Array<{ bucket: string; cle: string; taille?: number; entetes?: unknown }> = [];
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    putObject: async (bucket: string, cle: string, _f: unknown, taille?: number, entetes?: unknown) => {
      if (putEchoue) throw new Error('MinIO refuse');
      ecritures.push({ bucket, cle, taille, entetes });
      return {};
    },
    statObject: async () => {
      if (statEchoue) throw new Error('NoSuchKey');
      return { size: 2_000_000, metaData: { 'content-type': 'video/webm' } };
    },
  }),
  signeurPublic: () => signeurCourant,
}));

let signeurCourant: { presignedPutObject: (b: string, c: string, t: number) => Promise<string> } | null = null;

const { POST: RESERVER } = await import('@/app/api/render/jobs/route');
const { PUT: TELEVERSER } = await import('@/app/api/render/jobs/[id]/upload/route');

const reserver = async (body: unknown = { operation: 'calendrier', format: 'reel' }) => {
  const res = await RESERVER({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const televerser = async (opts: {
  id?: string; contentType?: string; longueur?: number; corps?: unknown;
} = {}) => {
  const entetes = new Map<string, string>([
    ['content-type', opts.contentType ?? 'video/webm'],
    ['content-length', String(opts.longueur ?? 2_000_000)],
  ]);
  /** Un vrai flux web : c'est ce que la route convertit pour MinIO. */
  const flux = () => new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
  });
  const req = {
    headers: { get: (k: string) => entetes.get(k.toLowerCase()) ?? null },
    body: 'corps' in opts ? opts.corps : flux(),
  };
  const res = await TELEVERSER(req as never, { params: { id: opts.id ?? 'job-1' } });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
  ligneRendu = {
    id: 'job-1', user_id: 'moi', bucket: 'media', cle_objet: 'moi/rendus/job-1.webm',
    etat: 'reserved', cout: 10, format: 'reel', operation: 'calendrier', politique: 'credits',
  };
  socleAbsent = false;
  putEchoue = false;
  statEchoue = false;
  signeurCourant = null;
  cloturesRpc.length = 0;
  ecritures.length = 0;
  reservations.length = 0;
  delete process.env.PUBLIC_STORAGE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});
afterEach(() => { vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// 1 & 2. La garde de sortie, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('1 & 2. Aucune adresse interne, aucun http, ne sort du serveur', () => {
  it("refuse l'URL exacte qui a bloque la production", () => {
    expect(urlSortieSure('http://studiio-minio:9000/media/moi/rendus/x.webm')).toBe(false);
  });

  it('refuse le meme hote meme en https — il reste irresolvable dehors', () => {
    expect(urlSortieSure('https://studiio-minio:9000/media/x.webm')).toBe(false);
  });

  it('refuse tout http, meme sur un nom public', () => {
    expect(urlSortieSure('http://cdn.studiio.pro/media/x.webm')).toBe(false);
  });

  it('refuse les noms internes et les suffixes prives', () => {
    for (const u of [
      'https://localhost/x', 'https://minio.local/x', 'https://s3.internal/x',
      'https://nas.lan/x', 'https://studiio-postgrest/x', 'https://minio/x',
    ]) {
      expect(urlSortieSure(u), u).toBe(false);
    }
  });

  it('refuse les adresses privees et la boucle locale', () => {
    for (const u of [
      'https://127.0.0.1/x', 'https://10.0.0.4/x', 'https://192.168.1.9/x',
      'https://172.16.5.5/x', 'https://172.31.0.1/x', 'https://169.254.1.1/x',
      'https://0.0.0.0/x', 'https://[::1]/x',
    ]) {
      expect(urlSortieSure(u), u).toBe(false);
    }
  });

  it('accepte une URL relative — elle herite du HTTPS de la page', () => {
    expect(urlSortieSure('/api/render/jobs/job-1/upload')).toBe(true);
    // Mais pas un protocol-relative, qui peut viser un autre hote.
    expect(urlSortieSure('//studiio-minio:9000/x')).toBe(false);
  });

  it('accepte un vrai nom public en https', () => {
    expect(urlSortieSure('https://minio.studiio.pro/media/moi/rendus/x.webm')).toBe(true);
  });

  it('refuse une URL vide ou illisible', () => {
    expect(urlSortieSure('')).toBe(false);
    expect(urlSortieSure('pas une url')).toBe(false);
  });
});

describe('Le choix de la cible', () => {
  it('sans endpoint public, c est le relais same-origin', async () => {
    const c = await cibleTeleversement('job-1', 'media', 'moi/rendus/job-1.webm', null);
    expect(c).toEqual({ url: '/api/render/jobs/job-1/upload', mode: 'relais' });
  });

  it('avec un endpoint public https, c est l URL presignee', async () => {
    const c = await cibleTeleversement('job-1', 'media', 'moi/rendus/job-1.webm', {
      presignedPutObject: async (b, k, ttl) => {
        expect(ttl).toBe(PRESIGNE_TTL_S);
        return `https://minio.studiio.pro/${b}/${k}?sig=abc`;
      },
    });
    expect(c.mode).toBe('direct');
    expect(c.url).toContain('https://minio.studiio.pro/media/moi/rendus/job-1.webm');
  });

  it('une signature qui produit une adresse interne retombe sur le relais', async () => {
    const c = await cibleTeleversement('job-1', 'media', 'k', {
      presignedPutObject: async () => 'http://studiio-minio:9000/media/k?sig=abc',
    });
    expect(c).toEqual({ url: urlRelais('job-1'), mode: 'relais' });
  });

  it('une signature qui echoue retombe sur le relais', async () => {
    const c = await cibleTeleversement('job-1', 'media', 'k', {
      presignedPutObject: async () => { throw new Error('pas de region'); },
    });
    expect(c.mode).toBe('relais');
  });

  it("l'URL de lecture retombe en relatif si la base est mal remplie", () => {
    process.env.PUBLIC_STORAGE_URL = 'http://studiio-minio:9000';
    expect(urlPubliqueRendu('media', 'moi/x.webm'))
      .toBe('/storage/v1/object/public/media/moi/x.webm');
  });

  it("et garde la base publique quand elle est correcte", () => {
    process.env.PUBLIC_STORAGE_URL = 'https://cdn.studiio.pro/public';
    expect(urlPubliqueRendu('media', 'moi/x.webm'))
      .toBe('https://cdn.studiio.pro/public/media/moi/x.webm');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La reservation ne rend jamais une cible dangereuse
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/render/jobs — la cible rendue au navigateur', () => {
  it('sans endpoint public, elle est same-origin et relative', async () => {
    const r = await reserver();
    expect(r.status).toBe(200);
    expect(r.body.uploadUrl).toBe('/api/render/jobs/job-1/upload');
    expect(r.body.uploadMode).toBe('relais');
  });

  it('elle ne contient jamais studiio-minio, ni http, ni port interne', async () => {
    const r = await reserver();
    const texte = JSON.stringify(r.body);
    expect(texte).not.toContain('studiio-minio');
    expect(texte).not.toContain('http://');
    expect(texte).not.toContain(':9000');
  });

  it('avec un endpoint public correct, elle est presignee en https', async () => {
    signeurCourant = {
      presignedPutObject: async (b, k) => `https://minio.studiio.pro/${b}/${k}?X-Amz-Signature=zz`,
    };
    const r = await reserver();
    expect(r.body.uploadMode).toBe('direct');
    expect(r.body.uploadUrl.startsWith('https://minio.studiio.pro/')).toBe(true);
  });

  it('un endpoint public mal configure ne fuit pas — repli sur le relais', async () => {
    signeurCourant = {
      presignedPutObject: async () => 'http://studiio-minio:9000/media/moi/rendus/job-1.webm',
    };
    const r = await reserver();
    expect(r.body.uploadUrl).toBe('/api/render/jobs/job-1/upload');
    expect(JSON.stringify(r.body)).not.toContain('studiio-minio');
  });

  it('la cle reste celle du serveur, jamais celle du client', async () => {
    const r = await reserver({ operation: 'calendrier', format: 'reel', cle_objet: 'autrui/x.webm', bucket: 'videos' });
    expect(r.status).toBe(422);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5 a 9. Le relais : a qui il obeit, et ce qu'il refuse
// ────────────────────────────────────────────────────────────────────────────

describe('5 & 6. Le relais n obeit qu a la ligne, jamais au client', () => {
  it('ecrit dans le bucket et a la cle de la tentative', async () => {
    const r = await televerser();
    expect(r.status).toBe(200);
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].bucket).toBe('media');
    expect(ecritures[0].cle).toBe('moi/rendus/job-1.webm');
  });

  it("la tentative d'un autre utilisateur est introuvable, pas refusee", async () => {
    // `lireRendu` filtre sur l'utilisateur : distinguer 403 de 404
    // revelerait l'existence de la tentative d'un tiers.
    ligneRendu = null;
    const r = await televerser();
    expect(r.status).toBe(404);
    expect(ecritures).toHaveLength(0);
  });

  it('sans session, rien ne s ecrit', async () => {
    authMock.mockResolvedValue(null);
    const r = await televerser();
    expect(r.status).toBe(401);
    expect(ecritures).toHaveLength(0);
  });

  it('aucun champ de la requete ne peut designer une autre cle', async () => {
    // La route ne lit ni query, ni corps JSON : le seul parametre est l'id.
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/render/jobs/[id]/upload/route.ts'), 'utf-8',
    );
    expect(source).not.toContain('searchParams');
    expect(source).not.toContain('req.json()');
    expect(source).toContain('const bucket = rendu.bucket;');
    expect(source).toContain('const cle = rendu.cle_objet;');
  });
});

describe('7 & 8. Type et taille', () => {
  it('refuse un type non video et clot la tentative', async () => {
    const r = await televerser({ contentType: 'text/html' });
    expect(r.status).toBe(415);
    expect(r.body.motif).toBe('type_refuse');
    expect(ecritures).toHaveLength(0);
    expect(cloturesRpc).toEqual([{ etat: 'failed', motif: expect.stringContaining('type refuse') }]);
  });

  it('accepte les types video attendus', () => {
    for (const t of ['video/webm', 'video/mp4', 'video/quicktime', 'video/webm; codecs=vp9']) {
      expect(typeTeleversementAutorise(t), t).toBe(true);
    }
    for (const t of ['text/html', 'image/png', 'application/pdf', '']) {
      expect(typeTeleversementAutorise(t), t).toBe(false);
    }
  });

  it('refuse au-dela du plafond et clot la tentative', async () => {
    const r = await televerser({ longueur: TAILLE_MAXIMALE + 1 });
    expect(r.status).toBe(413);
    expect(r.body.motif).toBe('trop_gros');
    expect(ecritures).toHaveLength(0);
    expect(cloturesRpc[0].etat).toBe('failed');
  });

  it('laisse passer un montage lourd mais plausible', async () => {
    const r = await televerser({ longueur: 8_500_000 });
    expect(r.status).toBe(200);
    expect(ecritures[0].taille).toBe(8_500_000);
  });
});

describe('9. Un envoi echoue clot la tentative en failed', () => {
  it("l'ecriture refusee par le stockage", async () => {
    putEchoue = true;
    const r = await televerser();
    expect(r.status).toBe(502);
    expect(r.body.motif).toBe('ecriture_echouee');
    expect(cloturesRpc).toEqual([{ etat: 'failed', motif: 'ecriture echouee' }]);
  });

  it("l'ecriture non durable — 200 puis objet introuvable", async () => {
    statEchoue = true;
    const r = await televerser();
    expect(r.status).toBe(500);
    expect(r.body.motif).toBe('non_durable');
    expect(cloturesRpc).toEqual([{ etat: 'failed', motif: 'ecriture non durable' }]);
  });

  it('un corps absent clot aussi la tentative', async () => {
    const r = await televerser({ corps: null });
    expect(r.status).toBe(400);
    expect(cloturesRpc[0].etat).toBe('failed');
  });

  it("aucune cloture n'utilise « cancelled » sur un echec d'envoi", async () => {
    putEchoue = true;
    await televerser();
    expect(cloturesRpc.every((c) => c.etat === 'failed')).toBe(true);
  });
});

describe('Une tentative close ne se reecrit pas', () => {
  ['confirmed', 'cancelled', 'failed'].forEach((etat) => {
    it(`etat « ${etat} » → refus, et rien n est ecrit`, async () => {
      ligneRendu = { ...(ligneRendu as object), etat };
      const r = await televerser();
      expect(r.status).toBe(409);
      expect(r.body.motif).toBe('non_reserve');
      expect(ecritures).toHaveLength(0);
      // On ne re-clot pas ce qui est deja clos.
      expect(cloturesRpc).toHaveLength(0);
    });
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
