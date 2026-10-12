// @vitest-environment node
/**
 * SSRF PAR LA PUBLICATION — cron → `publierViaZernio` → `uploadMedia`.
 *
 * Le trou : `scheduled_posts.media_url` (écrit par le navigateur) était lu
 * par un `fetch()` nu dans `uploadMedia`, et ses octets publiés chez Zernio
 * sur le compte de l'auteur du post. L'erreur recopiait statut + URL dans
 * `metadata.error`.
 *
 * Ici, le VRAI chemin : route du cron, `preparerMediaZernio`,
 * `publierViaZernio`, `uploadMedia`, `lireMediaPublication`, fetch sûr. Seuls
 * sont doublés : la base (en mémoire), les droits/comptes, et le RÉSEAU —
 * `fetch` global pour l'API Zernio, faux DNS + `connexionVers` (injectés dans
 * `telechargerSur`) vers des serveurs HTTP locaux. Aucune requête ne sort de
 * la machine.
 *
 *   - `prive`    : écoute réellement sur 127.0.0.1 ; tient lieu de service
 *                  interne. Il doit recevoir ZÉRO requête dans tout ce fichier.
 *   - `public`   : tient lieu d'un hôte Internet (redirections, vidéo).
 *   - `stockage` : notre stockage (origine configurée `NEXT_PUBLIC_APP_URL`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { NextRequest } from 'next/server';
import type { AdresseResolue, OptionsFetchSur } from '@/lib/securite/fetch-sur';

// ── Serveurs locaux ─────────────────────────────────────────────────────
const MP4 = Buffer.from(`ftypisom-FAUX-MP4-${'x'.repeat(2048)}`);
const priv = { hits: 0 };
const pub = { hits: 0, chemins: [] as string[] };
const stock = { hits: 0, chemins: [] as string[] };
let portPrive = 0;
let portPublic = 0;
let portStockage = 0;
const serveurs: http.Server[] = [];

function ecouter(srv: http.Server): Promise<number> {
  serveurs.push(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
}

// ── Faux DNS + connexion épinglée vers le bon serveur local ─────────────
const IP_PUBLIQUE = '93.184.216.34';
const DNS: Record<string, string[]> = {
  'public.example': [IP_PUBLIQUE],
  'prive.example': ['10.0.0.7'],
  'localhost': ['127.0.0.1'],
  'mixte.example': [IP_PUBLIQUE, '192.168.1.10'],
  'meta.example': ['169.254.169.254'],
};
const resolutions: string[] = [];
const resoudre = async (hote: string): Promise<AdresseResolue[]> => {
  resolutions.push(hote);
  const ips = DNS[hote];
  if (!ips) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};
// Toute adresse non publique est envoyée au serveur PRIVÉ : si le code
// laissait passer une cible interdite, le compteur le verrait.
const connexionVers = (ip: string) => ({ host: '127.0.0.1', port: ip === IP_PUBLIQUE ? portPublic : portPrive });

vi.mock('@/lib/securite/fetch-sur', async (orig) => {
  const actual = await orig<typeof import('@/lib/securite/fetch-sur')>();
  return {
    ...actual,
    telechargerSur: (url: string, dest: string, opts: OptionsFetchSur = {}) =>
      actual.telechargerSur(url, dest, { ...opts, resoudre, connexionVers, timeoutMs: 5_000 }),
  };
});

// ── Base en mémoire (filtres évalués) ───────────────────────────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = { scheduled_posts: [], social_accounts: [] };
function chaine(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let maj: Ligne | null = null;
  let limite = Infinity;
  const valeur = (l: Ligne, col: string) => {
    const m = col.match(/^(\w+)->>(\w+)$/);
    if (m) { const v = l[m[1]]?.[m[2]]; return v === undefined || v === null ? null : String(v); }
    return l[col];
  };
  const executer = () => {
    const lignes = (base[table] ?? []).filter((l) => filtres.every((f) => f(l)));
    if (maj) for (const l of lignes) Object.assign(l, maj);
    return { data: lignes.slice(0, limite).map((l) => ({ ...l })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (v: Ligne) => { maj = v; return b; },
    insert: () => b,
    eq: (c: string, v: unknown) => { filtres.push((l) => valeur(l, c) === v); return b; },
    lt: (c: string, v: string) => { filtres.push((l) => String(valeur(l, c)) < v); return b; },
    is: (c: string, v: null) => { filtres.push((l) => valeur(l, c) === v); return b; },
    in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(valeur(l, c))); return b; },
    or: () => b,
    order: () => b,
    limit: (n: number) => { limite = n; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(executer()).then(res, rej),
  };
  return b;
}
vi.mock('@/lib/db/supabase', () => {
  const client = { from: (t: string) => chaine(t) };
  return { supabaseAdmin: client, supabase: client };
});

// Droits et comptes : autorisé, un compte Instagram connecté.
vi.mock('@/lib/social/publishing', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/publishing')>()),
  comptesConnectes: async () => [{ platform: 'instagram', accountId: 'acc-ig', username: 'u' }],
  droitDePublier: async () => ({ autorise: true, admin: false }),
}));
vi.mock('@/lib/storage/fetch-media', () => ({ downloadMediaToFile: vi.fn() }));
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({ transcodeWebmToMp4WithLadder: vi.fn() }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton' }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false, canUseWhatsApp: () => false, broadcastWhatsApp: vi.fn(),
  resolveRecipients: () => [], MAX_RECIPIENTS: 0, formatBroadcastFailures: () => '',
}));
vi.mock('@/lib/social/subscribers', () => ({ fetchSubscribers: async () => [], unsubscribeUrl: () => '' }));
vi.mock('@/lib/email/unsubscribe', () => ({
  unsubscribeEndpoint: () => '', filterSuppressed: async (l: unknown[]) => l,
  isSuppressed: async () => false, canUnsubscribe: async () => false,
}));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));

// ── API Zernio doublée au niveau `fetch` (le client Zernio est le VRAI) ──
const appelsZernio: string[] = [];
const depots: Buffer[] = [];
const autresFetch: string[] = [];
function fetchZernio() {
  return vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    if (u.startsWith('https://zernio.com/api/v1/media/presign')) {
      appelsZernio.push('presign');
      return Response.json({ uploadUrl: 'https://depot.zernio.test/up', publicUrl: 'https://depot.zernio.test/media.mp4' });
    }
    if (u === 'https://depot.zernio.test/up') {
      depots.push(Buffer.from(init?.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (u.startsWith('https://zernio.com/api/v1/posts')) {
      appelsZernio.push('posts');
      return Response.json({ _id: 'zp-1' });
    }
    // Le média ne doit JAMAIS passer par `fetch` nu.
    autresFetch.push(u);
    throw new Error('fetch inattendu en test');
  });
}

const SECRET = 'secret-cron-ssrf';
async function lancerCron() {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(new NextRequest('http://localhost:3000/api/cron/publish?force=true', {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
  return res.json();
}
function post(mediaUrl: string): Ligne {
  return {
    id: 'p1', user_id: 'user-1', title: 'Post', caption: 'legende', platforms: ['instagram'],
    status: 'scheduled', scheduled_date: '2026-01-01', scheduled_time: '08:00',
    updated_at: new Date().toISOString(), video_id: null, videos: null, format: 'reel',
    users: { email: 'user@test.local', name: 'User' },
    media_url: mediaUrl, metadata: { design: { titleColor: '#FFF' } },
  };
}

const ENV_AVANT = { ...process.env };
beforeAll(async () => {
  portPrive = await ecouter(http.createServer((_req, res) => { priv.hits += 1; res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('SECRET-INTERNE'); }));
  portPublic = await ecouter(http.createServer((req, res) => {
    pub.hits += 1;
    const chemin = req.url ?? '/';
    pub.chemins.push(chemin);
    if (chemin.startsWith('/redir-loopback')) { res.writeHead(302, { Location: `http://127.0.0.1:${portPrive}/secret.mp4` }); res.end(); return; }
    if (chemin.startsWith('/redir-dns-prive')) { res.writeHead(302, { Location: 'http://prive.example/secret.mp4' }); res.end(); return; }
    if (chemin.startsWith('/redir-meta')) { res.writeHead(307, { Location: 'http://169.254.169.254/latest/meta-data/x.mp4' }); res.end(); return; }
    const c = /^\/chaine\/(\d+)\/(\d+)/.exec(chemin);
    if (c && Number(c[1]) < Number(c[2])) { res.writeHead(302, { Location: `/chaine/${Number(c[1]) + 1}/${c[2]}.mp4` }); res.end(); return; }
    if (chemin.includes('/absent')) { res.writeHead(404); res.end('page 404 interne'); return; }
    if (chemin.endsWith('.mp4')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) }); res.end(MP4); return; }
    res.writeHead(404); res.end();
  }));
  portStockage = await ecouter(http.createServer((req, res) => {
    stock.hits += 1;
    stock.chemins.push(req.url ?? '');
    if ((req.url ?? '').startsWith('/storage/v1/object/public/media/')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) }); res.end(MP4); return; }
    res.writeHead(404); res.end();
  }));
});
afterAll(async () => {
  process.env = ENV_AVANT;
  await Promise.all(serveurs.map((s) => new Promise((r) => s.close(r))));
});

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.ZERNIO_API_KEY = 'cle-zernio-de-test';
  // Notre stockage = le serveur local `stockage` (origine de CONFIANCE).
  process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${portStockage}`;
  delete process.env.NEXTAUTH_URL;
  delete process.env.PUBLIC_STORAGE_URL;
  process.env.SUPABASE_LEGACY_STORAGE_URL = '';
  base.scheduled_posts = [];
  appelsZernio.length = 0;
  depots.length = 0;
  autresFetch.length = 0;
  resolutions.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchZernio());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Ce qu'aucun message visible ne doit porter. */
function fuites(texte: string): string[] {
  const motifs = ['127.0.0.1', 'localhost', '10.0.0', '172.16', '192.168', '169.254', '::1', 'fc00',
    '2130706433', '0x7f', 'prive.example', 'meta.example', 'mixte.example', 'public.example',
    String(portPrive), String(portPublic), 'http', 'ECONNREFUSED'];
  return motifs.filter((m) => texte.includes(m));
}

describe('cron → publierViaZernio : média interne REFUSÉ avant toute lecture', () => {
  const refusees: Array<[string, () => string]> = [
    ['boucle locale 127.0.0.1', () => `http://127.0.0.1:${portPrive}/secret.mp4`],
    ['localhost (résolu en 127.0.0.1)', () => `http://localhost:${portPrive}/secret.mp4`],
    ['127.0.0.1 en décimal', () => `http://2130706433:${portPrive}/secret.mp4`],
    ['127.0.0.1 en hexadécimal court', () => `http://0x7f.1:${portPrive}/secret.mp4`],
    ['10.0.0.5', () => 'http://10.0.0.5/secret.mp4'],
    ['172.16.0.1', () => 'http://172.16.0.1/secret.mp4'],
    ['192.168.1.1', () => 'http://192.168.1.1/secret.mp4'],
    ['métadonnées cloud 169.254.169.254', () => 'http://169.254.169.254/latest/meta-data/iam.mp4'],
    ['IPv6 boucle [::1]', () => `http://[::1]:${portPrive}/secret.mp4`],
    ['IPv6 ULA [fc00::1]', () => 'http://[fc00::1]/secret.mp4'],
    ['IPv4 mappée [::ffff:127.0.0.1]', () => `http://[::ffff:127.0.0.1]:${portPrive}/secret.mp4`],
    ['nom public résolu en adresse privée', () => 'http://prive.example/secret.mp4'],
    ['nom résolu en métadonnées cloud', () => 'http://meta.example/secret.mp4'],
    ['enregistrement mixte public + privé', () => 'http://mixte.example/video.mp4'],
    ['redirection public → boucle locale', () => 'http://public.example/redir-loopback.mp4'],
    ['redirection public → nom privé', () => 'http://public.example/redir-dns-prive.mp4'],
    ['redirection public → métadonnées', () => 'http://public.example/redir-meta.mp4'],
    ['départ privé (qui redirigerait vers public)', () => 'http://192.168.1.1/redir-vers-public.mp4'],
    ['plus de 3 redirections', () => 'http://public.example/chaine/0/5.mp4'],
    ['identifiants dans l URL', () => 'http://user:mdp@public.example/video.mp4'],
  ];

  it.each(refusees)('%s', async (_nom, url) => {
    base.scheduled_posts = [post(url())];
    const reponse = await lancerCron();
    const ligne = base.scheduled_posts[0];

    expect(priv.hits).toBe(0);
    expect(depots).toHaveLength(0);
    expect(appelsZernio).toEqual([]);
    expect(autresFetch).toEqual([]);
    expect(ligne.status).toBe('failed');
    expect(ligne.metadata.error).toBe('Média de publication refusé.');
    expect(ligne.metadata.design).toEqual({ titleColor: '#FFF' });
    expect(reponse.results[0].success).toBe(false);
    expect(fuites(JSON.stringify(ligne.metadata))).toEqual([]);
    expect(fuites(JSON.stringify(reponse.results))).toEqual([]);
  });

  it('les redirections refusées ont bien été SUIVIES jusqu au contrôle (le test ne passe pas par vacuité)', async () => {
    pub.chemins.length = 0;
    base.scheduled_posts = [post('http://public.example/chaine/0/5.mp4')];
    await lancerCron();
    // Départ + 3 sauts revalidés ; le 4e saut est refusé sans être demandé.
    expect(pub.chemins).toEqual(['/chaine/0/5.mp4', '/chaine/1/5.mp4', '/chaine/2/5.mp4', '/chaine/3/5.mp4']);
    expect(priv.hits).toBe(0);
  });

  it('un média introuvable (404) : motif neutre, sans statut ni URL', async () => {
    base.scheduled_posts = [post('http://public.example/absent.mp4')];
    await lancerCron();
    const ligne = base.scheduled_posts[0];
    expect(ligne.status).toBe('failed');
    expect(ligne.metadata.error).toBe('Média de publication introuvable.');
    expect(fuites(JSON.stringify(ligne.metadata))).toEqual([]);
    expect(JSON.stringify(ligne.metadata)).not.toMatch(/404/);
    expect(depots).toHaveLength(0);
    expect(appelsZernio).toEqual([]);
  });
});

describe('cron → publierViaZernio : médias légitimes publiés', () => {
  it('notre stockage (chemin relatif) : les octets partent chez Zernio', async () => {
    base.scheduled_posts = [post('/storage/v1/object/public/media/user-1/rendus/montage.mp4')];
    await lancerCron();
    expect(stock.chemins).toContain('/storage/v1/object/public/media/user-1/rendus/montage.mp4');
    expect(depots).toHaveLength(1);
    expect(depots[0].equals(MP4)).toBe(true);
    expect(appelsZernio).toEqual(['presign', 'posts']);
    expect(base.scheduled_posts[0].status).toBe('publishing');
    expect(priv.hits).toBe(0);
  });

  it('notre stockage (URL absolue, origine configurée — même locale) : publié', async () => {
    base.scheduled_posts = [post(`http://127.0.0.1:${portStockage}/storage/v1/object/public/media/user-1/m.mp4`)];
    await lancerCron();
    expect(depots).toHaveLength(1);
    expect(depots[0].equals(MP4)).toBe(true);
    expect(base.scheduled_posts[0].status).toBe('publishing');
  });

  it('une autre route de NOTRE origine n est pas « de confiance » : contrôle d adresse appliqué', async () => {
    base.scheduled_posts = [post(`http://127.0.0.1:${portStockage}/api/interne/x.mp4`)];
    const avant = stock.hits;
    await lancerCron();
    expect(stock.hits).toBe(avant);
    expect(depots).toHaveLength(0);
    expect(base.scheduled_posts[0].metadata.error).toBe('Média de publication refusé.');
  });

  it('une vidéo publique (nom résolu en adresse publique) : publiée avec ses octets', async () => {
    base.scheduled_posts = [post('http://public.example/videos/clip.mp4')];
    await lancerCron();
    expect(resolutions).toContain('public.example');
    expect(depots).toHaveLength(1);
    expect(depots[0].equals(MP4)).toBe(true);
    expect(appelsZernio).toEqual(['presign', 'posts']);
    expect(base.scheduled_posts[0].status).toBe('publishing');
    expect(priv.hits).toBe(0);
  });

  it('une redirection publique → publique (≤ 3 sauts) : publiée', async () => {
    base.scheduled_posts = [post('http://public.example/chaine/0/2.mp4')];
    await lancerCron();
    expect(depots).toHaveLength(1);
    expect(depots[0].equals(MP4)).toBe(true);
  });
});
