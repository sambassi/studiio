// @vitest-environment node
/**
 * `downloadMediaToFile` — le telechargement serveur d'un media Studiio.
 *
 * Ce que ce fichier fixe :
 *   - seule une CIBLE DE STOCKAGE STUDIIO est acceptee (jamais Internet, jamais
 *     un hote interne, jamais un schema exotique) ;
 *   - la cle doit appartenir au compte, ou porter un prefixe partage declare ;
 *   - relative ou origine de l'application → MinIO direct ; autre origine
 *     configuree → HTTP, redirections revalidees, trois sauts au plus ;
 *   - le plafond de taille est verifie AVANT de lire, puis PENDANT ;
 *   - rien n'est tenu en memoire, le fichier partiel disparait a l'echec ;
 *   - aucun message d'erreur ne porte l'URL, la cle ni l'hote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

const { statObject, getObject } = vi.hoisted(() => ({
  statObject: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock('@/lib/storage/minio-client', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/storage/minio-client')>();
  return {
    ...reel,
    clientMinio: vi.fn(() => ({ statObject, putObject: vi.fn() })),
    lecteurMinio: vi.fn(() => ({ getObject, getPartialObject: vi.fn() })),
  };
});

import {
  downloadMediaToFile,
  ErreurTelechargement,
  MAX_MEDIA_DOWNLOAD_BYTES,
  DELAI_TELECHARGEMENT_MS,
  type CodeTelechargement,
} from '@/lib/storage/fetch-media';

// ───────────────────────────────────────────────────────────────────────────
// Outillage
// ───────────────────────────────────────────────────────────────────────────

const USER = 'u1';
const AUTRE = 'u2';
const CLE = `${USER}/rush/x.webm`;
const RELATIVE = `/storage/v1/object/public/media/${CLE}`;
const APP = 'https://studiio.pro';
const SUPABASE = 'https://lhuq.supabase.co';
const CDN = 'https://cdn.studiio.pro';

const ENV_TEST: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: APP,
  NEXTAUTH_URL: APP,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
  PUBLIC_STORAGE_URL: `${CDN}/storage/v1/object/public`,
};

const envAvant: Record<string, string | undefined> = {};
const fetchMock = vi.fn();
const fetchAvant = globalThis.fetch;
const dests: string[] = [];
let journal: ReturnType<typeof vi.spyOn>;

function dest(): string {
  const chemin = join(tmpdir(), `fetch-media-${randomUUID()}.bin`);
  dests.push(chemin);
  return chemin;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV_TEST)) {
    envAvant[k] = process.env[k];
    process.env[k] = v;
  }
  statObject.mockReset();
  getObject.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  journal = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const [k, v] of Object.entries(envAvant)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  globalThis.fetch = fetchAvant;
  journal.mockRestore();
  await Promise.all(dests.splice(0).map((d) => unlink(d).catch(() => undefined)));
});

/** Le flux MinIO factice : `n` morceaux de `taille` octets, tous a `octet`. */
function fluxMinio(morceaux: Buffer[]): Readable {
  return Readable.from(morceaux);
}

interface ReponseFactice {
  status?: number;
  headers?: Record<string, string>;
  /** `null` : pas de corps. Absent : corps vide. */
  corps?: Buffer[] | null;
  /** Un corps qui ne livre jamais rien : pour les tests de delai. */
  bloque?: boolean;
}

/** Une reponse `fetch` factice dont le corps est un VRAI `ReadableStream`. */
function reponse(opts: ReponseFactice = {}) {
  const status = opts.status ?? 200;
  const trace = { lu: false, annule: false };
  let body: ReadableStream<Uint8Array> | null = null;
  if (opts.corps !== null) {
    const morceaux = [...(opts.corps ?? [])];
    body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        trace.lu = true;
        if (opts.bloque) return new Promise<void>(() => undefined);
        const m = morceaux.shift();
        if (m === undefined) ctrl.close(); else ctrl.enqueue(new Uint8Array(m));
        return undefined;
      },
      cancel() { trace.annule = true; },
    // Sans cela, le flux tire un premier morceau des sa construction et
    // `trace.lu` ne dirait plus si QUELQU'UN a lu le corps.
    }, { highWaterMark: 0 });
  }
  const interdit = () => { throw new Error('materialisation interdite'); };
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(opts.headers ?? {}),
    body,
    arrayBuffer: interdit,
    blob: interdit,
    bytes: interdit,
    text: interdit,
    json: interdit,
  };
  return { res, trace };
}

async function attendreErreur(p: Promise<unknown>): Promise<ErreurTelechargement> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurTelechargement);
    return e as ErreurTelechargement;
  }
  throw new Error('la promesse aurait du rejeter');
}

/** Le message ne porte NI l'URL, NI la cle, NI un hote. */
function messagePropre(erreur: Error, url: string) {
  const m = erreur.message;
  if (url.length > 0) expect(m).not.toContain(url);
  for (const fuite of [
    '/storage', 'http', 'studiio', 'supabase', 'cdn', 'evil', 'localhost',
    '127.0.0.1', 'minio', `${USER}/`, `${AUTRE}/`, 'rush', '.webm', '.mp4', 'converted',
  ]) {
    expect(m, `fuite « ${fuite} » dans : ${m}`).not.toContain(fuite);
  }
}

async function refus(url: string, code: CodeTelechargement, options: Partial<Parameters<typeof downloadMediaToFile>[2]> = {}) {
  const chemin = dest();
  const erreur = await attendreErreur(downloadMediaToFile(url, chemin, { userId: USER, ...options }));
  expect(erreur.code).toBe(code);
  messagePropre(erreur, url);
  expect(existsSync(chemin)).toBe(false);
  return erreur;
}

// ───────────────────────────────────────────────────────────────────────────
// Constantes exportees
// ───────────────────────────────────────────────────────────────────────────

describe('les constantes', () => {
  it('plafonnent a 512 Mio et bornent le delai', () => {
    expect(MAX_MEDIA_DOWNLOAD_BYTES).toBe(512 * 1024 * 1024);
    expect(DELAI_TELECHARGEMENT_MS).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Transport MinIO — le chemin nominal
// ───────────────────────────────────────────────────────────────────────────

describe('transport MinIO', () => {
  it('cle du compte, URL relative : ecrit les octets exacts, sans fetch', async () => {
    statObject.mockResolvedValue({ size: 6, metaData: { 'content-type': 'video/webm' } });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('abc'), Buffer.from('def')]));
    const chemin = dest();

    const r = await downloadMediaToFile(RELATIVE, chemin, { userId: USER });

    expect(r.sizeBytes).toBe(6);
    expect(r.contentType).toBe('video/webm');
    expect(await readFile(chemin, 'utf-8')).toBe('abcdef');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statObject).toHaveBeenCalledTimes(1);
    expect(statObject).toHaveBeenCalledWith('media', CLE);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getObject).toHaveBeenCalledWith('media', CLE);
  });

  it('cle du compte, URL absolue sur l origine de l application : MinIO aussi', async () => {
    statObject.mockResolvedValue({ size: 3 });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('xyz')]));
    const chemin = dest();

    const r = await downloadMediaToFile(`${APP}${RELATIVE}`, chemin, { userId: USER });

    expect(r.sizeBytes).toBe(3);
    expect(await readFile(chemin, 'utf-8')).toBe('xyz');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it('le type vient de l extension, pas de l annonce de l envoyeur', async () => {
    statObject.mockResolvedValue({ size: 1, metaData: { 'content-type': 'text/html' } });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('x')]));
    const r = await downloadMediaToFile(RELATIVE, dest(), { userId: USER });
    expect(r.contentType).toBe('video/webm');
  });

  it('objet absent → introuvable, fichier absent', async () => {
    statObject.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 'NotFound' }));
    await refus(RELATIVE, 'introuvable');
    expect(getObject).not.toHaveBeenCalled();
  });

  it('delai MinIO → delai', async () => {
    statObject.mockRejectedValue(new Error('delai reseau MinIO depasse (5 ms)'));
    await refus(RELATIVE, 'delai');
  });

  it('autre erreur du stockage → stockage', async () => {
    statObject.mockRejectedValue(Object.assign(new Error('boom'), { code: 'InternalError' }));
    await refus(RELATIVE, 'stockage');
  });

  it('stat.size > maxBytes → trop_volumineux AVANT getObject', async () => {
    statObject.mockResolvedValue({ size: 1001 });
    await refus(RELATIVE, 'trop_volumineux', { maxBytes: 1000 });
    expect(getObject).not.toHaveBeenCalled();
  });

  it('flux plus long que maxBytes → coupe, fichier efface, trop_volumineux', async () => {
    statObject.mockResolvedValue({ size: 100 }); // l annonce ment
    const flux = fluxMinio([Buffer.alloc(100, 1), Buffer.alloc(100, 2), Buffer.alloc(100, 3)]);
    getObject.mockResolvedValue(flux);

    await refus(RELATIVE, 'trop_volumineux', { maxBytes: 150 });
    expect(flux.destroyed).toBe(true);
  });

  it('erreur en cours de flux → fichier partiel efface', async () => {
    statObject.mockResolvedValue({ size: 100 });
    const flux = new Readable({
      read() {
        this.push(Buffer.alloc(10));
        this.destroy(Object.assign(new Error('coupure'), { code: 'ECONNRESET' }));
      },
    });
    getObject.mockResolvedValue(flux);
    await refus(RELATIVE, 'reseau');
  });

  it('le client MinIO est construit avec la borne de delai demandee', async () => {
    const { clientMinio, lecteurMinio } = await import('@/lib/storage/minio-client');
    statObject.mockResolvedValue({ size: 1 });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('x')]));
    await downloadMediaToFile(RELATIVE, dest(), { userId: USER, timeoutMs: 4321 });
    expect(clientMinio).toHaveBeenCalledWith({ timeoutMs: 4321 });
    expect(lecteurMinio).toHaveBeenCalledWith({ timeoutMs: 4321 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Propriete
// ───────────────────────────────────────────────────────────────────────────

describe('propriete de la cle', () => {
  it('cle d un autre compte → acces_refuse, sans toucher au stockage', async () => {
    await refus(`/storage/v1/object/public/media/${AUTRE}/rush/x.webm`, 'acces_refuse');
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un prefixe de compte ne suffit pas (u1x n est pas u1)', async () => {
    await refus(`/storage/v1/object/public/media/${USER}x/rush/x.webm`, 'acces_refuse');
    expect(statObject).not.toHaveBeenCalled();
  });

  it('userId vide → acces_refuse', async () => {
    await refus(RELATIVE, 'acces_refuse', { userId: '' });
    expect(statObject).not.toHaveBeenCalled();
  });

  it('`converted/x.mp4` sans prefixesPartages → refuse', async () => {
    await refus('/storage/v1/object/public/videos/converted/x.mp4', 'acces_refuse');
    expect(statObject).not.toHaveBeenCalled();
  });

  it('`converted/x.mp4` avec prefixesPartages: [converted/] → accepte', async () => {
    statObject.mockResolvedValue({ size: 2 });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('ok')]));
    const chemin = dest();
    const r = await downloadMediaToFile(
      '/storage/v1/object/public/videos/converted/x.mp4', chemin,
      { userId: USER, prefixesPartages: ['converted/'] },
    );
    expect(r.sizeBytes).toBe(2);
    expect(r.contentType).toBe('video/mp4');
    expect(getObject).toHaveBeenCalledWith('videos', 'converted/x.mp4');
  });

  it('un prefixe partage vide n ouvre rien', async () => {
    await refus(`/storage/v1/object/public/media/${AUTRE}/x.webm`, 'acces_refuse', { prefixesPartages: [''] });
    expect(statObject).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cibles irrecevables — refusees avant tout appel au stockage
// ───────────────────────────────────────────────────────────────────────────

describe('cibles irrecevables', () => {
  it.each([
    ['compartiment inconnu', `/storage/v1/object/public/autre/${USER}/x.webm`],
    ['remontee `..`', `/storage/v1/object/public/media/${USER}/../${AUTRE}/x.webm`],
    ['namespace des vignettes', `/storage/v1/object/public/media/${USER}/analyse/a1/vignette-01.jpg`],
    ['namespace des montages', `/storage/v1/object/public/videos/${USER}/montages/m1.mp4`],
    ['namespace des LUT', `/storage/v1/object/public/media/${USER}/lut/look.cube`],
    ['source d avatar', `/storage/v1/object/public/media/${USER}/avatar/source-1.webm`],
  ])('%s → acces_refuse avant MinIO', async (_nom, url) => {
    await refus(url, 'acces_refuse');
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// URL qui ne sont pas des cibles de stockage — cible_invalide
// ───────────────────────────────────────────────────────────────────────────

describe('URL hors stockage', () => {
  it.each([
    ['Internet', 'https://evil.example/x.webm'],
    ['Internet, chemin de relais', `https://evil.example${RELATIVE}`],
    ['localhost non configure', `http://localhost:3000${RELATIVE}`],
    ['boucle locale', `http://127.0.0.1${RELATIVE}`],
    ['nom Docker de MinIO', `http://studiio-minio:9000/media/${CLE}`],
    ['data:', 'data:video/webm;base64,AAAA'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://x/y.webm'],
    ['javascript:', 'javascript:alert(1)'],
    ['identifiants', `https://u:p@studiio.pro${RELATIVE}`],
    ['chaine de requete', `${APP}${RELATIVE}?token=abc`],
    ['fragment', `${RELATIVE}#x`],
    ['relatif de protocole', `//studiio.pro${RELATIVE}`],
    ['chemin hors relais', `/api/proxy-media?url=${RELATIVE}`],
    ['chaine vide', ''],
  ])('%s → cible_invalide, ni fetch ni MinIO', async (_nom, url) => {
    await refus(url, 'cible_invalide');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Transport HTTP — Supabase historique et CDN
// ───────────────────────────────────────────────────────────────────────────

describe('transport HTTP', () => {
  const URL_SUPABASE = `${SUPABASE}${RELATIVE}`;

  it('Supabase, cle du compte : fetch manuel, signal, corps streame sur disque', async () => {
    const { res, trace } = reponse({
      corps: [Buffer.from('hello '), Buffer.from('world')],
      headers: { 'content-length': '11' },
    });
    fetchMock.mockResolvedValue(res);
    const chemin = dest();

    const r = await downloadMediaToFile(URL_SUPABASE, chemin, { userId: USER });

    expect(r.sizeBytes).toBe(11);
    expect(r.contentType).toBe('video/webm');
    expect(await readFile(chemin, 'utf-8')).toBe('hello world');
    expect(trace.lu).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_SUPABASE);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });

  it('CDN sur un autre hote : HTTP aussi', async () => {
    const { res } = reponse({ corps: [Buffer.from('cdn')] });
    fetchMock.mockResolvedValue(res);
    const chemin = dest();
    const r = await downloadMediaToFile(`${CDN}${RELATIVE}`, chemin, { userId: USER });
    expect(r.sizeBytes).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('cle d un autre compte sur Supabase → acces_refuse, sans fetch', async () => {
    await refus(`${SUPABASE}/storage/v1/object/public/media/${AUTRE}/x.webm`, 'acces_refuse');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Content-Length > maxBytes → trop_volumineux sans lire le corps', async () => {
    const { res, trace } = reponse({
      corps: [Buffer.alloc(10)],
      headers: { 'content-length': String(2000) },
    });
    fetchMock.mockResolvedValue(res);
    await refus(URL_SUPABASE, 'trop_volumineux', { maxBytes: 1000 });
    expect(trace.lu).toBe(false);
    expect(trace.annule).toBe(true);
  });

  it('corps plus long que maxBytes (sans annonce) → coupe, fichier efface', async () => {
    const { res } = reponse({ corps: [Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)] });
    fetchMock.mockResolvedValue(res);
    await refus(URL_SUPABASE, 'trop_volumineux', { maxBytes: 150 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });

  it('404 → introuvable', async () => {
    fetchMock.mockResolvedValue(reponse({ status: 404 }).res);
    await refus(URL_SUPABASE, 'introuvable');
  });

  it('500 → reseau', async () => {
    fetchMock.mockResolvedValue(reponse({ status: 500 }).res);
    await refus(URL_SUPABASE, 'reseau');
  });

  it('reponse sans corps → reseau', async () => {
    fetchMock.mockResolvedValue(reponse({ corps: null }).res);
    await refus(URL_SUPABASE, 'reseau');
  });

  it('fetch qui echoue (DNS, connexion) → reseau', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await refus(URL_SUPABASE, 'reseau');
  });

  describe('redirections', () => {
    it('302 vers la meme cible → suivie', async () => {
      fetchMock
        .mockResolvedValueOnce(reponse({ status: 302, headers: { location: URL_SUPABASE } }).res)
        .mockResolvedValueOnce(reponse({ corps: [Buffer.from('ok')] }).res);
      const chemin = dest();
      const r = await downloadMediaToFile(URL_SUPABASE, chemin, { userId: USER });
      expect(r.sizeBytes).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('302 relative, resolue contre l URL courante, vers une cible du compte → suivie', async () => {
      fetchMock
        .mockResolvedValueOnce(reponse({
          status: 302, headers: { location: `/storage/v1/object/public/media/${USER}/rush/y.webm` },
        }).res)
        .mockResolvedValueOnce(reponse({ corps: [Buffer.from('y')] }).res);
      await downloadMediaToFile(URL_SUPABASE, dest(), { userId: USER });
      expect(fetchMock.mock.calls[1][0]).toBe(`${SUPABASE}/storage/v1/object/public/media/${USER}/rush/y.webm`);
    });

    it('302 vers une autre origine → acces_refuse, non suivie', async () => {
      fetchMock.mockResolvedValueOnce(reponse({
        status: 302, headers: { location: `https://evil.example${RELATIVE}` },
      }).res);
      await refus(URL_SUPABASE, 'acces_refuse');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('302 vers la cle d un autre compte → acces_refuse', async () => {
      fetchMock.mockResolvedValueOnce(reponse({
        status: 302, headers: { location: `${SUPABASE}/storage/v1/object/public/media/${AUTRE}/x.webm` },
      }).res);
      await refus(URL_SUPABASE, 'acces_refuse');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('302 vers un namespace prive → acces_refuse', async () => {
      fetchMock.mockResolvedValueOnce(reponse({
        status: 302, headers: { location: `${SUPABASE}/storage/v1/object/public/media/${USER}/lut/l.cube` },
      }).res);
      await refus(URL_SUPABASE, 'acces_refuse');
    });

    it('302 sans Location → reseau', async () => {
      fetchMock.mockResolvedValueOnce(reponse({ status: 302 }).res);
      await refus(URL_SUPABASE, 'reseau');
    });

    it('trois sauts passent, le quatrieme est refuse', async () => {
      const saut = () => reponse({ status: 302, headers: { location: URL_SUPABASE } }).res;
      fetchMock
        .mockResolvedValueOnce(saut()).mockResolvedValueOnce(saut()).mockResolvedValueOnce(saut())
        .mockResolvedValueOnce(reponse({ corps: [Buffer.from('3')] }).res);
      await downloadMediaToFile(URL_SUPABASE, dest(), { userId: USER });
      expect(fetchMock).toHaveBeenCalledTimes(4);

      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(saut()).mockResolvedValueOnce(saut())
        .mockResolvedValueOnce(saut()).mockResolvedValueOnce(saut())
        .mockResolvedValueOnce(reponse({ corps: [Buffer.from('4')] }).res);
      await refus(URL_SUPABASE, 'reseau');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('delai', () => {
    it('fetch qui ne repond jamais → delai a l echeance', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
        }));
      const debut = Date.now();
      await refus(URL_SUPABASE, 'delai', { timeoutMs: 30 });
      expect(Date.now() - debut).toBeGreaterThanOrEqual(25);
    });

    it('corps qui ne livre plus rien → delai, fichier partiel efface', async () => {
      const { res } = reponse({ corps: [Buffer.from('debut')], bloque: true });
      fetchMock.mockResolvedValue(res);
      await refus(URL_SUPABASE, 'delai', { timeoutMs: 30 });
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Journal et messages
// ───────────────────────────────────────────────────────────────────────────

describe('journal', () => {
  it('une seule ligne, sans cle ni URL ni hote', async () => {
    statObject.mockResolvedValue({ size: 1 });
    getObject.mockResolvedValue(fluxMinio([Buffer.from('x')]));
    await downloadMediaToFile(`${APP}${RELATIVE}`, dest(), { userId: USER });
    const lignes = journal.mock.calls.filter((c: unknown[]) => c[0] === '[fetchMedia]');
    expect(lignes).toHaveLength(1);
    const texte = JSON.stringify(lignes[0]);
    expect(texte).not.toContain(CLE);
    expect(texte).not.toContain('studiio');
    expect(texte).not.toContain('/storage');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Preuve statique
// ───────────────────────────────────────────────────────────────────────────

describe('preuve statique sur le source', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/storage/fetch-media.ts'), 'utf-8');

  it('epingle le prefixe du relais sous son nom historique', () => {
    expect(source).toContain("const STORAGE_PROXY_PREFIX = '/storage/v1/object/public/'");
  });

  it('ne materialise jamais le media en memoire', () => {
    expect(source).not.toContain('arrayBuffer(');
    expect(source).not.toContain('Buffer.concat(');
    expect(source).not.toContain('downloadMediaToBuffer');
    expect(source).not.toContain('.blob(');
    expect(source).not.toContain('.bytes(');
    expect(source).not.toMatch(/\bwriteFile(Sync)?\s*\(/);
  });

  it('n accepte plus d origine de repli ni de chemin relatif arbitraire', () => {
    expect(source).not.toContain('fallbackOrigin');
    expect(source).not.toContain("url.startsWith('/')");
  });

  it('exporte l API attendue', () => {
    for (const nom of [
      'export const MAX_MEDIA_DOWNLOAD_BYTES', 'export const DELAI_TELECHARGEMENT_MS',
      'export type CodeTelechargement', 'export class ErreurTelechargement',
      'export interface OptionsTelechargement', 'export async function downloadMediaToFile',
    ]) {
      expect(source).toContain(nom);
    }
  });
});
