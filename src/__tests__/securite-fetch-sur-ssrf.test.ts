// @vitest-environment node
/**
 * SSRF — LE FETCH SÛR ET LA FERMETURE DU TOCTOU DU RENDU.
 *
 * Vrais serveurs HTTP locaux, compteurs de requêtes :
 *   - `public`  : tient lieu de CDN / Pexels / Unsplash / fournisseur d'avatar ;
 *   - `prive`   : tient lieu d'un service interne (métadonnées, PostgREST…).
 * Un FAUX DNS (injecté) donne aux noms des adresses publiques ou privées ;
 * `connexionVers` envoie la connexion ÉPINGLÉE (adresse validée) vers le
 * serveur local correspondant. Aucune de ces injections n'existe en
 * production, et aucun défaut n'autorise 127.0.0.1 : les adresses locales
 * littérales sont refusées AVANT toute connexion (le serveur privé, qui écoute
 * réellement sur 127.0.0.1, ne reçoit rien).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ipInterdite, octetsIpv6, requeteSure, sonderSur, telechargerSur, lireSur, lookupEpingle,
  RefusSsrf, EchecFetchSur, type OptionsFetchSur, type AdresseResolue,
} from '@/lib/securite/fetch-sur';
import {
  localiserMedia, localiserEntreesRendu, localiserProprietesLibres, mediasEntreeRendu, estNotreStockage,
  cleMediaExterne, type DepotMedias,
} from '@/lib/securite/medias-externes';
import { sonderMediaStock } from '@/lib/autopilot/sonde-stock';
import { urlStockAutorisee } from '@/lib/autopilot/sources';
import { rushEncorePresent, probeRushSeconds } from '@/lib/autopilot/poster';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

// ── Serveurs ────────────────────────────────────────────────────────────
type Compteur = { hits: number; chemins: string[] };
const pub: Compteur = { hits: 0, chemins: [] };
const priv: Compteur = { hits: 0, chemins: [] };
let portPublic = 0;
let portPrive = 0;
let portStockage = 0;
let srvPublic: http.Server;
let srvPrive: http.Server;
let srvStockage: http.Server;
const stockageHits: string[] = [];

const racine = mkdtempSync(join(tmpdir(), 'studiio-ssrf-'));
let MP4: Buffer = Buffer.alloc(0);
const ffmpegStatic = (() => { try { return require('ffmpeg-static') as string | null; } catch { return null; } })();
const ffmpeg = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg';
const ffmpegDispo = (() => { try { execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function ecouter(srv: http.Server): Promise<number> {
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
}

beforeAll(async () => {
  const fichier = join(racine, 'clip.mp4');
  try {
    execFileSync(ffmpeg, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', fichier], { stdio: 'ignore' });
    MP4 = readFileSync(fichier);
  } catch { MP4 = Buffer.alloc(0); }

  srvPublic = http.createServer((req, res) => {
    pub.hits += 1;
    const chemin = req.url ?? '/';
    pub.chemins.push(`${req.method} ${req.headers.host}${chemin}`);
    if (chemin.startsWith('/redir-prive')) { res.writeHead(302, { Location: 'http://prive.example/secret' }); res.end(); return; }
    if (chemin.startsWith('/redir-meta')) { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
    if (chemin.startsWith('/redir-loopback')) { res.writeHead(307, { Location: `http://127.0.0.1:${portPrive}/x` }); res.end(); return; }
    if (chemin.startsWith('/redir-rebind')) { res.writeHead(302, { Location: 'http://rebind.example/fichier.mp4' }); res.end(); return; }
    const chaine = /^\/chaine\/(\d+)\/(\d+)/.exec(chemin);
    if (chaine) {
      const [n, total] = [Number(chaine[1]), Number(chaine[2])];
      if (n < total) { res.writeHead(302, { Location: `/chaine/${n + 1}/${total}` }); res.end(); return; }
    }
    if (chemin.startsWith('/mort')) { res.writeHead(404); res.end(); return; }
    if (chemin.startsWith('/gros')) { res.writeHead(200, { 'Content-Length': String(10_000_000) }); res.end(); return; }
    if (chemin.startsWith('/menteur')) { res.writeHead(200); res.write(Buffer.alloc(4096)); res.end(Buffer.alloc(4096)); return; }
    if (chemin.includes('.mp4')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) }); res.end(req.method === 'HEAD' ? undefined : MP4); return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from('IMAGE'));
  });
  srvPrive = http.createServer((req, res) => { priv.hits += 1; priv.chemins.push(`${req.method} ${req.url}`); res.writeHead(200); res.end('SECRET'); });
  srvStockage = http.createServer((req, res) => { stockageHits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(req.method === 'HEAD' ? undefined : MP4); });
  [portPublic, portPrive, portStockage] = await Promise.all([ecouter(srvPublic), ecouter(srvPrive), ecouter(srvStockage)]);
});

afterAll(async () => {
  await Promise.all([srvPublic, srvPrive, srvStockage].map((s) => new Promise((r) => s.close(r))));
  rmSync(racine, { recursive: true, force: true });
});

beforeEach(() => {
  pub.hits = 0; pub.chemins = [];
  priv.hits = 0; priv.chemins = [];
  stockageHits.length = 0;
});

// ── Faux DNS + connexion épinglée ───────────────────────────────────────
const IP_PUBLIQUES: Record<string, string> = {
  'cdn.example': '93.184.216.34',
  'images.pexels.com': '93.184.216.35',
  'images.unsplash.com': '93.184.216.36',
  'avatar-cdn.example': '93.184.216.37',
  'files.example': '93.184.216.38',
};
const IP_PRIVEES: Record<string, string> = {
  'prive.example': '10.0.0.5',
  localhost: '127.0.0.1',
  'meta.example': '169.254.169.254',
  'v6.example': 'fd00::1',
};
const PUBLIQUES = new Set(Object.values(IP_PUBLIQUES));
let appelsDns: string[] = [];
let rebind = 0;
const resoudre = async (hote: string): Promise<AdresseResolue[]> => {
  appelsDns.push(hote);
  if (hote === 'rebind.example') {
    rebind += 1;
    return [{ address: rebind === 1 ? '93.184.216.99' : '10.0.0.66', family: 4 }];
  }
  if (hote === 'mixte.example') return [{ address: '93.184.216.40', family: 4 }, { address: '192.168.0.10', family: 4 }];
  const ip = IP_PUBLIQUES[hote] ?? IP_PRIVEES[hote];
  if (!ip) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return [{ address: ip, family: ip.includes(':') ? 6 : 4 }];
};
/** Adresse validée → serveur local : publique → `public`, toute autre → `prive`. */
const connexionVers = (ip: string) => ({ host: '127.0.0.1', port: PUBLIQUES.has(ip) || ip.startsWith('93.184.216.') ? portPublic : portPrive });
const RESEAU: OptionsFetchSur = { resoudre, connexionVers, originesDeConfiance: [], timeoutMs: 5_000 };

beforeEach(() => { appelsDns = []; rebind = 0; });

async function refus(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof RefusSsrf) return e.motif; throw e; }
  throw new Error('aucun refus');
}

// ═════════════════════════════════════════════════════════════════════════
describe('politique d’adresses (pure)', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '::127.0.0.1',
    '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:db8::1', '2001:0:1::1', 'pas-une-ip', '',
  ])('%s → interdite', (ip) => {
    expect(ipInterdite(ip)).toBe(true);
  });
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2a00:1450:4007::64'])('%s → autorisée', (ip) => {
    expect(ipInterdite(ip)).toBe(false);
  });
  it('IPv6 : formes compressées et queue IPv4 lues octet par octet', () => {
    expect(octetsIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1]);
    expect(octetsIpv6('fe80::1')?.slice(0, 2)).toEqual([0xfe, 0x80]);
    expect(octetsIpv6('1:2:3')).toBeNull();
  });
  it('épinglage : le lookup injecté répond TOUJOURS l’adresse validée, sans résoudre', () => {
    const l = lookupEpingle({ address: '93.184.216.34', family: 4 });
    const un = vi.fn();
    l('rebind.example', { family: 0 }, un);
    expect(un).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const tous = vi.fn();
    l('autre.example', { all: true }, tous);
    expect(tous).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('cibles refusées AVANT toute connexion', () => {
  const directs: Array<[string, () => string]> = [
    ['localhost (DNS → 127.0.0.1)', () => `http://localhost:${portPrive}/x`],
    ['127.0.0.1 littéral (le serveur privé écoute VRAIMENT là)', () => `http://127.0.0.1:${portPrive}/x`],
    ['169.254.169.254', () => 'http://169.254.169.254/latest/meta-data/'],
    ['10.x', () => 'http://10.0.0.5/'],
    ['172.16.x', () => 'http://172.16.0.1/'],
    ['192.168.x', () => 'http://192.168.1.10/'],
    ['[::1]', () => `http://[::1]:${portPrive}/`],
    ['[fc00::1]', () => 'http://[fc00::1]/'],
    ['[fe80::1]', () => 'http://[fe80::1]/'],
    ['[::ffff:127.0.0.1]', () => `http://[::ffff:127.0.0.1]:${portPrive}/`],
    ['décimal 2130706433', () => `http://2130706433:${portPrive}/`],
    ['hexa 0x7f000001', () => `http://0x7f000001:${portPrive}/`],
    ['forme courte 127.1', () => `http://127.1:${portPrive}/`],
    ['nom → 10.0.0.5', () => 'http://prive.example/'],
    ['nom → 169.254.169.254', () => 'http://meta.example/'],
    ['nom → fd00::1', () => 'http://v6.example/'],
    ['nom → public + privé (mixte)', () => 'http://mixte.example/'],
  ];
  it.each(directs)('%s', async (_n, url) => {
    expect(await refus(requeteSure(url(), RESEAU))).toBe('ip-interdite');
    expect(priv.hits).toBe(0);
    expect(pub.hits).toBe(0);
  });
  it.each([
    ['userinfo', 'http://user:pw@cdn.example/x.jpg', 'identifiants'],
    ['file:', 'file:///etc/passwd', 'schema'],
    ['ftp:', 'ftp://cdn.example/x', 'schema'],
    ['gopher:', 'gopher://cdn.example/x', 'schema'],
    ['invalide', 'http://', 'url-invalide'],
  ])('%s → %s', async (_n, url, motif) => {
    expect(await refus(requeteSure(url, RESEAU))).toBe(motif);
    expect(appelsDns).toEqual([]);
    expect(pub.hits + priv.hits).toBe(0);
  });
  it('domaine inconnu (NXDOMAIN) : échec RÉSEAU, aucune requête', async () => {
    await expect(requeteSure('http://inconnu.example/x', RESEAU)).rejects.toBeInstanceOf(EchecFetchSur);
    expect(pub.hits + priv.hits).toBe(0);
  });
  it('les DÉFAUTS de production n’autorisent pas la boucle locale (aucune injection)', async () => {
    expect(await refus(requeteSure(`http://127.0.0.1:${portPrive}/x`, { originesDeConfiance: [] }))).toBe('ip-interdite');
    expect(await refus(requeteSure(`http://localhost:${portPrive}/x`, { originesDeConfiance: [] }))).toBe('ip-interdite');
    expect(priv.hits).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('redirections : chaque saut revalidé (prédicat + DNS + adresses)', () => {
  it.each([
    ['vers un nom privé', '/redir-prive'],
    ['vers 169.254.169.254', '/redir-meta'],
    ['vers 127.0.0.1 (le serveur privé)', '/redir-loopback'],
  ])('autorisé → %s : refusé, la cible privée reçoit 0 requête', async (_n, chemin) => {
    expect(await refus(requeteSure(`http://cdn.example${chemin}`, RESEAU))).toBe('ip-interdite');
    expect(pub.hits).toBe(1);
    expect(priv.hits).toBe(0);
  });
  it('3 sauts : suivis ; 4 : refusés', async () => {
    const r = await requeteSure('http://cdn.example/chaine/0/3/x.jpg', RESEAU);
    r.annuler();
    expect(r.status).toBe(200);
    expect(r.sauts).toBe(3);
    pub.hits = 0;
    expect(await refus(requeteSure('http://cdn.example/chaine/0/4', RESEAU))).toBe('trop-de-redirections');
    expect(pub.hits).toBe(4);
  });
  it('prédicat d’hôte rejoué sur chaque Location', async () => {
    const seulementCdn = (u: URL) => u.hostname === 'cdn.example';
    expect(await refus(requeteSure('http://cdn.example/redir-rebind', { ...RESEAU, autorisee: seulementCdn }))).toBe('hote-refuse');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('DNS rebinding', () => {
  it('résolu UNE fois par saut, connexion ÉPINGLÉE sur l’adresse validée : le serveur privé n’est jamais touché', async () => {
    const r = await requeteSure('http://rebind.example/fichier.mp4', RESEAU);
    r.annuler();
    expect(r.status).toBe(200);
    expect(appelsDns.filter((h) => h === 'rebind.example')).toHaveLength(1);
    expect(pub.hits).toBe(1);
    expect(priv.hits).toBe(0);
  });
  it('rebinding entre deux sauts : la seconde résolution (privée) est refusée', async () => {
    rebind = 1; // le prochain appel rendra l’adresse privée
    expect(await refus(requeteSure('http://cdn.example/redir-rebind', RESEAU))).toBe('ip-interdite');
    expect(priv.hits).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('légitimes', () => {
  it('Pexels / Unsplash / CDN public (DNS public) : servis', async () => {
    for (const url of ['https://images.pexels.com/photos/1/a.jpeg', 'https://images.unsplash.com/photo-2?w=1080']) {
      const http1 = url.replace('https://', 'http://'); // serveurs de test en clair
      const r = await lireSur(http1, RESEAU);
      expect(Buffer.from(r.octets).toString()).toBe('IMAGE');
    }
    expect(priv.hits).toBe(0);
  });
  it('notre stockage (origine de confiance) : servi sans contrôle d’adresse, même en 127.0.0.1', async () => {
    const base = `http://127.0.0.1:${portStockage}`;
    const r = await sonderSur(`${base}/storage/v1/object/public/media/u1/rush.mp4`, { originesDeConfiance: [base] });
    expect(r.status).toBe(200);
    expect(stockageHits).toEqual(['HEAD /storage/v1/object/public/media/u1/rush.mp4']);
  });
  it('plafonds : Content-Length annoncé trop gros, et flux qui ment', async () => {
    const dest = join(racine, 'gros.bin');
    await expect(telechargerSur('http://cdn.example/gros', dest, { ...RESEAU, maxOctets: 1000 })).rejects.toMatchObject({ motif: 'trop-volumineux' });
    await expect(telechargerSur('http://cdn.example/menteur', dest, { ...RESEAU, maxOctets: 5000 })).rejects.toMatchObject({ motif: 'trop-volumineux' });
    expect(existsSync(dest)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('stock (sonderMediaStock, chemin de production)', () => {
  const sonde = (url: string, t: 'video' | 'photo' = 'photo') =>
    sonderMediaStock(url.replace('https://', 'http://'), t, { reseau: RESEAU, autorisee: (u, ty) => urlStockAutorisee(u.replace('http://', 'https://'), ty) });
  it('domaine inconnu : refusé avant toute requête', async () => {
    expect(await sonderMediaStock('https://evil.example/x.jpg', 'photo', { reseau: RESEAU })).toMatchObject({ ok: false, motif: 'refusee' });
    expect(appelsDns).toEqual([]);
  });
  it('Pexels légitime : présent', async () => {
    expect(await sonde('https://images.pexels.com/photos/1/a.jpeg')).toMatchObject({ ok: true });
  });
  it('Unsplash légitime : présent', async () => {
    expect(await sonde('https://images.unsplash.com/photo-2')).toMatchObject({ ok: true });
  });
  it('Pexels qui redirige vers un service interne : lâché, 0 requête privée', async () => {
    expect(await sonde('https://images.pexels.com/redir-meta')).toMatchObject({ ok: false });
    expect(priv.hits).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('sondes Autopilote : rushes, musique, avatar', () => {
  it('rushEncorePresent : cible privée → ABSENT et jamais contactée', async () => {
    expect(await rushEncorePresent(`http://127.0.0.1:${portPrive}/rush.mp4`, 2000, RESEAU)).toBe(false);
    expect(await rushEncorePresent('http://prive.example/rush.mp4', 2000, RESEAU)).toBe(false);
    expect(await rushEncorePresent('http://cdn.example/redir-prive', 2000, RESEAU)).toBe(false);
    expect(priv.hits).toBe(0);
  });
  it('rushEncorePresent : 404 → absent ; réseau muet → présent (le doute profite au rush) ; légitime → présent', async () => {
    expect(await rushEncorePresent('http://cdn.example/mort.mp4', 2000, RESEAU)).toBe(false);
    expect(await rushEncorePresent('http://inconnu.example/rush.mp4', 2000, RESEAU)).toBe(true);
    expect(await rushEncorePresent('http://cdn.example/rush.mp4', 2000, RESEAU)).toBe(true);
  });
  it('musique (même sonde) : URL interne → absente, jamais contactée', async () => {
    expect(await rushEncorePresent('http://meta.example/musique.mp3', 2000, RESEAU)).toBe(false);
    expect(priv.hits).toBe(0);
  });
  it('probeRushSeconds : vidéo d’avatar interne → null, jamais contactée', async () => {
    expect(await probeRushSeconds(`http://127.0.0.1:${portPrive}/avatar.mp4`, RESEAU)).toBeNull();
    expect(await probeRushSeconds('http://cdn.example/redir-prive', RESEAU)).toBeNull();
    expect(priv.hits).toBe(0);
  });
  it.skipIf(!ffmpegDispo)('probeRushSeconds : vidéo externe légitime téléchargée par le fetch sûr puis lue en FICHIER', async () => {
    expect(MP4.length).toBeGreaterThan(0);
    const s = await probeRushSeconds('http://avatar-cdn.example/gen-1.mp4', RESEAU);
    expect(s).toBeGreaterThan(1.5);
    expect(s).toBeLessThan(2.5);
    // Une seule lecture, un GET : parseMedia n’a pas relu l’URL lui-même.
    expect(pub.chemins).toEqual(['GET avatar-cdn.example/gen-1.mp4']);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('localisation : le rendu ne reçoit que NOTRE stockage', () => {
  const ORIGINES = ['https://stockage.example'];
  const S = 'https://stockage.example/storage/v1/object/public/media/u1/';
  function depotMemoire() {
    const objets = new Map<string, number>();
    const depot: DepotMedias = {
      existe: async (b, c) => objets.has(`${b}/${c}`),
      deposer: async (b, c, _f, taille) => { objets.set(`${b}/${c}`, taille); },
      urlPublique: (b, c) => `https://stockage.example/storage/v1/object/public/${b}/${c}`,
    };
    return { depot, objets };
  }

  it('déjà chez nous : inchangé, aucun réseau', async () => {
    const { depot } = depotMemoire();
    expect(await localiserMedia(`${S}rush.mp4`, { depot, origines: ORIGINES, reseau: RESEAU })).toBe(`${S}rush.mp4`);
    expect(pub.hits + priv.hits).toBe(0);
  });
  it('externe légitime : copié UNE fois (cache ensuite)', async () => {
    const { depot, objets } = depotMemoire();
    const u = 'http://images.pexels.com/photos/9/b.jpeg';
    const a = await localiserMedia(u, { depot, origines: ORIGINES, reseau: RESEAU, genre: 'image' });
    const b = await localiserMedia(u, { depot, origines: ORIGINES, reseau: RESEAU, genre: 'image' });
    expect(a).toBe(b);
    expect(estNotreStockage(a, ORIGINES)).toBe(true);
    expect(a.endsWith(cleMediaExterne(u, 'image'))).toBe(true);
    expect(objets.size).toBe(1);
    expect(pub.hits).toBe(1);
  });
  it('externe interne : refusé, rien déposé, jamais de repli sur l’URL d’origine', async () => {
    const { depot, objets } = depotMemoire();
    await expect(localiserMedia('http://cdn.example/redir-meta', { depot, origines: ORIGINES, reseau: RESEAU })).rejects.toBeInstanceOf(RefusSsrf);
    expect(objets.size).toBe(0);
    expect(priv.hits).toBe(0);
  });
  it('un hôte qui IMITE le chemin de stockage n’est pas « notre stockage »', () => {
    expect(estNotreStockage('https://evil.example/storage/v1/object/public/media/u1/x.mp4', ORIGINES)).toBe(false);
  });

  it('INSTANTANÉ de l’entrée de rendu : chaque média externe (rushes, stock, photos, musique, avatar, affiche, voix) → notre stockage', async () => {
    const { depot } = depotMemoire();
    const AV = 'http://avatar-cdn.example/gen-7.mp4';
    const design: CreerSimpleRenderInput = {
      title: 'Titre https://ne-pas-toucher.example',
      watermark: 'https://monsite.example',
      posterUrl: 'http://images.unsplash.com/photo-3',
      sequenceBackgrounds: { cta: 'http://images.pexels.com/photos/4/c.jpeg', titre: null },
      videoUrl: AV,
      rushs: [{ url: `${S}rush-a.mp4`, secondes: 10 }, { url: 'http://files.example/rush-ext.mp4', secondes: 8 }],
      montage: [
        { url: AV, debut: 0, fin: 3, kind: 'avatar' } as never,
        { url: `${S}stock-pexels-video-1.mp4`, debut: 3, fin: 6 } as never,
        { url: 'http://images.pexels.com/photos/5/d.jpeg', debut: 6, fin: 8, kind: 'image' } as never,
        { url: 'http://files.example/rush-ext.mp4', debut: 8, fin: 10 } as never,
      ],
      musicUrl: 'http://files.example/musique.mp3',
      sequenceVoiceUrls: { video: AV, titre: `${S}voix-titre.mp3` },
      voiceUrl: null,
    };
    const rendu = await localiserEntreesRendu(design, { depot, origines: ORIGINES, reseau: RESEAU });
    const medias = mediasEntreeRendu(rendu);
    expect(medias.length).toBeGreaterThanOrEqual(11);
    for (const m of medias) expect(estNotreStockage(m.url, ORIGINES), m.url).toBe(true);
    // Textes intacts ; même fichier → même copie (avatar image + voix).
    expect(rendu.title).toBe(design.title);
    expect(rendu.watermark).toBe(design.watermark);
    expect(rendu.videoUrl).toBe(rendu.sequenceVoiceUrls?.video);
    expect(rendu.montage?.[0].url).toBe(rendu.videoUrl);
    expect(rendu.sequenceBackgrounds?.titre).toBeNull();
    // Chaque fichier externe distinct lu UNE fois.
    expect(new Set(pub.chemins).size).toBe(pub.chemins.length);
    expect(priv.hits).toBe(0);
  });

  it('entrée de rendu avec un média interne : le rendu ÉCHOUE (aucun repli), 0 requête privée', async () => {
    const { depot } = depotMemoire();
    await expect(localiserEntreesRendu({ title: 't', musicUrl: 'http://prive.example/m.mp3' }, { depot, origines: ORIGINES, reseau: RESEAU }))
      .rejects.toBeInstanceOf(RefusSsrf);
    expect(priv.hits).toBe(0);
  });

  it('/api/render — propriétés libres : URL de média copiées, textes intacts, cible interne refusée', async () => {
    const { depot } = depotMemoire();
    const props = {
      ctaText: 'https://monsite.example',
      title: 'Voir https://x.example',
      logoUrl: 'http://images.pexels.com/photos/7/logo.png',
      videos: ['http://files.example/clip.mp4', `${S}clip2.mp4`],
      clips: [{ src: 'http://files.example/clip3.mp4' }],
      backgroundAudio: 'http://files.example/fond.mp3',
    };
    const sortie = await localiserProprietesLibres(props, { depot, origines: ORIGINES, reseau: RESEAU });
    expect(sortie.ctaText).toBe(props.ctaText);
    expect(sortie.title).toBe(props.title);
    for (const u of [sortie.logoUrl, ...sortie.videos, sortie.clips[0].src, sortie.backgroundAudio]) expect(estNotreStockage(u, ORIGINES)).toBe(true);
    await expect(localiserProprietesLibres({ characterImage: 'http://meta.example/latest' }, { depot, origines: ORIGINES, reseau: RESEAU }))
      .rejects.toBeInstanceOf(RefusSsrf);
    expect(priv.hits).toBe(0);
  });
});
