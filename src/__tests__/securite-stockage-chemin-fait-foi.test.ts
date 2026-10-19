// @vitest-environment node
/**
 * LE CHEMIN FAIT FOI, PAS L'HÔTE — objet de stockage atteint par un hôte
 * NON configuré.
 *
 * A possède `media/<A>/library/test.mp4`. B en donne l'adresse sous un hôte
 * que la configuration ne reconnaît pas (staging, alias, IP de l'application,
 * `http` au lieu de `https`, majuscules, point final, port). Avant : jugée
 * « externe », elle était copiée par le fetch sûr DEPUIS LE RELAIS PUBLIC (qui
 * sert sans session ni propriétaire), déposée dans les copies PARTAGÉES
 * (`media/externes/…`), publiée sur les réseaux de B (Zernio, YouTube) ou
 * remise telle quelle à Meta / TikTok — la propriété n'était jamais jugée.
 *
 * Verrouille, pour `urlDeLecture`, `localiserMedia`, `lireMediaPublication`
 * et `ensurePublicUrl` :
 *   - B → REFUS, le relais (serveur local) reçoit 0 requête, 0 signature ;
 *   - A → servi ;
 *   - redirection d'un hôte public vers l'objet de A → REFUS, 0 requête ;
 *   - formes encodées / non canoniques du chemin → REFUS.
 *
 * Aucun réseau réel : faux DNS + connexion épinglée redirigée vers des
 * serveurs HTTP locaux.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { AdresseResolue, OptionsFetchSur } from '@/lib/securite/fetch-sur';

const MP4 = Buffer.from(`ftypisom-FAUX-MP4-${'z'.repeat(1024)}`);
const relais = { hits: 0, chemins: [] as string[] };
const externe = { hits: 0, chemins: [] as string[] };
const prive = { hits: 0 };
let portRelais = 0;
let portExterne = 0;
let portPrive = 0;
const serveurs: http.Server[] = [];

const IP_APP = '93.184.216.34';
const IP_EXTERNE = '93.184.216.50';
const IP_RELAIS_2 = '93.184.216.60';
const DNS: Record<string, string[]> = {
  'staging.studiio.pro': [IP_APP],
  'studiio.pro': [IP_APP],
  'studiio.pro.': [IP_APP],
  'alias.example': [IP_APP],
  'cdn.example': [IP_EXTERNE],
  'relai2.example': [IP_RELAIS_2],
  'prive.example': ['10.0.0.9'],
};
const resoudre = async (hote: string): Promise<AdresseResolue[]> => {
  const ips = DNS[hote.toLowerCase()];
  if (!ips) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return ips.map((address) => ({ address, family: 4 }));
};
const connexionVers = (ip: string) => ({
  host: '127.0.0.1',
  port: ip === IP_EXTERNE || ip === IP_RELAIS_2 ? portExterne : ip === IP_APP ? portRelais : portPrive,
});

vi.mock('@/lib/securite/fetch-sur', async (orig) => {
  const actual = await orig<typeof import('@/lib/securite/fetch-sur')>();
  const injecte = (opts: OptionsFetchSur = {}) => ({ ...opts, resoudre, connexionVers, timeoutMs: 5_000 });
  return {
    ...actual,
    telechargerSur: (url: string, dest: string, opts?: OptionsFetchSur) => actual.telechargerSur(url, dest, injecte(opts)),
  };
});

// ── Signataires ESPIONNÉS : aucun appel sur refus ─────────────────────────
const presignedGetObject = vi.fn(async (b: string, c: string, _t: number) => `http://studiio-minio:9000/${b}/${c}?X-Amz-Signature=x`);
const putObject = vi.fn(async () => ({}));
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string, t: number) => presignedGetObject(b, c, t) }),
  clientMinio: () => ({
    statObject: async () => { throw Object.assign(new Error('absent'), { code: 'NotFound' }); },
    putObject: (...a: unknown[]) => putObject(...(a as [])),
  }),
}));
const createSignedUrl = vi.fn(async (c: string, _t: number) => ({ data: { signedUrl: `https://signe.example/${c}?token=t` }, error: null }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: (b: string) => ({
        createSignedUrl: (c: string, t: number) => createSignedUrl(c, t),
        getPublicUrl: (c: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${b}/${c}` } }),
      }),
    },
  },
}));

import { classerUrlLecture, urlDeLecture, LectureRefusee } from '@/lib/creer/analyse-rush-serveur';
import { localiserMedia, type DepotMedias } from '@/lib/securite/medias-externes';
import { lireMediaPublication, ErreurMediaPublication, verdictStockagePublication } from '@/lib/social/media-publication';
import { ensurePublicUrl } from '@/lib/social/url-publication';
import { cibleStockageParChemin } from '@/lib/storage/acces-objet';
import { RefusSsrf } from '@/lib/securite/fetch-sur';

const O = 'https://studiio.pro';
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CHEMIN_A = `/storage/v1/object/public/media/${A}/library/test.mp4`;
const CHEMIN_B = `/storage/v1/object/public/media/${B}/library/secret.mp4`;

/** Hôtes NON configurés qui désignent l'application (et son relais). */
const HOTES_ALIAS: Array<[string, string]> = [
  ['staging', 'http://staging.studiio.pro'],
  ['alias', 'http://alias.example'],
  ['IP de l’application', `http://${IP_APP}`],
  ['http au lieu de https', 'http://studiio.pro'],
  ['MAJUSCULES + http', 'http://STUDIIO.PRO'],
  ['point final', 'http://studiio.pro.'],
  ['port explicite', 'http://studiio.pro:80'],
];
/** Mêmes variantes, en https : classées seulement (aucune connexion TLS). */
const HOTES_ALIAS_HTTPS = ['https://staging.studiio.pro', 'https://STUDIIO.PRO.', 'https://studiio.pro:8443', 'https://www.studiio.pro', `https://${IP_APP}`];

function ecouter(srv: http.Server): Promise<number> {
  serveurs.push(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
}

function depotMemoire() {
  const objets = new Map<string, number>();
  const depot: DepotMedias = {
    existe: async (b, c) => objets.has(`${b}/${c}`),
    deposer: async (b, c, _f, taille) => { objets.set(`${b}/${c}`, taille); },
    urlPublique: (b, c) => `${O}/storage/v1/object/public/${b}/${c}`,
  };
  return { depot, objets };
}

beforeAll(async () => {
  // « Relais public » de l'application : sert TOUT objet, sans session.
  portRelais = await ecouter(http.createServer((req, res) => {
    relais.hits += 1;
    relais.chemins.push(req.url ?? '/');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) });
    res.end(MP4);
  }));
  // Hôte public tiers : sert un média, ou redirige.
  portExterne = await ecouter(http.createServer((req, res) => {
    externe.hits += 1;
    const chemin = req.url ?? '/';
    externe.chemins.push(chemin);
    if (chemin.startsWith('/vers-objet-a')) { res.writeHead(302, { Location: `http://staging.studiio.pro${CHEMIN_A}` }); res.end(); return; }
    if (chemin.startsWith('/vers-objet-b')) { res.writeHead(302, { Location: `http://alias.example${CHEMIN_B}` }); res.end(); return; }
    if (chemin.startsWith('/vers-objet-encode')) { res.writeHead(302, { Location: `http://alias.example/storage/v1/object/public/media/${B}%2Flibrary%2Fsecret.mp4` }); res.end(); return; }
    if (chemin.startsWith('/saut1')) { res.writeHead(302, { Location: 'http://relai2.example/saut2' }); res.end(); return; }
    if (chemin.startsWith('/saut2')) { res.writeHead(302, { Location: 'http://prive.example/secret.mp4' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) });
    res.end(MP4);
  }));
  portPrive = await ecouter(http.createServer((_req, res) => { prive.hits += 1; res.end('SECRET-INTERNE'); }));
});
afterAll(async () => { await Promise.all(serveurs.map((s) => new Promise((r) => s.close(r)))); });

beforeEach(() => {
  vi.clearAllMocks();
  relais.hits = 0; relais.chemins.length = 0;
  externe.hits = 0; externe.chemins.length = 0;
  prive.hits = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', O);
  vi.stubEnv('NEXTAUTH_URL', '');
  vi.stubEnv('PUBLIC_STORAGE_URL', '');
  vi.stubEnv('SUPABASE_LEGACY_STORAGE_URL', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ═════════════════════════════════════════════════════════════════════════
describe('classement (pur) : un chemin d’objet de stockage passe la propriété, quel que soit l’hôte', () => {
  it.each([...HOTES_ALIAS.map(([, h]) => h), ...HOTES_ALIAS_HTTPS])('%s — objet de A lu par B → refus ; par A → stockage', (hote) => {
    expect(classerUrlLecture(`${hote}${CHEMIN_A}`, B, [O]).genre).toBe('refus');
    expect(classerUrlLecture(`${hote}${CHEMIN_A}`, A, [O])).toEqual({ genre: 'stockage', bucket: 'media', cle: `${A}/library/test.mp4` });
    expect(verdictStockagePublication(`${hote}${CHEMIN_A}`, B)).toBe('refuse');
    expect(verdictStockagePublication(`${hote}${CHEMIN_A}`, A)).toBe('autorise');
  });

  it('formes `sign` / `authenticated` / `private` (n’importe quel hôte) : même propriété', () => {
    for (const acces of ['sign', 'authenticated', 'private']) {
      const u = `https://alias.example/storage/v1/object/${acces}/media/${A}/library/test.mp4?token=x`;
      expect(classerUrlLecture(u, B, [O]).genre).toBe('refus');
      expect(classerUrlLecture(u, A, [O]).genre).toBe('stockage');
    }
  });

  it('un média réellement externe reste « externe »', () => {
    expect(classerUrlLecture('https://images.pexels.com/videos/1/a.mp4', B, [O]).genre).toBe('externe');
    expect(classerUrlLecture('https://cdn.example/storage/v2/x.mp4', B, [O]).genre).toBe('externe');
    expect(verdictStockagePublication('https://images.pexels.com/videos/1/a.mp4', B)).toBe('hors-stockage');
  });

  // ⚠️ ENCODAGES : aucune forme tordue ne passe pour « externe » ni pour un
  // objet du compte.
  const ENCODAGES: Array<[string, string]> = [
    ['%2F dans le préfixe', `http://alias.example/storage%2Fv1%2Fobject%2Fpublic/media/${A}/library/test.mp4`],
    ['%252F (double encodage)', `http://alias.example/storage%252Fv1%252Fobject%252Fpublic/media/${A}/library/test.mp4`],
    ['%2F entre bucket et clé', `http://alias.example/storage/v1/object/public/media%2F${A}/library/test.mp4`],
    ['%2e%2e (traversée)', `http://alias.example/storage/v1/object/public/media/${B}/%2e%2e/${A}/library/test.mp4`],
    ['%252e%252e', `http://alias.example/storage/v1/object/public/media/${B}/%252e%252e/${A}/library/test.mp4`],
    ['.. en clair', `http://alias.example/x/../storage/v1/object/public/media/${A}/library/test.mp4`],
    ['antislash', `http://alias.example\\storage\\v1\\object\\public\\media\\${A}\\library\\test.mp4`],
    ['casse du préfixe', `http://alias.example/Storage/v1/object/PUBLIC/media/${A}/library/test.mp4`],
    ['double barre', `http://alias.example//storage/v1/object/public/media/${A}/library/test.mp4`],
    ['point de segment', `http://alias.example/./storage/v1/object/public/media/${A}/library/test.mp4`],
    ['préfixe en sous-chemin', `http://alias.example/proxy/storage/v1/object/public/media/${A}/library/test.mp4`],
    ['compartiment encodé', `http://alias.example/storage/v1/object/public/medi%61/${A}/library/test.mp4`],
    ['propriétaire encodé', `http://alias.example/storage/v1/object/public/media/%61${A.slice(1)}/library/test.mp4`],
    ['propriétaire pleine chasse (NFKC)', `http://alias.example/storage/v1/object/public/media/${'ａ'}${A.slice(1)}/library/test.mp4`],
    ['clé en %2F', `http://alias.example/storage/v1/object/public/media/${A}%2Flibrary%2Ftest.mp4`],
  ];
  it.each(ENCODAGES)('%s → refus pour B comme pour A, jamais « externe »', (_n, u) => {
    for (const compte of [A, B]) {
      expect(classerUrlLecture(u, compte, [O]).genre, `${compte}`).toBe('refus');
      expect(verdictStockagePublication(u, compte)).toBe('refuse');
    }
  });

  it('identifiants, fragment et requête ne masquent pas la cible', () => {
    expect(classerUrlLecture(`http://u:p@alias.example${CHEMIN_A}`, B, [O]).genre).toBe('refus');
    expect(classerUrlLecture(`http://alias.example${CHEMIN_A}#x`, B, [O]).genre).toBe('refus');
    expect(classerUrlLecture(`http://alias.example${CHEMIN_A}?download=1`, B, [O]).genre).toBe('refus');
    expect(classerUrlLecture(`http://alias.example/media.mp4?u=${CHEMIN_A}`, B, [O]).genre).toBe('externe');
  });

  it('casse des namespaces : `Montages`/`AVATAR` désignent un AUTRE objet S3, jamais celui de B', () => {
    const c = cibleStockageParChemin(`http://alias.example/storage/v1/object/public/videos/${B}/autopilote/Montages/m/montage.mp4`);
    expect(c && c !== 'refus' && c.cle).toBe(`${B}/autopilote/Montages/m/montage.mp4`);
    expect(classerUrlLecture(`http://alias.example/storage/v1/object/public/videos/${B}/autopilote/Montages/m/montage.mp4`, A, [O]).genre).toBe('refus');
    expect(classerUrlLecture(`http://alias.example/storage/v1/object/public/media/${B}/AVATAR/source-1.jpg`, A, [O]).genre).toBe('refus');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('urlDeLecture (analyse ffmpeg, proxy, rendu hybride) — B ne lit jamais l’objet de A', () => {
  it.each(HOTES_ALIAS)('%s : B → LectureRefusee, 0 requête au relais, 0 signature, rien déposé', async (_n, hote) => {
    await expect(urlDeLecture(`${hote}${CHEMIN_A}`, B)).rejects.toBeInstanceOf(LectureRefusee);
    expect(relais.hits).toBe(0);
    expect(presignedGetObject).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });
  it.each(HOTES_ALIAS)('%s : A → lecture interne signée de SON objet, aucune copie réseau', async (_n, hote) => {
    const source = await urlDeLecture(`${hote}${CHEMIN_A}`, A);
    expect(source).toContain(`media/${A}/library/test.mp4`);
    expect(presignedGetObject).toHaveBeenCalledWith('media', `${A}/library/test.mp4`, 600);
    expect(relais.hits).toBe(0);
    expect(putObject).not.toHaveBeenCalled();
  });
  it('média externe légitime : toujours copié (une requête à l’hôte tiers)', async () => {
    const source = await urlDeLecture('http://cdn.example/rush.mp4', B);
    expect(source).toContain('externes/');
    expect(externe.hits).toBe(1);
    expect(relais.hits).toBe(0);
  });
  it('hôte public qui REDIRIGE vers l’objet de A : refus au saut, 0 requête au relais', async () => {
    await expect(urlDeLecture('http://cdn.example/vers-objet-a.mp4', B)).rejects.toBeInstanceOf(RefusSsrf);
    expect(externe.hits).toBe(1);
    expect(relais.hits).toBe(0);
    expect(putObject).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('localiserMedia (copies PARTAGÉES) : jamais un objet de notre stockage par un autre hôte', () => {
  it.each(HOTES_ALIAS)('%s : RefusSsrf avant toute requête, rien déposé', async (_n, hote) => {
    const { depot, objets } = depotMemoire();
    await expect(localiserMedia(`${hote}${CHEMIN_A}`, { depot, origines: [O] })).rejects.toBeInstanceOf(RefusSsrf);
    expect(relais.hits).toBe(0);
    expect(objets.size).toBe(0);
  });
  it.each(['/vers-objet-a.mp4', '/vers-objet-b.mp4', '/vers-objet-encode.mp4'])('redirection %s : refusée au saut, 0 requête au relais', async (chemin) => {
    const { depot, objets } = depotMemoire();
    await expect(localiserMedia(`http://cdn.example${chemin}`, { depot, origines: [O] })).rejects.toBeInstanceOf(RefusSsrf);
    expect(relais.hits).toBe(0);
    expect(objets.size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('lireMediaPublication (Zernio, YouTube) : au nom du PUBLIEUR', () => {
  it.each(HOTES_ALIAS)('%s : B → refus neutre, 0 requête au relais', async (_n, hote) => {
    const e = await lireMediaPublication(`${hote}${CHEMIN_A}`, { userId: B }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurMediaPublication);
    expect((e as ErreurMediaPublication).code).toBe('refuse');
    expect((e as Error).message).toBe('Média de publication refusé.');
    expect(relais.hits).toBe(0);
  });
  it('A → servi (son objet, par l’alias)', async () => {
    const r = await lireMediaPublication(`http://staging.studiio.pro${CHEMIN_A}`, { userId: A });
    expect(Buffer.from(r.octets).equals(MP4)).toBe(true);
    expect(relais.hits).toBe(1);
  });
  it('sans publieur : tout objet de stockage est refusé', async () => {
    await expect(lireMediaPublication(`http://staging.studiio.pro${CHEMIN_A}`, { userId: undefined })).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(relais.hits).toBe(0);
  });
  it('redirection publique → objet de A : refus, 0 requête au relais', async () => {
    await expect(lireMediaPublication('http://cdn.example/vers-objet-a.mp4', { userId: B })).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(externe.hits).toBe(1);
    expect(relais.hits).toBe(0);
  });
  it('public → public → privé : refus au 2e saut, 0 requête privée', async () => {
    await expect(lireMediaPublication('http://cdn.example/saut1.mp4', { userId: B })).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(externe.hits).toBe(2);
    expect(prive.hits).toBe(0);
  });
  it('ancienne conversion du cron (`converted/…`, sans compte) : refusée, 0 requête', async () => {
    const e = await lireMediaPublication(`${O.replace('https', 'http')}.:80/storage/v1/object/public/media/converted/converted_1.mp4`, { userId: B }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurMediaPublication);
    expect((e as ErreurMediaPublication).code).toBe('refuse');
    expect(relais.hits).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('ensurePublicUrl (Meta, TikTok, cron) : propriété AVANT toute signature, URL publique comprise', () => {
  it.each([...HOTES_ALIAS.map(([, h]) => h), ...HOTES_ALIAS_HTTPS, O])('%s — public de A par B → refus, 0 signature', async (hote) => {
    await expect(ensurePublicUrl(`${hote}${CHEMIN_A}`, B)).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it('public de A par A : même chemin + jeton du relais (#547), 0 signature de stockage', async () => {
    const rendue = await ensurePublicUrl(`${O}${CHEMIN_A}`, A);
    expect(rendue.startsWith(`${O}${CHEMIN_A}?sr=`)).toBe(true);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it('signée par un alias : B → refus 0 signature ; A → signée sur SA clé', async () => {
    const u = `https://alias.example/storage/v1/object/sign/media/${A}/library/test.mp4?token=x`;
    await expect(ensurePublicUrl(u, B)).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(createSignedUrl).not.toHaveBeenCalled();
    await ensurePublicUrl(u, A);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(`${A}/library/test.mp4`, 3600);
  });
  it.each([
    `https://alias.example/x/storage/v1/object/sign/media/${A}/library/test.mp4`,
    `https://alias.example/storage/v1/object/sign/media/${A}%2Flibrary%2Ftest.mp4`,
    `https://alias.example/storage/v1/object/sign/media/converted/x.mp4`,
  ])('forme refusée %s → refus, 0 signature', async (u) => {
    await expect(ensurePublicUrl(u, A)).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it('média externe : inchangé', async () => {
    expect(await ensurePublicUrl('https://images.pexels.com/videos/1/a.mp4', B)).toBe('https://images.pexels.com/videos/1/a.mp4');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Zernio `uploadMedia` : le fournisseur n’est jamais appelé sur refus', () => {
  it('objet de A par un alias, publié par B → refus, 0 appel Zernio, 0 requête au relais', async () => {
    const fournisseur = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fournisseur);
    try {
      const { uploadMedia } = await import('@/lib/social/zernio');
      await expect(uploadMedia(`http://staging.studiio.pro${CHEMIN_A}`, 'x.mp4', 'video/mp4', B)).rejects.toBeInstanceOf(ErreurMediaPublication);
      expect(fournisseur).not.toHaveBeenCalled();
      expect(relais.hits).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
