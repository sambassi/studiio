// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { urlStockAutorisee, normaliserConfigSources } from '@/lib/autopilot/sources';
import { sonderMediaStock, MAX_SAUTS } from '@/lib/autopilot/sonde-stock';

/**
 * SSRF — médias stock retenus.
 *
 *  1. Refus DIRECTS, avant tout appel réseau : boucle locale, métadonnées
 *     cloud, réseaux privés, IPv6 locales, encodages décimal / hexa / octal,
 *     point final, IDN, userinfo, domaines inconnus, hôte de l'application
 *     quand il est local.
 *  2. REDIRECTIONS : un hôte autorisé qui redirige vers une adresse privée
 *     ou inconnue → média lâché, et la cible ne reçoit AUCUNE requête
 *     (vrais serveurs HTTP locaux, compteurs de requêtes).
 *
 * Les serveurs de test écoutent sur 127.0.0.1 : ils ne sont « autorisés »
 * que par un prédicat INJECTÉ dans la sonde — le code de production ne
 * l'est jamais (vérifié au point 1).
 */

const OK_VIDEO = 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-1.mp4';
const CHEMIN = '/storage/v1/object/public/media/u1/x.mp4';

const DIRECTS: Array<[string, string]> = [
  ['boucle locale IPv4', `http://127.0.0.1${CHEMIN}`],
  ['localhost', `http://localhost${CHEMIN}`],
  ['localhost. (point final)', `http://localhost.${CHEMIN}`],
  ['métadonnées cloud', 'http://169.254.169.254/latest/meta-data/'],
  ['métadonnées cloud (chemin média)', `http://169.254.169.254${CHEMIN}`],
  ['10.x', `http://10.0.0.5${CHEMIN}`],
  ['172.16.x', `http://172.16.0.1${CHEMIN}`],
  ['172.31.x', `http://172.31.255.1${CHEMIN}`],
  ['192.168.x', `http://192.168.1.10${CHEMIN}`],
  ['0.0.0.0', `http://0.0.0.0${CHEMIN}`],
  ['[::1]', `http://[::1]${CHEMIN}`],
  ['[fc00::1]', `http://[fc00::1]${CHEMIN}`],
  ['[fd12::1]', `http://[fd12::1]${CHEMIN}`],
  ['[::ffff:127.0.0.1]', `http://[::ffff:127.0.0.1]${CHEMIN}`],
  ['décimal 2130706433', `http://2130706433${CHEMIN}`],
  ['hexa 0x7f000001', `http://0x7f000001${CHEMIN}`],
  ['octal 017700000001', `http://017700000001${CHEMIN}`],
  ['forme courte 127.1', `http://127.1${CHEMIN}`],
  ['décimal métadonnées 2852039166', `http://2852039166${CHEMIN}`],
  ['studiio.pro. (point final)', `https://studiio.pro.${CHEMIN}`],
  ['IDN homoglyphe (і cyrillique)', `https://studіio.pro${CHEMIN}`],
  ['sous-domaine piégé', `https://studiio.pro.evil.example${CHEMIN}`],
  ['suffixe piégé', `https://evilstudiio.pro${CHEMIN}`],
  ['userinfo', `https://user:pw@studiio.pro${CHEMIN}`],
  ['userinfo vers hôte tiers', `https://studiio.pro@evil.example${CHEMIN}`],
  ['domaine inconnu', `https://evil.example${CHEMIN}`],
  ['service Docker interne', `http://studiio-postgrest:3000${CHEMIN}`],
  ['minio interne', `http://studiio-minio:9000${CHEMIN}`],
  ['.internal', `http://metadata.google.internal${CHEMIN}`],
  ['schéma file:', 'file:///etc/passwd'],
  ['schéma ftp:', `ftp://studiio.pro${CHEMIN}`],
  ['chemin hors bucket media', 'https://studiio.pro/storage/v1/object/public/audio/x.mp3'],
  ['traversée encodée', 'https://studiio.pro/storage/v1/object/public/media/%2e%2e/%2e%2e/x'],
  ['photo : http (pas https)', 'http://images.pexels.com/photos/1.jpg'],
  ['photo : hôte piégé', 'https://images.pexels.com.evil.example/1.jpg'],
  ['photo : point final', 'https://images.pexels.com./1.jpg'],
  ['photo : userinfo', 'https://images.pexels.com@169.254.169.254/1.jpg'],
  ['photo : hôte IP', 'https://151.101.1.1/1.jpg'],
];

describe('refus directs, AVANT tout appel réseau', () => {
  it.each(DIRECTS)('%s → refusé (vidéo et photo), aucun fetch', async (_nom, url) => {
    expect(urlStockAutorisee(url, 'video')).toBe(false);
    expect(urlStockAutorisee(url, 'photo')).toBe(false);
    const espion = vi.fn(async () => new Response(null, { status: 200 }));
    for (const type of ['video', 'photo'] as const) {
      const r = await sonderMediaStock(url, type, { fetchImpl: espion as unknown as typeof fetch });
      expect(r).toEqual({ ok: false, motif: 'refusee', url });
    }
    expect(espion).not.toHaveBeenCalled();
  });

  it('enregistrement : `normaliserConfigSources` écarte les mêmes URL', () => {
    const c = normaliserConfigSources({
      actives: { stock: true },
      stock: DIRECTS.map(([, url], i) => ({ url, type: url.includes('pexels') ? 'photo' : 'video', provider: 'pexels', providerAssetId: String(i) })),
    })!;
    expect(c.stock).toEqual([]);
  });

  it('point de contrôle : nos URL légitimes passent', () => {
    expect(urlStockAutorisee(OK_VIDEO, 'video')).toBe(true);
    expect(urlStockAutorisee('https://images.pexels.com/photos/1/a.jpeg', 'photo')).toBe(true);
    expect(urlStockAutorisee('https://plus.unsplash.com/premium-1', 'photo')).toBe(true);
  });
});

describe('hôte de l’application (NEXT_PUBLIC_APP_URL) : jamais un passe-droit local', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    'http://localhost:3000', 'http://127.0.0.1:3000', 'http://studiio-app:3000', 'http://[::1]:3000',
    'http://192.168.1.20:3000', 'http://10.0.0.2', 'http://169.254.169.254', 'http://app.local',
    // Contournements trouvés par cette revue (corrigés dans `estHotePrive`) :
    'http://localhost.:3000', 'http://foo.localhost.:3000', 'http://100.64.0.1', 'http://[fe80::1]', 'http://[2001:db8::1]',
  ])('APP_URL=%s : son hôte reste refusé', (app) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', app);
    const u = new URL(app);
    expect(urlStockAutorisee(`${u.protocol}//${u.host}${CHEMIN}`, 'video')).toBe(false);
  });

  it('APP_URL publique (préproduction) : son stockage passe, rien d’autre', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.studiio.pro');
    expect(urlStockAutorisee(`https://staging.studiio.pro${CHEMIN}`, 'video')).toBe(true);
    expect(urlStockAutorisee(`https://staging.studiio.pro.evil.example${CHEMIN}`, 'video')).toBe(false);
    expect(urlStockAutorisee('https://staging.studiio.pro/1.jpg', 'photo')).toBe(false);
  });

  it('APP_URL illisible : seul studiio.pro reste autorisé', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'pas une url');
    expect(urlStockAutorisee(OK_VIDEO, 'video')).toBe(true);
    expect(urlStockAutorisee(`https://evil.example${CHEMIN}`, 'video')).toBe(false);
  });
});

// ── REDIRECTIONS — vrais serveurs HTTP locaux ──────────────────────────────

type Gestionnaire = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function serveur(g: Gestionnaire): Promise<{ srv: http.Server; port: number; hits: string[] }> {
  const hits: string[] = [];
  const srv = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); g(req, res); });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: (srv.address() as AddressInfo).port, hits })));
}

let autorise: Awaited<ReturnType<typeof serveur>>;
let prive: Awaited<ReturnType<typeof serveur>>;
let ferme: number;
/** Toutes les URL que la sonde a réellement demandées. */
const demandees: string[] = [];
const fetchTrace = (async (u: string | URL | Request, init?: RequestInit) => { demandees.push(String(u)); return fetch(u, init); }) as typeof fetch;

/** Prédicat de TEST : seul le serveur « autorisé » (son port) passe — même chemin exigé que la prod. */
const predicat = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' && u.port === String(autorise.port) && u.pathname.startsWith('/storage/v1/object/public/media/');
  } catch { return false; }
};
const M = (p: string) => `http://127.0.0.1:${autorise.port}/storage/v1/object/public/media/${p}`;

beforeAll(async () => {
  prive = await serveur((_q, r) => { r.writeHead(200); r.end('secret'); });
  autorise = await serveur((req, res) => {
    const p = (req.url ?? '').replace('/storage/v1/object/public/media/', '');
    const rediriger = (loc: string) => { res.writeHead(302, { Location: loc }); res.end(); };
    if (p === 'vers-prive.mp4') return rediriger(`http://127.0.0.1:${prive.port}/latest/meta-data/`);
    if (p === 'vers-meta.mp4') return rediriger('http://169.254.169.254/latest/meta-data/');
    if (p === 'vers-localhost.mp4') return rediriger(`http://localhost:${prive.port}/x`);
    if (p === 'vers-inconnu.mp4') return rediriger('https://evil.example/x.mp4');
    if (p === 'vers-decimal.mp4') return rediriger(`http://2130706433:${prive.port}/x`);
    if (p === 'sans-location.mp4') { res.writeHead(302); return res.end(); }
    if (p === 'relatif.mp4') return rediriger('/storage/v1/object/public/media/final.mp4');
    if (p === 'relatif-hors-chemin.mp4') return rediriger('../../../admin');
    if (p === 'saut1.mp4') return rediriger(M('saut2.mp4'));
    if (p === 'saut2.mp4') return rediriger(M('saut3.mp4'));
    if (p === 'saut3.mp4') return rediriger(M('final.mp4'));
    if (p === 'boucle.mp4') return rediriger(M('boucle.mp4'));
    if (p === 'chaine-puis-prive.mp4') return rediriger(M('vers-prive.mp4'));
    if (p === 'mort.mp4') { res.writeHead(404); return res.end(); }
    if (p === 'final.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  const tmp = await serveur(() => {});
  ferme = tmp.port;
  await new Promise((ok) => tmp.srv.close(ok));
});
afterAll(async () => {
  await Promise.all([autorise, prive].map((s) => new Promise((ok) => s.srv.close(ok))));
});
afterEach(() => { demandees.length = 0; prive.hits.length = 0; });

const sonder = (url: string) => sonderMediaStock(url, 'video', { autorisee: predicat, fetchImpl: fetchTrace, timeoutMs: 3000 });

describe('redirections : jamais suivies hors liste', () => {
  it.each([
    ['vers un autre port local (privé)', 'vers-prive.mp4'],
    ['vers 169.254.169.254', 'vers-meta.mp4'],
    ['vers localhost', 'vers-localhost.mp4'],
    ['vers un domaine inconnu', 'vers-inconnu.mp4'],
    ['vers une IP décimale', 'vers-decimal.mp4'],
    ['relative, hors du chemin autorisé', 'relatif-hors-chemin.mp4'],
    ['après un saut autorisé, vers le privé', 'chaine-puis-prive.mp4'],
  ])('%s → lâché, la cible ne reçoit rien', async (_nom, p) => {
    const r = await sonder(M(p));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motif).toBe('redirection-refusee');
    // Le serveur privé n'a reçu AUCUNE requête ; la sonde n'a demandé que l'hôte autorisé.
    expect(prive.hits).toEqual([]);
    expect(demandees.every(predicat)).toBe(true);
    expect(demandees.some((u) => u.includes('169.254') || u.includes('evil.example') || u.includes(`:${prive.port}`))).toBe(false);
  });

  it('302 sans Location → lâché', async () => {
    expect(await sonder(M('sans-location.mp4'))).toMatchObject({ ok: false, motif: 'redirection-refusee' });
  });

  it('autorisé → autorisé (Location relative) : URL FINALE rendue', async () => {
    expect(await sonder(M('relatif.mp4'))).toEqual({ ok: true, url: M('final.mp4'), sauts: 1 });
  });

  it(`au plus ${MAX_SAUTS} sauts suivis à la main ; au-delà, lâché`, async () => {
    expect(await sonder(M('saut1.mp4'))).toEqual({ ok: true, url: M('final.mp4'), sauts: 3 });
    demandees.length = 0;
    const boucle = await sonder(M('boucle.mp4'));
    expect(boucle).toMatchObject({ ok: false, motif: 'trop-de-redirections' });
    expect(demandees).toHaveLength(MAX_SAUTS + 1);
  });

  it('chaque requête part en HEAD, `redirect: manual`', async () => {
    const espion = vi.fn(fetchTrace);
    await sonderMediaStock(M('relatif.mp4'), 'video', { autorisee: predicat, fetchImpl: espion as unknown as typeof fetch });
    for (const c of espion.mock.calls) expect(c[1]).toMatchObject({ method: 'HEAD', redirect: 'manual' });
  });

  it('404 → introuvable ; hôte injoignable → lâché (le doute ne profite pas au stock)', async () => {
    expect(await sonder(M('mort.mp4'))).toMatchObject({ ok: false, motif: 'introuvable' });
    const pFerme = (u: string) => u.startsWith(`http://127.0.0.1:${ferme}/`);
    expect(await sonderMediaStock(`http://127.0.0.1:${ferme}/x.mp4`, 'video', { autorisee: pFerme, timeoutMs: 2000 }))
      .toMatchObject({ ok: false, motif: 'injoignable' });
  });

  it('témoin : un fetch ORDINAIRE aurait suivi la redirection jusqu’au serveur privé', async () => {
    await fetch(M('vers-prive.mp4'), { method: 'HEAD' });
    expect(prive.hits).toHaveLength(1);
  });
});
