import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le stockage servait ce qu'on lui donnait, sous le type qu'on lui donnait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI ETAIT OUVERT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. `/storage/v1/object/public/{bucket}/{cle}` passait `bucket` TEL QUEL a
 *    `statObject`. Tout compartiment de l'instance MinIO etait lisible, et
 *    l'ecart entre un 404 et un 500 permettait d'en sonder l'existence.
 *
 * 2. Le `Content-Type` etait lu sur l'objet — c'est-a-dire choisi par celui
 *    qui envoie : `api/storage/upload` recopie l'en-tete du navigateur,
 *    `api/upload/multipart` recopie `corps.contentType`, et le mode presigne
 *    laisse l'en-tete libre. `sanitizeStorageFilename` garde les points et ne
 *    filtre aucune extension. Un compte pouvait donc deposer un `.html` en
 *    `text/html` et le faire servir depuis la MEME ORIGINE que la session
 *    NextAuth. Ni `nosniff`, ni `Content-Disposition` ne fermaient la porte.
 *
 * 3. `/api/proxy-media` exigeait une session — et rien d'autre. Elle ne
 *    verifiait jamais que l'objet appartenait a l'appelant : tout compte
 *    connecte lisait l'objet de n'importe qui.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS TOUCHE, ET QUI EST VERIFIE ICI AUSSI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `Range` / 206 / 416 et `HEAD` : le Calendrier fait un `HEAD` puis lit
 * `Accept-Ranges`, le compositeur cherche dans le rush, et l'atome `moov` en
 * fin de MP4 rend la lecture partielle indispensable. Un durcissement qui
 * casserait ces trois-la serait une regression, pas une correction — d'ou
 * des tests qui les tiennent.
 */

// ───────────────────────────────────────────────────────────────────────────
// Le stockage simule. On compte les appels : la preuve qu'une garde mord,
// c'est que MinIO n'est PAS interroge.
// ───────────────────────────────────────────────────────────────────────────

const etat = vi.hoisted(() => ({
  appels: [] as Array<{ methode: string; bucket: string; cle: string; debut?: number; longueur?: number }>,
  taille: 4096,
  /** Ce que l'objet ANNONCE — c'est-a-dire ce que l'envoyeur a choisi. */
  typeAnnonce: undefined as string | undefined,
  /** Erreur a lever depuis `statObject`, pour le chemin 500. */
  erreurStat: null as { code?: string; message: string } | null,
  /** Flux qui ne se termine jamais : si la route bufferisait, elle bloquerait. */
  fluxInfini: false,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  const flux = (octets: number) => {
    if (etat.fluxInfini) {
      let envoye = false;
      return new Readable({
        read() {
          // Un premier morceau, puis plus rien : un `arrayBuffer()` ne
          // rendrait jamais la main.
          if (!envoye) { envoye = true; this.push(Buffer.alloc(16, 1)); }
        },
      });
    }
    return Readable.from([Buffer.alloc(octets, 7)]);
  };
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'stat', bucket, cle });
      if (etat.erreurStat) throw Object.assign(new Error(etat.erreurStat.message), {
        code: etat.erreurStat.code,
      });
      return {
        size: etat.taille,
        metaData: etat.typeAnnonce ? { 'content-type': etat.typeAnnonce } : {},
      };
    }
    async getObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'get', bucket, cle });
      return flux(etat.taille);
    }
    async getPartialObject(bucket: string, cle: string, debut: number, longueur: number) {
      etat.appels.push({ methode: 'partial', bucket, cle, debut, longueur });
      return flux(longueur);
    }
  }
  return { Client };
});

// La route lit `STORAGE_PROVIDER` AU CHARGEMENT : il faut le poser avant.
process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { GET: LIRE, HEAD: SONDER, OPTIONS: PREVOL } = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);

const ORIGINE = 'https://studiio.pro';

function requete(chemin: string, entetes: Record<string, string> = {}): never {
  return new Request(`${ORIGINE}${chemin}`, { headers: entetes }) as never;
}

function lire(bucket: string, segments: string[], entetes: Record<string, string> = {}) {
  return LIRE(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`, entetes), {
    params: Promise.resolve({ bucket, path: segments }),
  });
}

function sonder(bucket: string, segments: string[], entetes: Record<string, string> = {}) {
  return SONDER(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`, entetes), {
    params: Promise.resolve({ bucket, path: segments }),
  });
}

beforeEach(() => {
  etat.appels.length = 0;
  etat.taille = 4096;
  etat.typeAnnonce = undefined;
  etat.erreurStat = null;
  etat.fluxInfini = false;
});

// ───────────────────────────────────────────────────────────────────────────

describe('Le compartiment vient d une liste blanche, et le stockage n est pas sonde', () => {
  it('un compartiment hors liste rend 404 SANS appeler MinIO', async () => {
    const res = await lire('backups', ['dump.mp4']);
    expect(res.status).toBe(404);
    // C'est le point : ne pas sonder. Un appel a `statObject` distinguerait
    // « compartiment inexistant » de « compartiment existant, objet absent ».
    expect(etat.appels).toHaveLength(0);
  });

  it('les quatre compartiments declares passent', async () => {
    for (const bucket of ['media', 'audio', 'videos', 'images']) {
      etat.appels.length = 0;
      const res = await lire(bucket, ['u1', 'rush', 'a.mp4']);
      expect(res.status, bucket).toBe(200);
      expect(etat.appels[0].bucket).toBe(bucket);
    }
  });
});

describe('La cle est normalisee avant tout appel au stockage', () => {
  it('`..` rend 404 sans appeler MinIO', async () => {
    const res = await lire('media', ['u1', '..', 'u2', 'prive.mp4']);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('`..` encode une fois de plus est refuse aussi', async () => {
    // Next decode deja une fois : `%252e%252e` arrive sous la forme `%2e%2e`.
    const res = await lire('media', ['u1', '%2e%2e', 'u2', 'prive.mp4']);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('`://` rend 404 sans appeler MinIO', async () => {
    const res = await lire('media', ['https:', '', 'evil.example', 'x.mp4']);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('un antislash et un caractere de controle rendent 404 sans appeler MinIO', async () => {
    for (const segment of ['u1\\u2', 'u1\u0001u2']) {
      etat.appels.length = 0;
      const res = await lire('media', [segment, 'x.mp4']);
      expect(res.status, segment).toBe(404);
      expect(etat.appels, segment).toHaveLength(0);
    }
  });

  it('un tiret et un espace restent acceptes — les cles reelles en portent', async () => {
    // `${timestamp}-${safeFilename}` : refuser le tiret casserait TOUT envoi.
    const res = await lire('media', ['u1', 'rush', '1712345678-mon rush.mp4']);
    expect(res.status).toBe(200);
    expect(etat.appels).toHaveLength(2);
  });
});

describe('Le type de contenu est decide par nous, jamais lu sur l objet', () => {
  it('un objet qui ANNONCE text/html n est jamais servi en text/html', async () => {
    etat.typeAnnonce = 'text/html';
    const res = await lire('media', ['u1', 'rush', 'piege.html']);
    expect(res.status).toBe(200);
    const type = res.headers.get('content-type') || '';
    expect(type).not.toContain('text/html');
    expect(type).toBe('application/octet-stream');
  });

  it('une extension connue gagne contre le type annonce', async () => {
    etat.typeAnnonce = 'text/html';
    const res = await lire('media', ['u1', 'rush', 'a.mp4']);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  it('une extension inconnue tombe sur les octets', async () => {
    etat.typeAnnonce = 'image/svg+xml';
    const res = await lire('media', ['u1', 'rush', 'a.svg']);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('nosniff et Content-Disposition inline sont poses', async () => {
    const res = await lire('media', ['u1', 'rush', 'a.mp4']);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
  });
});

describe('CORS : plus d etoile, et un cache qui ne partage pas', () => {
  it('sans en-tete Origin, aucun Access-Control-Allow-Origin', async () => {
    const res = await lire('media', ['u1', 'rush', 'a.mp4']);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('une origine etrangere n obtient rien', async () => {
    const res = await lire('media', ['u1', 'rush', 'a.mp4'], { origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('l origine de l application obtient exactement elle-meme, jamais `*`', async () => {
    const res = await lire('media', ['u1', 'rush', 'a.mp4'], { origin: ORIGINE });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGINE);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    // Sans `Vary`, un cache servirait a une origine la reponse d'une autre.
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('le prevol suit la meme regle', async () => {
    const ouvert = await PREVOL(requete('/storage/v1/object/public/media/u1/a.mp4', { origin: ORIGINE }));
    expect(ouvert.headers.get('access-control-allow-origin')).toBe(ORIGINE);
    const ferme = await PREVOL(requete('/storage/v1/object/public/media/u1/a.mp4', { origin: 'https://evil.example' }));
    expect(ferme.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('le cache est prive : un intermediaire partage ne garde pas ce media', async () => {
    const res = await lire('media', ['u1', 'rush', 'a.mp4']);
    const cache = res.headers.get('cache-control') || '';
    expect(cache).toContain('private');
    expect(cache).toContain('no-store');
    expect(cache).not.toContain('public');
  });
});

describe('Range, 206, 416 et HEAD sont intacts', () => {
  it('un Range rend 206, le bon Content-Range, et lit PARTIELLEMENT', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['u1', 'rush', 'a.mp4'], { range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const partiel = etat.appels.find((a) => a.methode === 'partial');
    expect(partiel).toMatchObject({ debut: 100, longueur: 100 });
    expect(etat.appels.some((a) => a.methode === 'get')).toBe(false);
  });

  it('un Range ouvert `bytes=500-` va jusqu au bout', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['u1', 'rush', 'a.mp4'], { range: 'bytes=500-' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 500-999/1000');
  });

  it('un Range hors fichier rend 416 avec `bytes * / taille`', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['u1', 'rush', 'a.mp4'], { range: 'bytes=5000-6000' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('HEAD rend la taille et Accept-Ranges — ce que le Calendrier lit', async () => {
    etat.taille = 18_000_000;
    const res = await sonder('media', ['u1', 'rush', 'gros.mp4']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('18000000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('HEAD applique les memes gardes, sans appeler MinIO', async () => {
    const hors = await sonder('backups', ['dump.mp4']);
    expect(hors.status).toBe(404);
    etat.appels.length = 0;
    const traverse = await sonder('media', ['u1', '..', 'x.mp4']);
    expect(traverse.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });
});

describe('Le media n est jamais materialise en memoire', () => {
  it('la reponse revient avant la fin du flux', async () => {
    etat.fluxInfini = true;
    etat.taille = 50_000_000;
    // Si la route faisait `arrayBuffer()`, cette promesse ne resoudrait pas.
    const res = await Promise.race([
      lire('media', ['u1', 'rush', 'gros.mp4']),
      new Promise<never>((_, ko) => setTimeout(() => ko(new Error('bufferise')), 2000)),
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    const { value } = await res.body!.getReader().read();
    expect(value?.length).toBe(16);
  });
});

describe('Les erreurs ne decrivent plus le stockage', () => {
  it('un objet absent rend 404', async () => {
    etat.erreurStat = { code: 'NoSuchKey', message: 'The specified key does not exist' };
    const res = await lire('media', ['u1', 'rush', 'absent.mp4']);
    expect(res.status).toBe(404);
  });

  it('une panne rend 500 sans le message du SDK', async () => {
    etat.erreurStat = { message: 'connect ECONNREFUSED studiio-minio:9000 (bucket sauvegardes)' };
    const res = await lire('media', ['u1', 'rush', 'a.mp4']);
    expect(res.status).toBe(500);
    const corps = await res.json();
    expect(JSON.stringify(corps)).not.toContain('studiio-minio');
    expect(JSON.stringify(corps)).not.toContain('ECONNREFUSED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// `/api/proxy-media` — la seconde porte du meme stockage.
// ───────────────────────────────────────────────────────────────────────────

describe('proxy-media : une session ne suffit plus a lire l objet d autrui', () => {
  const APP = 'https://studiio.pro';

  async function appeler(url: string, userId: string | null) {
    vi.resetModules();
    vi.doMock('@/lib/auth/config', () => ({
      auth: async () => (userId ? { user: { id: userId } } : null),
    }));
    const amont = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'content-type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', amont);
    process.env.NEXT_PUBLIC_APP_URL = APP;
    const { GET } = await import('@/app/api/proxy-media/route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(`${APP}/api/proxy-media?url=${encodeURIComponent(url)}`);
    const res = await GET(req as never);
    vi.unstubAllGlobals();
    return { res, amont };
  }

  const objet = (cle: string) => `${APP}/storage/v1/object/public/media/${cle}`;

  it('l objet d un autre compte est refuse, et l amont n est jamais appele', async () => {
    const { res, amont } = await appeler(objet('u2/rush/prive.mp4'), 'u1');
    expect(res.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it('son propre objet passe, comme avant', async () => {
    const { res, amont } = await appeler(objet('u1/rush/a.mp4'), 'u1');
    expect(res.status).toBe(200);
    expect(amont).toHaveBeenCalled();
  });

  it('un compartiment hors liste est refuse meme sous son propre prefixe', async () => {
    const { res, amont } = await appeler(
      `${APP}/storage/v1/object/public/backups/u1/dump.mp4`, 'u1',
    );
    expect(res.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it('la traversee sous le bon prefixe est refusee', async () => {
    const { res, amont } = await appeler(objet('u1/../u2/prive.mp4'), 'u1');
    expect(res.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it('`converted/` reste lisible — prefixe partage, anterieur a ce lot', async () => {
    // Ecrit sans identifiant de compte par `api/convert/to-mp4` et
    // `api/cron/publish`. Le restreindre ici casserait le repli de
    // conversion du Calendrier ; c'est le trou connu, delimite dans
    // `PREFIXES_PARTAGES`.
    const { res } = await appeler(objet('converted/converted_1712345678.mp4'), 'u1');
    expect(res.status).toBe(200);
  });

  it('les URL externes legitimes gardent leur comportement', async () => {
    for (const externe of [
      'https://images.pexels.com/photos/1/x.jpg',
      'https://images.unsplash.com/photo-1',
    ]) {
      const { res } = await appeler(externe, 'u1');
      expect(res.status, externe).toBe(200);
    }
  });

  it('un hote quelconque reste refuse', async () => {
    const { res, amont } = await appeler('https://evil.example/x.jpg', 'u1');
    expect(res.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it('sans session, toujours 401', async () => {
    const { res } = await appeler(objet('u1/rush/a.mp4'), null);
    expect(res.status).toBe(401);
  });
});
