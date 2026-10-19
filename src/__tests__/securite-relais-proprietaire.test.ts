// @vitest-environment node
/**
 * ISSUE #547 — PUBLIC_STORAGE_RELAY_RISK.
 *
 * Le relais `/storage/v1/object/public/<bucket>/<clé>` servait SANS SESSION
 * tout objet d'un compte (rush, bibliothèque, rendu, audio…) à quiconque
 * connaissait l'URL exacte.
 *
 * Ce fichier prouve, sur la vraie route (MinIO et session doublés) :
 *   1. EXPLOIT : B (sans session, ou avec SA session) ne lit ni le rush, ni
 *      le rendu, ni l'audio de A → 404 neutre, et MinIO n'est même pas sondé.
 *   2. A, avec SA session, lit ses objets (GET, Range, HEAD).
 *   3. Ce qui doit rester public l'est : copies partagées `media/externes/…`.
 *   4. Un fournisseur sans cookie lit avec un jeton signé valide ; jeton
 *      expiré, altéré, d'une autre clé ou d'un autre compartiment → 404.
 *   5. Les erreurs ne portent ni clé ni compte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({
  appels: [] as Array<{ methode: string; bucket: string; cle: string }>,
  session: null as null | { user: { id: string; email?: string } },
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'stat', bucket, cle });
      return { size: 4096, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'get', bucket, cle });
      return Readable.from([Buffer.alloc(4096, 7)]);
    }
    async getPartialObject(bucket: string, cle: string, _d: number, longueur: number) {
      etat.appels.push({ methode: 'partial', bucket, cle });
      return Readable.from([Buffer.alloc(longueur, 7)]);
    }
  }
  return { Client };
});

vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));

process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = 'secret-de-test-relais-0123456789abcdef';

const { GET: LIRE, HEAD: SONDER } = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);
const { signerUrlRelais, jetonRelais, jetonRelaisValide, PARAM_JETON_RELAIS, DUREE_JETON_RELAIS_MAX_MS } =
  await import('@/lib/storage/jeton-relais');

const ORIGINE = 'https://studiio.pro';
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

function appel(fn: typeof LIRE, bucket: string, cle: string, opts: { query?: string; range?: string } = {}) {
  const segments = cle.split('/');
  const entetes: Record<string, string> = {};
  if (opts.range) entetes.range = opts.range;
  const url = `${ORIGINE}/storage/v1/object/public/${bucket}/${cle}${opts.query ? `?${opts.query}` : ''}`;
  return fn(new Request(url, { headers: entetes }) as never, { params: Promise.resolve({ bucket, path: segments }) });
}
const lire = (b: string, c: string, o?: { query?: string; range?: string }) => appel(LIRE, b, c, o);
const sonder = (b: string, c: string, o?: { query?: string }) => appel(SONDER as typeof LIRE, b, c, o);

/** Les objets PROPRIÉTAIRES de A, un par namespace écrit aujourd'hui. */
const OBJETS_A: Array<[string, string]> = [
  ['media', `${A}/rush/1712345678-mon-rush.mp4`],
  ['media', `${A}/library/1712345678-photo.jpg`],
  ['media', `${A}/proxies/abcdef-1080p30.mp4`],
  ['media', `${A}/avatar/11111111-1111-4111-8111-000000000009.mp4`],
  ['videos', `${A}/autopilote-job1.mp4`],
  ['videos', `${A}/1712345678-montage.webm`],
  ['images', `${A}/poster-1712345678.jpg`],
  ['audio', `${A}/voix-1712345678.mp3`],
  ['media', `audio-complet/${A}/1712345678.mp3`],
  ['media', `stock-attributions/${A}/piste.json`],
];

beforeEach(() => {
  etat.appels.length = 0;
  etat.session = null;
});

describe('EXPLOIT #547 — un objet privé ne se lit plus en connaissant son URL', () => {
  it.each(OBJETS_A)('sans session : %s/%s → 404 neutre, MinIO jamais sondé', async (bucket, cle) => {
    const res = await lire(bucket, cle);
    expect(res.status).toBe(404);
    const corps = await res.text();
    expect(corps).toBe(JSON.stringify({ error: 'not found' }));
    expect(corps).not.toContain(A);
    expect(etat.appels).toHaveLength(0);
  });

  it.each(OBJETS_A)('avec la session de B : %s/%s → 404 neutre', async (bucket, cle) => {
    etat.session = { user: { id: B, email: 'b@example.com' } };
    const res = await lire(bucket, cle);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('HEAD sans session ne révèle ni l existence ni la taille', async () => {
    const res = await sonder('media', `${A}/rush/1712345678-mon-rush.mp4`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-length')).toBeNull();
    expect(etat.appels).toHaveLength(0);
  });

  it('objet présent et objet absent sont indistinguables pour un tiers', async () => {
    const present = await lire('media', `${A}/rush/existe.mp4`);
    const absent = await lire('media', `${A}/rush/n-existe-pas.mp4`);
    expect(present.status).toBe(absent.status);
    expect(await present.text()).toBe(await absent.text());
  });

  it('un préfixe d un autre compte ne se forge pas (u1x/ n est pas u1/)', async () => {
    etat.session = { user: { id: `${A}x` } };
    expect((await lire('media', `${A}/rush/a.mp4`)).status).toBe(404);
  });
});

describe('Le propriétaire, avec sa session, lit ses objets comme avant', () => {
  it.each(OBJETS_A)('A lit %s/%s', async (bucket, cle) => {
    etat.session = { user: { id: A } };
    const res = await lire(bucket, cle);
    expect(res.status).toBe(200);
  });

  it('Range 206 et HEAD (Calendrier, compositeur, atome moov) intacts', async () => {
    etat.session = { user: { id: A } };
    const partiel = await lire('media', `${A}/rush/a.mp4`, { range: 'bytes=0-99' });
    expect(partiel.status).toBe(206);
    expect(partiel.headers.get('content-range')).toBe('bytes 0-99/4096');
    const tete = await sonder('media', `${A}/rush/a.mp4`);
    expect(tete.status).toBe(200);
    expect(tete.headers.get('accept-ranges')).toBe('bytes');
  });

  it('les namespaces privés restent fermés MÊME au propriétaire (routes dédiées)', async () => {
    etat.session = { user: { id: A } };
    expect((await lire('media', `${A}/analyse/x/vignette-01.jpg`)).status).toBe(404);
    expect((await lire('media', `${A}/avatar/source-1757000000000.jpg`)).status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('un administrateur lit l objet d un compte (back-office vidéos)', async () => {
    etat.session = { user: { id: B, email: 'contact.artboost@gmail.com' } };
    expect((await lire('videos', `${A}/autopilote-job1.mp4`)).status).toBe(200);
  });
});

describe('Ce qui doit rester public le reste', () => {
  it('copies partagées de médias publics : media/externes/… sans session', async () => {
    expect((await lire('media', 'externes/0123456789abcdef.mp4')).status).toBe(200);
    expect((await lire('media', 'externes/proxies/0123456789abcdef.mp4')).status).toBe(200);
  });

  it('ancienne conversion converted/… (sans compte) : ni anonyme, ni tout compte connecté — administrateur seul', async () => {
    expect((await lire('videos', 'converted/1712345678-x.mp4')).status).toBe(404);
    etat.session = { user: { id: B } };
    expect((await lire('videos', 'converted/1712345678-x.mp4')).status).toBe(404);
    etat.session = { user: { id: B, email: 'contact.artboost@gmail.com' } };
    expect((await lire('videos', 'converted/1712345678-x.mp4')).status).toBe(200);
  });
});

describe('Jeton signé : le fournisseur (Meta, TikTok, Zernio, Remotion) lit sans cookie', () => {
  const cle = `${A}/autopilote-job1.mp4`;
  const urlNue = `${ORIGINE}/storage/v1/object/public/videos/${cle}`;

  it('jeton valide → 200 sans session ; Range conservé', async () => {
    const signee = signerUrlRelais(urlNue);
    const q = new URL(signee).search.slice(1);
    expect((await lire('videos', cle, { query: q })).status).toBe(200);
    expect((await lire('videos', cle, { query: q, range: 'bytes=0-9' })).status).toBe(206);
    expect((await sonder('videos', cle, { query: q })).status).toBe(200);
  });

  it('le chemin et l extension de l URL ne changent pas (Meta/TikTok/D-ID les lisent)', () => {
    const signee = new URL(signerUrlRelais(urlNue));
    expect(signee.pathname).toBe(`/storage/v1/object/public/videos/${cle}`);
    expect(signee.searchParams.get(PARAM_JETON_RELAIS)).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    // relative reste relative
    expect(signerUrlRelais(`/storage/v1/object/public/videos/${cle}`)).toMatch(/^\/storage\/v1\/object\/public\/videos\//);
  });

  it('jeton expiré → 404', async () => {
    const exp = Date.now() - 1000;
    const j = jetonRelais('videos', cle, exp)!;
    // fabriqué expiré : refusé
    expect(jetonRelaisValide('videos', cle, j)).toBe(false);
    expect((await lire('videos', cle, { query: `sr=${j}` })).status).toBe(404);
  });

  it('expiration au-delà du plafond → refusée même bien signée', () => {
    const j = jetonRelais('videos', cle, Date.now() + DUREE_JETON_RELAIS_MAX_MS + 60_000)!;
    expect(jetonRelaisValide('videos', cle, j)).toBe(false);
  });

  it('jeton altéré (signature ou expiration) → 404', async () => {
    const j = jetonRelais('videos', cle, Date.now() + 60_000)!;
    const [exp, sig] = j.split('.');
    const sigAlteree = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect((await lire('videos', cle, { query: `sr=${exp}.${sigAlteree}` })).status).toBe(404);
    expect((await lire('videos', cle, { query: `sr=${Number(exp) + 1000}.${sig}` })).status).toBe(404);
    expect((await lire('videos', cle, { query: 'sr=n-importe-quoi' })).status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('un jeton ne se transpose ni à une autre clé, ni à un autre compartiment', async () => {
    const j = jetonRelais('videos', cle, Date.now() + 60_000)!;
    expect((await lire('videos', `${A}/autre.mp4`, { query: `sr=${j}` })).status).toBe(404);
    expect((await lire('videos', `${B}/autopilote-job1.mp4`, { query: `sr=${j}` })).status).toBe(404);
    expect((await lire('media', cle, { query: `sr=${j}` })).status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('un jeton signé avec un autre secret → refusé', () => {
    const j = jetonRelais('videos', cle, Date.now() + 60_000, { AUTH_SECRET: 'autre-secret' } as unknown as NodeJS.ProcessEnv)!;
    expect(jetonRelaisValide('videos', cle, j)).toBe(false);
  });

  it('aucun jeton pour un namespace privé (analyse, source avatar, montage, LUT)', () => {
    const exp = Date.now() + 60_000;
    expect(jetonRelais('media', `${A}/analyse/x/vignette-01.jpg`, exp)).toBeNull();
    expect(jetonRelais('media', `${A}/avatar/source-1757000000000.jpg`, exp)).toBeNull();
    expect(signerUrlRelais(`/storage/v1/object/public/media/${A}/analyse/x/v.jpg`))
      .toBe(`/storage/v1/object/public/media/${A}/analyse/x/v.jpg`);
  });

  it('sans secret : on ne signe pas, on ne valide rien (jamais de repli ouvert)', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(signerUrlRelais(urlNue, {}, env)).toBe(urlNue);
    expect(jetonRelaisValide('videos', cle, `${Date.now() + 60_000}.${'A'.repeat(43)}`, Date.now(), env)).toBe(false);
  });

  it('URL externe ou présignée MinIO : inchangée', () => {
    expect(signerUrlRelais('https://cdn.example.com/a.mp4')).toBe('https://cdn.example.com/a.mp4');
    const presignee = 'https://minio.studiio.pro/videos/a.mp4?X-Amz-Signature=abc';
    expect(signerUrlRelais(presignee)).toBe(presignee);
  });
});

describe('Compositeur / canvas : lecture same-origin AVEC cookie (crossOrigin="anonymous")', () => {
  it('requête same-origin avec Origin + session du propriétaire → 200 et CORS de l application', async () => {
    etat.session = { user: { id: A } };
    const cle = `${A}/rush/a.mp4`;
    const res = await LIRE(new Request(`${ORIGINE}/storage/v1/object/public/media/${cle}`, {
      headers: { origin: ORIGINE, range: 'bytes=0-9' },
    }) as never, { params: Promise.resolve({ bucket: 'media', path: cle.split('/') }) });
    expect(res.status).toBe(206);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGINE);
  });
});

describe('Signature au nom d un compte (rendu, Zernio, Replicate, sondes) — jamais pour autrui', async () => {
  const { signerSiNotreStockage, signerUrlsRelaisProfond, retirerJetonRelais } = await import('@/lib/storage/jeton-relais');
  const PUB = `${ORIGINE}/storage/v1/object/public`;

  it('signe l objet du lecteur, pas celui d un autre compte (adjoint confus /api/render)', () => {
    expect(String(signerSiNotreStockage(`${PUB}/media/${A}/rush/a.mp4`, { lecteur: A }))).toContain('?sr=');
    expect(signerSiNotreStockage(`${PUB}/media/${B}/rush/b.mp4`, { lecteur: A })).toBe(`${PUB}/media/${B}/rush/b.mp4`);
    expect(signerSiNotreStockage(`${PUB}/videos/converted/x.mp4`, { lecteur: A })).toBe(`${PUB}/videos/converted/x.mp4`);
    // copies partagées publiques : signées pour tous (inoffensif, déjà publiques)
    expect(String(signerSiNotreStockage(`${PUB}/media/externes/abc.mp4`, { lecteur: A }))).toContain('?sr=');
  });

  it('jamais de jeton pour un AUTRE HÔTE qui imite notre chemin', () => {
    const imite = `https://evil.example/storage/v1/object/public/media/${A}/rush/a.mp4`;
    expect(signerSiNotreStockage(imite, { lecteur: A })).toBe(imite);
  });

  it('inputProps Remotion : profond, même URL → même jeton, autrui intact, rien d autre modifié', () => {
    const props = {
      titre: `${PUB}/media/${A}/rush/a.mp4 est un texte ?`,
      videoUrl: `${PUB}/media/${A}/rush/a.mp4`,
      montage: [{ url: `${PUB}/media/${A}/rush/a.mp4` }, { url: `${PUB}/media/${B}/rush/b.mp4` }],
      logo: 'https://cdn.example.com/logo.png',
      n: 3,
    };
    const signe = signerUrlsRelaisProfond(props, { lecteur: A });
    expect(signe.videoUrl).toContain('?sr=');
    expect(signe.montage[0].url).toBe(signe.videoUrl);
    expect(signe.montage[1].url).toBe(`${PUB}/media/${B}/rush/b.mp4`);
    expect(signe.logo).toBe(props.logo);
    expect(signe.n).toBe(3);
    // l'original n'est pas muté (rien de signé ne doit être persisté)
    expect(props.videoUrl).not.toContain('?sr=');
  });

  it('retirerJetonRelais : rien de signé ne se persiste', () => {
    const nue = `${PUB}/media/${A}/demo/1-demo.mp4`;
    const signee = String(signerSiNotreStockage(nue, { lecteur: A }));
    expect(retirerJetonRelais(signee)).toBe(nue);
    expect(retirerJetonRelais(`${nue}?a=1&sr=1.x#t=2`)).toBe(`${nue}?a=1#t=2`);
    expect(retirerJetonRelais(nue)).toBe(nue);
  });
});

describe('Le jeton ne fuit pas dans les erreurs', () => {
  it('un refus ne renvoie ni clé, ni compte, ni jeton', async () => {
    const j = jetonRelais('videos', `${A}/x.mp4`, Date.now() + 60_000)!;
    const res = await lire('videos', `${B}/x.mp4`, { query: `sr=${j}` });
    const corps = await res.text();
    expect(corps).toBe(JSON.stringify({ error: 'not found' }));
    expect(corps).not.toContain(j);
  });
});
