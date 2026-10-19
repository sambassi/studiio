// @vitest-environment node
/**
 * CONFIDENTIALITÉ DES ANCIENNES CONVERSIONS `converted/<horodatage>`.
 *
 * `api/convert/to-mp4` (avant #417) et `api/cron/publish` (avant #546)
 * déposaient leurs MP4 sous `converted/converted_<Date.now()>.mp4` — une clé
 * SANS identifiant de compte. Le préfixe était déclaré « partagé » : tout
 * compte CONNECTÉ pouvait lire (relais), proxifier (`/api/proxy-media`) et
 * PUBLIER (`verdictStockagePublication` → jeton du relais 24 h remis au
 * réseau) la conversion d'un autre en devinant l'horodatage.
 *
 * Aucune ligne écrite par le SERVEUR ne rattache ces objets à un compte, et
 * une référence dans un post est écrite par le navigateur (B peut y poser la
 * clé de A) : le propriétaire n'est pas prouvable sans migration. Décision :
 * plus personne ne les lit, ne les proxifie ni ne les publie — sauf
 * l'administrateur sur le relais (back-office), comme pour tout objet.
 *
 * Ce fichier prouve, MinIO / session / réseau doublés, fichiers synthétiques :
 *   1. Relais : B (connecté) → 404 neutre, MinIO jamais sondé, sous toutes les
 *      formes de clé (casse, `//`, `..`, encodages, préfixe `<B>/…` usurpé).
 *   2. Proxy : B → 403 neutre, aucun appel amont.
 *   3. Publication : verdict `refuse`, lecture refusée sans requête, jamais
 *      de jeton.
 *   4. Non-régression : la conversion ACTUELLE `<A>/converted/…` reste lisible,
 *      proxifiable et publiable par A — et par lui seul.
 *
 * DISCRIMINANT : sur l'ancien code (`PREFIXES_PARTAGES = ['converted/']` et
 * `CONVERSION_PARTAGEE` dans `media-publication.ts`), les cas « B → refus »
 * sur `converted/…` échouent (200 / `autorise`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  appels: [] as Array<{ methode: string; bucket: string; cle: string }>,
  session: null as null | { user: { id: string; email?: string } },
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'stat', bucket, cle });
      return { size: 2048, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'get', bucket, cle });
      return Readable.from([Buffer.alloc(2048, 3)]);
    }
    async getPartialObject(bucket: string, cle: string, _d: number, longueur: number) {
      etat.appels.push({ methode: 'partial', bucket, cle });
      return Readable.from([Buffer.alloc(longueur, 3)]);
    }
  }
  return { Client };
});

vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));

process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = 'secret-de-test-converted-0123456789abcdef';

const { GET: LIRE, HEAD: SONDER } = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);
const { GET: PROXIFIER } = await import('@/app/api/proxy-media/route');
const { NextRequest } = await import('next/server');
const { lectureRelaisAutorisee } = await import('@/lib/storage/politique-relais');
const { clePossedeePar, PREFIXES_PARTAGES } = await import('@/lib/storage/acces-objet');
const { signerSiNotreStockage, PARAM_JETON_RELAIS } = await import('@/lib/storage/jeton-relais');
const { verdictStockagePublication, lireMediaPublication, ErreurMediaPublication } = await import(
  '@/lib/social/media-publication'
);

const ORIGINE = 'https://studiio.pro';
const PUB = `${ORIGINE}/storage/v1/object/public`;
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const ADMIN = 'contact.artboost@gmail.com';
const HISTORIQUE = 'converted/converted_1712345678901.mp4';
const ACTUELLE_A = `${A}/converted/converted_1712345678901.mp4`;

function appelRelais(fn: typeof LIRE, bucket: string, cle: string) {
  const url = `${PUB}/${bucket}/${cle}`;
  return fn(new Request(url) as never, { params: Promise.resolve({ bucket, path: cle.split('/') }) });
}
const lire = (b: string, c: string) => appelRelais(LIRE, b, c);
const sonder = (b: string, c: string) => appelRelais(SONDER as typeof LIRE, b, c);

let amont: ReturnType<typeof vi.fn>;
async function proxifier(url: string) {
  const req = new NextRequest(`${ORIGINE}/api/proxy-media?url=${encodeURIComponent(url)}`);
  return PROXIFIER(req as never);
}

beforeEach(() => {
  etat.appels.length = 0;
  etat.session = null;
  amont = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { 'content-type': 'video/mp4' },
  }));
  vi.stubGlobal('fetch', amont);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Les formes sous lesquelles B tente d'atteindre une ancienne conversion
 * (la sienne n'existe pas : aucune clé sans compte n'est à lui).
 */
const FORMES_HISTORIQUES: Array<[string, string, string]> = [
  ['clé historique exacte', 'media', HISTORIQUE],
  ['autre compartiment', 'videos', HISTORIQUE],
  ['double barre', 'media', `converted//converted_1712345678901.mp4`],
  ['casse Converted/', 'media', `Converted/converted_1712345678901.mp4`],
  ['casse CONVERTED/', 'media', `CONVERTED/converted_1712345678901.mp4`],
  ['préfixe de B usurpé, remontée littérale', 'media', `${B}/../${HISTORIQUE}`],
  ['préfixe de B usurpé, remontée encodée', 'media', `${B}/%2e%2e/${HISTORIQUE}`],
  ['préfixe de B usurpé, séparateur encodé', 'media', `${B}%2F..%2F${HISTORIQUE}`],
  ['préfixe {B}/converted usurpé puis remontée', 'media', `${B}/converted/../../${HISTORIQUE}`],
  ['c encodé', 'media', `%63onverted/converted_1712345678901.mp4`],
  ['sous-dossier converted/', 'media', `converted/${A}/converted_1712345678901.mp4`],
];

// ═════════════════════════════════════════════════════════════════════════
// 1. Relais public `/storage/v1/object/public/…`
// ═════════════════════════════════════════════════════════════════════════

describe('relais — B connecté ne lit plus une ancienne conversion', () => {
  it.each(FORMES_HISTORIQUES)('%s → 404 neutre, MinIO jamais sondé', async (_n, bucket, cle) => {
    etat.session = { user: { id: B, email: 'b@example.com' } };
    const res = await lire(bucket, cle);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(JSON.stringify({ error: 'not found' }));
    expect(etat.appels).toHaveLength(0);
  });

  it('double encodage sous le préfixe de B : la clé exacte reste DANS le dossier de B (S3 ne décode pas)', async () => {
    etat.session = { user: { id: B } };
    await lire('media', `${B}/%252e%252e/${HISTORIQUE}`);
    expect(etat.appels.length).toBeGreaterThan(0);
    for (const a of etat.appels) expect(a.cle.startsWith(`${B}/`)).toBe(true);
    expect(etat.appels.some((a) => a.cle === HISTORIQUE)).toBe(false);
  });

  it('HEAD de B : 404, aucune taille, aucune existence confirmée', async () => {
    etat.session = { user: { id: B } };
    const res = await sonder('media', HISTORIQUE);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-length')).toBeNull();
    expect(etat.appels).toHaveLength(0);
  });

  it('A non plus : une clé sans compte n est à personne', async () => {
    etat.session = { user: { id: A } };
    expect((await lire('media', HISTORIQUE)).status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('anonyme : 404 (inchangé)', async () => {
    expect((await lire('media', HISTORIQUE)).status).toBe(404);
  });

  it('même réponse qu un objet absent : un refus ne se distingue pas d une clé inexistante', async () => {
    etat.session = { user: { id: B } };
    const refus = await lire('media', HISTORIQUE);
    const autrui = await lire('media', `${A}/rush/inexistant.mp4`);
    expect(refus.status).toBe(autrui.status);
    expect(await refus.text()).toBe(await autrui.text());
  });

  it('l administrateur la lit encore (back-office)', async () => {
    etat.session = { user: { id: B, email: ADMIN } };
    expect((await lire('media', HISTORIQUE)).status).toBe(200);
  });

  it('politique pure : lectureRelaisAutorisee refuse un compte quelconque', async () => {
    for (const userId of [A, B]) {
      expect(await lectureRelaisAutorisee({
        bucket: 'media', cle: HISTORIQUE, session: async () => ({ userId, email: 'x@example.com' }),
      })).toBe(false);
    }
    expect(PREFIXES_PARTAGES).toEqual([]);
  });
});

describe('relais — non-régression : la conversion ACTUELLE `<A>/converted/…`', () => {
  it('A la lit (GET), MinIO lit la clé exacte', async () => {
    etat.session = { user: { id: A } };
    const res = await lire('media', ACTUELLE_A);
    expect(res.status).toBe(200);
    expect(etat.appels.some((x) => x.cle === ACTUELLE_A)).toBe(true);
  });

  it('B ne la lit pas', async () => {
    etat.session = { user: { id: B } };
    expect((await lire('media', ACTUELLE_A)).status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. `/api/proxy-media`
// ═════════════════════════════════════════════════════════════════════════

describe('proxy-media — B ne proxifie plus une ancienne conversion', () => {
  it.each([
    ['clé historique', `${PUB}/media/${HISTORIQUE}`],
    ['autre compartiment', `${PUB}/videos/${HISTORIQUE}`],
    ['double barre', `${PUB}/media/converted//converted_1.mp4`],
    ['séparateur encodé', `${PUB}/media/converted%2Fconverted_1.mp4`],
    ['préfixe de B usurpé', `${PUB}/media/${B}/..%2F${HISTORIQUE}`],
  ])('%s → 403 neutre, aucun appel amont', async (_n, url) => {
    etat.session = { user: { id: B } };
    const res = await proxifier(url);
    expect(res.status).toBe(403);
    const corps = JSON.stringify(await res.json());
    expect(corps).not.toContain('converted');
    expect(corps).not.toContain(A);
    expect(amont).not.toHaveBeenCalled();
  });

  it('clePossedeePar : plus aucun préfixe partagé', () => {
    expect(clePossedeePar(HISTORIQUE, A)).toBe(false);
    expect(clePossedeePar(HISTORIQUE, B)).toBe(false);
    expect(clePossedeePar(ACTUELLE_A, A)).toBe(true);
    expect(clePossedeePar(ACTUELLE_A, B)).toBe(false);
  });

  it('non-régression : A proxifie sa conversion actuelle', async () => {
    etat.session = { user: { id: A } };
    const res = await proxifier(`${PUB}/media/${ACTUELLE_A}`);
    expect(res.status).toBe(200);
    expect(amont).toHaveBeenCalledTimes(1);
  });

  it('non-régression : B ne proxifie pas la conversion actuelle de A', async () => {
    etat.session = { user: { id: B } };
    expect((await proxifier(`${PUB}/media/${ACTUELLE_A}`)).status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. Signature et publication
// ═════════════════════════════════════════════════════════════════════════

describe('signature — aucun jeton du relais pour une ancienne conversion', () => {
  it.each([A, B])('lecteur %s : URL rendue SANS jeton', (lecteur) => {
    const url = `${PUB}/media/${HISTORIQUE}`;
    expect(signerSiNotreStockage(url, { lecteur })).toBe(url);
  });

  it('non-régression : la conversion actuelle de A reçoit un jeton pour A seulement', () => {
    const url = `${PUB}/media/${ACTUELLE_A}`;
    expect(String(signerSiNotreStockage(url, { lecteur: A }))).toContain(`${PARAM_JETON_RELAIS}=`);
    expect(signerSiNotreStockage(url, { lecteur: B })).toBe(url);
  });
});

describe('publication — verdict et lecture refusés', () => {
  const URLS: Array<[string, string]> = [
    ['publique', `${PUB}/media/${HISTORIQUE}`],
    ['relative', `/storage/v1/object/public/media/${HISTORIQUE}`],
    ['autre hôte (le chemin fait foi)', `https://alias.example/storage/v1/object/public/media/${HISTORIQUE}`],
    ['supabase historique', `https://projet.supabase.co/storage/v1/object/public/media/${HISTORIQUE}`],
    ['signée', `${ORIGINE}/storage/v1/object/sign/media/${HISTORIQUE}?token=t`],
    ['autre compartiment', `${PUB}/videos/${HISTORIQUE}`],
    ['double barre', `${PUB}/media/converted//converted_1.mp4`],
    ['séparateur encodé', `${PUB}/media/converted%2Fconverted_1.mp4`],
    ['préfixe de B usurpé', `${PUB}/media/${B}/../${HISTORIQUE}`],
  ];

  it.each(URLS)('%s → verdict `refuse` pour A comme pour B', (_n, url) => {
    expect(verdictStockagePublication(url, A)).toBe('refuse');
    expect(verdictStockagePublication(url, B)).toBe('refuse');
  });

  it.each(URLS.slice(0, 4))('%s → lireMediaPublication refuse AVANT toute requête', async (_n, url) => {
    const e = await lireMediaPublication(url, { userId: B }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurMediaPublication);
    expect((e as InstanceType<typeof ErreurMediaPublication>).code).toBe('refuse');
    expect((e as Error).message).not.toContain('converted');
    expect(amont).not.toHaveBeenCalled();
  });

  it('non-régression : la conversion actuelle de A est autorisée pour A, refusée pour B', () => {
    const url = `${PUB}/media/${ACTUELLE_A}`;
    expect(verdictStockagePublication(url, A)).toBe('autorise');
    expect(verdictStockagePublication(url, B)).toBe('refuse');
  });

  it('non-régression : un média externe reste « hors stockage »', () => {
    expect(verdictStockagePublication('https://videos.pexels.com/x.mp4', B)).toBe('hors-stockage');
  });
});
