// @vitest-environment node
/**
 * CINEMA IA — TRANSFERTS DE MEDIAS SANS SSRF (`reseau-sur.ts`).
 *
 * ⚠️ AUCUN APPEL SORTANT : la resolution DNS est toujours simulee, et les seuls appels a
 * `https.request` reels visent des noms dont la resolution simulee est REFUSEE — la
 * connexion n'est donc jamais ouverte. Un serveur local temoin le verifie.
 */
import { describe, it, expect } from 'vitest';
import net from 'net';
import { PassThrough } from 'stream';
import type { IncomingMessage } from 'http';
import type { RequestOptions } from 'https';
import { EventEmitter } from 'events';
import {
  adresseInterdite, lookupSur, urlMediaSure, transfertSur, envoyerHttps, DestinationInterdite, entetesSurs,
  type Resolveur, type Envoi,
} from '@/lib/cinema/generation/reseau-sur';

const PUBLIQUE = '93.184.216.34';
const dnsFixe = (table: Record<string, string[]>): Resolveur => async (h) =>
  (table[h] ?? [PUBLIQUE]).map((address) => ({ address, family: net.isIP(address) }));

function appelerLookup(lookup: ReturnType<typeof lookupSur>, hote: string, all: boolean) {
  return new Promise<{ err: Error | null; res: unknown }>((ok) => {
    (lookup as unknown as (h: string, o: object, cb: (e: Error | null, a: unknown) => void) => void)(
      hote, { all }, (err, res) => ok({ err, res }),
    );
  });
}

describe('adresses : seul l’Internet public est joignable', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '100.100.100.200', '127.0.0.1', '127.255.255.254',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.0.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:a00:1', '::127.0.0.1', '64:ff9b::a00:1', '2001::1',
    '2001:db8::1', '3fff::1', '5f00::1', '2002:a00:1::', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'fec0::1', 'ff02::1',
    'pas-une-ip', '',
  ])('%s : interdite', (ip) => expect(adresseInterdite(ip)).toBe(true));

  it.each([PUBLIQUE, '8.8.8.8', '1.1.1.1', '151.101.1.69', '172.32.0.1', '2606:4700::6810:84e5', '2a00:1450:4007::200e'])(
    '%s : publique, autorisee', (ip) => expect(adresseInterdite(ip)).toBe(false),
  );
});

describe('URL : forme acceptable avant toute resolution', () => {
  it('https public accepte, tout le reste refuse', () => {
    expect(urlMediaSure('https://d3abc.cloudfront.net/v.mp4?x=1')).toBe('https://d3abc.cloudfront.net/v.mp4?x=1');
    for (const u of [
      'http://cdn.example/x', 'https://127.0.0.1/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://[::1]/x',
      'https://[::ffff:7f00:1]/x', 'https://localhost/x', 'https://x.localhost/x', 'https://minio/x',
      'https://metadata.google.internal/x', 'https://u:p@cdn.example/x', 'https://cdn.example:444/x',
      'file:///etc/passwd', 'ftp://cdn.example/x', '', null, 42,
    ]) expect(urlMediaSure(u), String(u)).toBe(null);
  });
});

describe('lookupSur : la verification a lieu DANS la resolution de la connexion', () => {
  it('nom public vers adresse publique : rendu tel quel (les deux conventions de net)', async () => {
    const l = lookupSur(dnsFixe({}));
    const tous = await appelerLookup(l, 'cdn.example', true);
    expect(tous.err).toBe(null);
    expect(tous.res).toEqual([{ address: PUBLIQUE, family: 4 }]);
    const un = await new Promise<unknown[]>((ok) => (l as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)(
      'cdn.example', {}, (...a) => ok(a)));
    expect(un).toEqual([null, PUBLIQUE, 4]);
  });

  it.each([['10.0.0.5'], ['::1'], ['fd00::5'], ['169.254.169.254'], [PUBLIQUE, '10.0.0.5']])(
    'nom public resolvant vers %s : refuse', async (...ips) => {
      const r = await appelerLookup(lookupSur(dnsFixe({ 'piege.example': ips })), 'piege.example', true);
      expect(r.err).toBeInstanceOf(DestinationInterdite);
    },
  );

  it('rebinding : chaque connexion est re-verifiee, la seconde reponse privee est refusee', async () => {
    let n = 0;
    const l = lookupSur(async () => [{ address: n++ === 0 ? PUBLIQUE : '127.0.0.1', family: 4 }]);
    expect((await appelerLookup(l, 'rebind.example', true)).err).toBe(null);
    expect((await appelerLookup(l, 'rebind.example', true)).err).toBeInstanceOf(DestinationInterdite);
  });

  it('une resolution vide ou en echec : refus', async () => {
    expect((await appelerLookup(lookupSur(async () => []), 'vide.example', true)).err).toBeTruthy();
    expect((await appelerLookup(lookupSur(async () => { throw new Error('ENOTFOUND'); }), 'x.example', true)).err).toBeTruthy();
  });
});

describe('envoyerHttps REEL (https.request natif) : la connexion n’est jamais ouverte vers l’interne', () => {
  // Le garde reseau des tests (`setup.ts`) refuse toute socket vers un hote autre que la
  // boucle locale AVANT meme la resolution. Pour exercer le VRAI `https.request`, on vise
  // donc le nom `localhost` (seul nom qu'il laisse passer) en appelant directement l'envoi
  // natif — avec une resolution SIMULEE : c'est elle, et elle seule, qui doit refuser.
  it('connexion native : la resolution verifiee refuse 127.0.0.1, le serveur temoin ne recoit RIEN', async () => {
    let connexions = 0;
    const temoin = net.createServer((s) => { connexions++; s.destroy(); });
    await new Promise<void>((ok) => temoin.listen(443, '127.0.0.1', ok).on('error', () => ok()));
    try {
      await expect(envoyerHttps()('https://localhost/x', { method: 'GET' }, lookupSur(dnsFixe({ localhost: ['127.0.0.1'] }))))
        .rejects.toBeInstanceOf(DestinationInterdite);
      await new Promise((r) => setTimeout(r, 50));
      expect(connexions).toBe(0);
    } finally {
      temoin.close();
    }
  });

  it('connexion native : metadonnees cloud, IPv6 et IPv4 mappee refusees avant connexion', async () => {
    for (const ip of ['169.254.169.254', '10.0.0.1', '::1', '::ffff:169.254.169.254', 'fd00:ec2::254', 'fe80::1']) {
      await expect(envoyerHttps()('https://localhost/x', { method: 'GET' }, lookupSur(dnsFixe({ localhost: [ip] }))), ip)
        .rejects.toBeInstanceOf(DestinationInterdite);
    }
  });

  it('une IP litterale n’atteint jamais https.request (net ne la resoudrait pas)', async () => {
    let appels = 0;
    const envoi = envoyerHttps((() => { appels++; throw new Error('ne doit pas etre appele'); }) as never);
    await expect(envoi('https://[::1]/x', { method: 'GET' }, lookupSur(dnsFixe({})))).rejects.toBeInstanceOf(DestinationInterdite);
    expect(appels).toBe(0);
  });

  it('options passees a https.request : lookup sur, aucun agent partage, SNI, port 443, corps du depot', async () => {
    let recu: RequestOptions | null = null;
    let corps: Buffer = Buffer.alloc(0);
    const requete = ((options: RequestOptions, rappel: (res: IncomingMessage) => void) => {
      recu = options;
      const req = new EventEmitter() as unknown as EventEmitter & { end: (b?: Buffer) => void; destroy: () => void };
      req.end = (b?: Buffer) => {
        if (b) corps = b;
        const res = new PassThrough() as unknown as IncomingMessage;
        Object.assign(res, { statusCode: 200, headers: { 'content-type': 'video/mp4' } });
        rappel(res);
        (res as unknown as PassThrough).end(Buffer.alloc(2048, 1));
      };
      req.destroy = () => {};
      return req;
    }) as never;
    const lookup = lookupSur(dnsFixe({}));
    const r = await envoyerHttps(requete)('https://cdn.example/a/b.mp4?sig=1', {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3]),
    }, lookup);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(2048);
    expect(recu!.lookup).toBe(lookup);
    expect(recu!.agent).toBe(false);
    expect(recu!.port).toBe(443);
    expect(recu!.servername).toBe('cdn.example');
    expect(recu!.path).toBe('/a/b.mp4?sig=1');
    expect((recu!.headers as Record<string, string>)['Content-Length']).toBe('3');
    expect([...corps]).toEqual([1, 2, 3]);
    // Aucune cle de fournisseur n'est ajoutee par le transport.
    expect(JSON.stringify(recu!.headers)).not.toMatch(/authorization|key/i);
  });
});

describe('transfertSur : redirections re-verifiees a chaque saut', () => {
  const serveur = (routes: Record<string, () => Response>): { envoyer: Envoi; vus: string[] } => {
    const vus: string[] = [];
    return {
      vus,
      envoyer: async (url, _init, lookup) => {
        await new Promise<void>((ok, ko) => (lookup as unknown as (h: string, o: object, cb: (e: Error | null) => void) => void)(
          new URL(url).hostname, { all: true }, (e) => (e ? ko(e) : ok())));
        vus.push(url);
        return (routes[url] ?? (() => new Response(new Uint8Array(10), { status: 200 })))();
      },
    };
  };
  const vers = (l: string, s = 302) => () => new Response(null, { status: s, headers: { location: l } });

  it('URL publique normale : un seul saut', async () => {
    const s = serveur({});
    const r = await transfertSur('https://cdn.example/a', { method: 'GET' }, { envoyer: s.envoyer, resoudre: dnsFixe({}) });
    expect(r.status).toBe(200);
    expect(s.vus).toEqual(['https://cdn.example/a']);
  });

  it('redirection relative et absolue publiques : suivies', async () => {
    const s = serveur({ 'https://cdn.example/a': vers('/b'), 'https://cdn.example/b': vers('https://cdn2.example/c', 308) });
    const r = await transfertSur('https://cdn.example/a', { method: 'GET' }, { envoyer: s.envoyer, resoudre: dnsFixe({}) });
    expect(r.status).toBe(200);
    expect(s.vus).toEqual(['https://cdn.example/a', 'https://cdn.example/b', 'https://cdn2.example/c']);
  });

  it.each(['https://169.254.169.254/', 'http://cdn2.example/', 'https://localhost/', 'https://[::1]/', 'https://cdn2.example:22/'])(
    'redirection vers %s : refusee, jamais contactee', async (cible) => {
      const s = serveur({ 'https://cdn.example/a': vers(cible) });
      await expect(transfertSur('https://cdn.example/a', { method: 'GET' }, { envoyer: s.envoyer, resoudre: dnsFixe({}) }))
        .rejects.toBeInstanceOf(DestinationInterdite);
      expect(s.vus).toEqual(['https://cdn.example/a']);
    },
  );

  it('redirection vers un nom public qui resout en prive : refusee a la connexion', async () => {
    const s = serveur({ 'https://cdn.example/a': vers('https://interne.example/') });
    await expect(transfertSur('https://cdn.example/a', { method: 'GET' }, {
      envoyer: s.envoyer, resoudre: dnsFixe({ 'interne.example': ['10.9.8.7'] }),
    })).rejects.toBeInstanceOf(DestinationInterdite);
    expect(s.vus).toEqual(['https://cdn.example/a']);
  });

  it('boucle de redirections : arretee apres 3 sauts', async () => {
    const s = serveur({ 'https://cdn.example/a': vers('https://cdn.example/a') });
    await expect(transfertSur('https://cdn.example/a', { method: 'GET' }, { envoyer: s.envoyer, resoudre: dnsFixe({}) }))
      .rejects.toThrow('trop de redirections');
    expect(s.vus).toHaveLength(4);
  });

  it('depot (PUT) : aucune redirection suivie', async () => {
    const s = serveur({ 'https://cdn.example/up': vers('https://cdn.example/ailleurs', 307) });
    await expect(transfertSur('https://cdn.example/up', { method: 'PUT', body: new Uint8Array(1) }, {
      redirectionsMax: 0, envoyer: s.envoyer, resoudre: dnsFixe({}),
    })).rejects.toBeInstanceOf(DestinationInterdite);
    expect(s.vus).toEqual(['https://cdn.example/up']);
  });

  it('une URL de depart refusee ne part jamais', async () => {
    const s = serveur({});
    await expect(transfertSur('https://10.0.0.1/x', { method: 'GET' }, { envoyer: s.envoyer })).rejects.toBeInstanceOf(DestinationInterdite);
    expect(s.vus).toEqual([]);
  });
});

describe('en-tetes fournis par le fournisseur : jamais ceux qui changent la cible ou portent un secret', () => {
  it('Host, Content-Length, Authorization, Cookie, cadrage : retires, quelle que soit la casse', () => {
    expect(entetesSurs({
      'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary', 'x-goog-meta-a': 'b',
      Host: 'interne', host: 'interne', 'CONTENT-LENGTH': '1', 'Transfer-Encoding': 'chunked', Connection: 'upgrade',
      Authorization: 'Key a:b', cookie: 's=1', 'Proxy-Authorization': 'x', Expect: '100-continue',
    })).toEqual({ 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary', 'x-goog-meta-a': 'b' });
  });

  it('injection d’en-tetes par saut de ligne : retiree', () => {
    expect(entetesSurs({ 'x-ok': 'a', 'x-mauvais': 'a\r\nHost: interne', 'x\nbad': 'v' })).toEqual({ 'x-ok': 'a' });
    expect(entetesSurs(undefined)).toEqual({});
  });

  it('appliques par le transfert lui-meme : l’envoi ne voit jamais un en-tete interdit', async () => {
    let vus: Record<string, string> = {};
    await transfertSur('https://cdn.example/up', {
      method: 'PUT', body: new Uint8Array(1), headers: { 'Content-Type': 'image/png', Host: 'interne', Authorization: 'Key a:b' },
    }, {
      redirectionsMax: 0, resoudre: dnsFixe({}),
      envoyer: async (_u, init) => { vus = init.headers ?? {}; return new Response(null, { status: 200 }); },
    });
    expect(vus).toEqual({ 'Content-Type': 'image/png' });
  });
});

describe('statuts sans corps : jamais une exception qui masquerait la reponse', () => {
  it.each([204, 205, 304])('HTTP %i via https.request natif simule : reponse rendue, sans corps', async (statut) => {
    const requete = ((_o: RequestOptions, rappel: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as unknown as EventEmitter & { end: () => void; destroy: () => void };
      req.end = () => {
        const res = new PassThrough() as unknown as IncomingMessage;
        Object.assign(res, { statusCode: statut, headers: {} });
        rappel(res);
        (res as unknown as PassThrough).end();
      };
      req.destroy = () => {};
      return req;
    }) as never;
    const r = await envoyerHttps(requete)('https://cdn.example/x', { method: 'GET' }, lookupSur(dnsFixe({})));
    expect(r.status).toBe(statut);
    expect(r.body).toBeNull();
  });
});
