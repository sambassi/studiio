// @vitest-environment node
/**
 * SSRF PAR LA PUBLICATION — chemin historique YouTube de
 * `POST /api/social/publish`.
 *
 * Le publieur YouTube TÉLÉCHARGE lui-même le montage
 * (`metadata.renderedVideoUrl`, écrit par le navigateur) pour le téléverser.
 * Seul garde avant ce correctif : `isPubliableMediaUrl`, qui juge le NOM
 * d'hôte — ni le DNS, ni les redirections (suivies par `fetch`).
 *
 * VRAIE route, vrai `lireMediaPublication`, vrai fetch sûr ; doublés : auth,
 * base, jeton, `fetch` global (API Google), et le réseau du fetch sûr (faux
 * DNS + `connexionVers` vers des serveurs HTTPS/HTTP locaux). Le certificat
 * du serveur « public » est auto-signé pour `public.example` : il est donné
 * comme AUTORITÉ (`ca`) aux seules requêtes du test — la vérification TLS
 * reste ACTIVE (nom + chaîne). Rien ne sort de la machine.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import https from 'https';
import type { AddressInfo } from 'net';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AdresseResolue, OptionsFetchSur } from '@/lib/securite/fetch-sur';

const MP4 = Buffer.from(`ftypisom-FAUX-MP4-YT-${'y'.repeat(2048)}`);
const priv = { hits: 0 };
const pub = { hits: 0, chemins: [] as string[] };
let portPrive = 0;
let portPublicHttps = 0;
const serveurs: Array<http.Server | https.Server> = [];
const racine = mkdtempSync(join(tmpdir(), 'studiio-ssrf-yt-'));

const tlsDispo = (() => {
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=public.example',
      '-addext', 'subjectAltName=DNS:public.example',
      '-keyout', join(racine, 'k.pem'), '-out', join(racine, 'c.pem'), '-days', '1'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
})();

function ecouter(srv: http.Server | https.Server): Promise<number> {
  serveurs.push(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
}

const IP_PUBLIQUE = '93.184.216.34';
const DNS: Record<string, string[]> = {
  'public.example': [IP_PUBLIQUE],
  'prive.example': ['10.0.0.7'],
  'mixte.example': [IP_PUBLIQUE, '172.16.5.5'],
  'meta.example': ['169.254.169.254'],
  'boucle.example': ['::1'],
};
const resoudre = async (hote: string): Promise<AdresseResolue[]> => {
  const ips = DNS[hote];
  if (!ips) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};
const connexionVers = (ip: string) => ({ host: '127.0.0.1', port: ip === IP_PUBLIQUE ? portPublicHttps : portPrive });

vi.mock('@/lib/securite/fetch-sur', async (orig) => {
  const actual = await orig<typeof import('@/lib/securite/fetch-sur')>();
  return {
    ...actual,
    telechargerSur: (url: string, dest: string, opts: OptionsFetchSur = {}) =>
      actual.telechargerSur(url, dest, { ...opts, resoudre, connexionVers, timeoutMs: 5_000 }),
  };
});

// ── Route, base et clients doublés ──────────────────────────────────────
let ligneVideo: Record<string, unknown> | null = null;
const historique: Array<Record<string, unknown>> = [];
function requete(table: string) {
  const api: Record<string, any> = {
    select: () => api,
    eq: () => api,
    insert: (v: Record<string, unknown>) => { if (table === 'publishing_history') historique.push({ op: 'insert', ...v }); return api; },
    update: (v: Record<string, unknown>) => { if (table === 'publishing_history') historique.push({ op: 'update', ...v }); return api; },
    single: async () => (table === 'videos'
      ? { data: ligneVideo, error: ligneVideo ? null : { message: 'not found' } }
      : table === 'publishing_history' ? { data: { id: 'ph-1' }, error: null } : { data: null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({
      data: table === 'social_accounts'
        ? [{ id: 'sa-yt', platform: 'youtube', connected: true, access_token: 'jeton', account_id: 'yt' }]
        : [],
      error: null,
    }).then(ok),
  };
  return api;
}
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'user-1', email: 'a@b.c' } }) }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
}));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton' }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false, canUseWhatsApp: () => false, broadcastWhatsApp: vi.fn(),
  resolveRecipients: async () => [], formatBroadcastFailures: () => '',
}));

const appelsGoogle: string[] = [];
const televerses: Buffer[] = [];
const autresFetch: string[] = [];
function fetchGoogle() {
  return vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    if (u.startsWith('https://www.googleapis.com/upload/youtube/v3/videos')) {
      appelsGoogle.push('init');
      return new Response('{}', { status: 200, headers: { Location: 'https://upload.youtube.test/session-1' } });
    }
    if (u === 'https://upload.youtube.test/session-1') {
      televerses.push(Buffer.from(init?.body as Uint8Array));
      return Response.json({ id: 'yt-video-1' });
    }
    autresFetch.push(u);
    throw new Error('fetch inattendu en test');
  });
}

async function publier(renderedVideoUrl: string) {
  ligneVideo = { id: 'v1', user_id: 'user-1', title: 'Titre', status: 'completed', video_url: null, metadata: { renderedVideoUrl } };
  const { POST } = await import('@/app/api/social/publish/route');
  const res = await POST({ json: async () => ({ videoId: 'v1', platforms: ['youtube'] }) } as never);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  portPrive = await ecouter(http.createServer((_req, res) => { priv.hits += 1; res.end('SECRET-INTERNE'); }));
  if (tlsDispo) {
    portPublicHttps = await ecouter(https.createServer({
      key: readFileSync(join(racine, 'k.pem')), cert: readFileSync(join(racine, 'c.pem')),
    }, (req, res) => {
      pub.hits += 1;
      const chemin = req.url ?? '/';
      pub.chemins.push(chemin);
      if (chemin.startsWith('/redir-loopback')) { res.writeHead(302, { Location: `http://127.0.0.1:${portPrive}/secret.mp4` }); res.end(); return; }
      if (chemin.startsWith('/redir-dns-prive')) { res.writeHead(302, { Location: 'https://prive.example/secret.mp4' }); res.end(); return; }
      if (chemin.startsWith('/redir-meta')) { res.writeHead(301, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
      const c = /^\/chaine\/(\d+)\/(\d+)/.exec(chemin);
      if (c && Number(c[1]) < Number(c[2])) { res.writeHead(302, { Location: `/chaine/${Number(c[1]) + 1}/${c[2]}.mp4` }); res.end(); return; }
      if (chemin.endsWith('.mp4')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) }); res.end(MP4); return; }
      res.writeHead(404); res.end();
    }));
  }
});
afterAll(async () => {
  await Promise.all(serveurs.map((s) => new Promise((r) => s.close(r))));
  rmSync(racine, { recursive: true, force: true });
});

beforeEach(() => {
  appelsGoogle.length = 0;
  televerses.length = 0;
  autresFetch.length = 0;
  historique.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchGoogle());
  // Le certificat de test devient l'autorité de CES requêtes : la connexion
  // épinglée part vers 127.0.0.1, le nom vérifié reste `public.example`.
  if (tlsDispo) {
    const ca = readFileSync(join(racine, 'c.pem'));
    const original = https.request.bind(https);
    vi.spyOn(https, 'request').mockImplementation(((options: https.RequestOptions, cb?: (r: http.IncomingMessage) => void) =>
      original({ ...options, ca }, cb as never)) as never);
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fuites(texte: string): string[] {
  return ['127.0.0.1', 'localhost', '10.0.0', '172.16', '192.168', '169.254', '::1', 'fc00',
    'prive.example', 'meta.example', 'mixte.example', 'public.example', 'boucle.example',
    String(portPrive), 'http', 'ECONNREFUSED'].filter((m) => texte.includes(m));
}

describe('YouTube historique : adresses internes écrites en clair — refusées avant tout appel', () => {
  const litterales = [
    () => 'https://127.0.0.1/secret.mp4',
    () => 'https://localhost/secret.mp4',
    () => 'https://10.0.0.5/secret.mp4',
    () => 'https://172.16.0.1/secret.mp4',
    () => 'https://192.168.1.1/secret.mp4',
    () => 'https://169.254.169.254/latest/meta-data/',
    () => 'https://[::1]/secret.mp4',
    () => 'https://[fc00::1]/secret.mp4',
    () => `http://127.0.0.1:${portPrive}/secret.mp4`,
  ];
  it.each(litterales.map((f, i) => [i, f] as const))('cas %s', async (_i, url) => {
    const r = await publier(url());
    expect(r.status).toBe(400);
    expect(priv.hits).toBe(0);
    expect(appelsGoogle).toEqual([]);
    expect(televerses).toHaveLength(0);
    expect(autresFetch).toEqual([]);
  });
});

describe('YouTube historique : contournements DNS / redirections — refusés par le fetch sûr', () => {
  const contournements: Array<[string, string]> = [
    ['nom public résolu en adresse privée', 'https://prive.example/secret.mp4'],
    ['nom résolu en métadonnées cloud', 'https://meta.example/secret.mp4'],
    ['nom résolu en ::1', 'https://boucle.example/secret.mp4'],
    ['enregistrement mixte public + privé', 'https://mixte.example/video.mp4'],
    ['redirection public → boucle locale', 'https://public.example/redir-loopback.mp4'],
    ['redirection public → nom privé', 'https://public.example/redir-dns-prive.mp4'],
    ['redirection public → métadonnées', 'https://public.example/redir-meta.mp4'],
    ['plus de 3 redirections', 'https://public.example/chaine/0/5.mp4'],
  ];
  it.skipIf(!tlsDispo).each(contournements)('%s', async (_nom, url) => {
    const r = await publier(url);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
    expect(r.body.results[0].message).toBe('Média de publication refusé.');
    expect(priv.hits).toBe(0);
    // Le média est lu AVANT d'ouvrir la session YouTube : rien n'est parti.
    expect(appelsGoogle).toEqual([]);
    expect(televerses).toHaveLength(0);
    expect(autresFetch).toEqual([]);
    expect(fuites(JSON.stringify(r.body))).toEqual([]);
    expect(fuites(JSON.stringify(historique))).toEqual([]);
  });

  it.skipIf(!tlsDispo)('les redirections ont bien été suivies jusqu au contrôle (pas de vacuité)', async () => {
    pub.chemins.length = 0;
    await publier('https://public.example/chaine/0/5.mp4');
    expect(pub.chemins).toEqual(['/chaine/0/5.mp4', '/chaine/1/5.mp4', '/chaine/2/5.mp4', '/chaine/3/5.mp4']);
  });
});

describe('YouTube historique : média public légitime — téléversé avec ses octets', () => {
  it.skipIf(!tlsDispo)('nom public → adresse publique : publié', async () => {
    const r = await publier('https://public.example/rendus/montage.mp4');
    expect(r.body.success).toBe(true);
    expect(appelsGoogle).toEqual(['init']);
    expect(televerses).toHaveLength(1);
    expect(televerses[0].equals(MP4)).toBe(true);
    expect(priv.hits).toBe(0);
  });

  it.skipIf(!tlsDispo)('redirection publique → publique (≤ 3 sauts) : publié', async () => {
    const r = await publier('https://public.example/chaine/0/2.mp4');
    expect(r.body.success).toBe(true);
    expect(televerses[0].equals(MP4)).toBe(true);
  });
});
