/**
 * CINEMA IA — TRANSFERTS DE MEDIAS VERS UNE URL EXTERNE, SANS SSRF.
 *
 * Les URLs de depot (`upload_url`), de media public et de resultat sont RENDUES PAR LE
 * FOURNISSEUR : ce ne sont pas des cibles de confiance. Trois controles, chacun
 * necessaire :
 *
 * 1. L'URL elle-meme (`urlMediaSure`) : https, port 443, sans identifiants, et un NOM DE
 *    DOMAINE — jamais une adresse IP litterale, `localhost` ni un nom interne.
 * 2. L'ADRESSE REELLEMENT CONTACTEE (`lookupSur`) : le controle est fait DANS la
 *    resolution utilisee par la connexion elle-meme (option `lookup` de `https.request`).
 *    L'adresse verifiee est donc exactement celle a laquelle la socket se connecte : un nom
 *    public qui pointe vers un reseau prive est refuse, et un DNS qui change de reponse
 *    entre une verification et la connexion (rebinding) n'a aucune fenetre.
 * 3. LES REDIRECTIONS ne sont JAMAIS suivies automatiquement : chaque saut est
 *    re-verifie (1 et 2), leur nombre est borne, et un depot (PUT) n'en suit aucune.
 *
 * Aucun en-tete d'authentification n'est ajoute ici : les cles du fournisseur ne partent
 * jamais vers ces URLs (la documentation Higgsfield l'interdit pour l'URL presignee).
 *
 * Pas de liste figee de domaines : le stockage / CDN du fournisseur peut changer de nom
 * sans casser le service. Ce sont les ADRESSES qui sont controlees, pas les noms.
 */
import https from 'https';
import dns from 'dns';
import net, { BlockList, type LookupFunction } from 'net';
import { Readable } from 'stream';
import type { IncomingMessage, ClientRequest } from 'http';

/** Suffixes de noms reserves a un usage interne : jamais resolus, jamais contactes. */
const SUFFIXES_INTERNES = /\.(local|localhost|internal|lan|home|corp|intranet|localdomain|home\.arpa)$/;

/**
 * Un hote qui n'est PAS un nom de domaine public : adresse IP litterale (IPv4 ou IPv6,
 * y compris les formes decimale/hexadecimale que `URL` normalise), `localhost`, nom a
 * un seul libelle, ou suffixe interne.
 */
export function hoteNonPublic(hote: string): boolean {
  const h = hote.toLowerCase().replace(/\.$/, '');
  if (!h || h.includes(':') || h.startsWith('[')) return true;      // IPv6 litterale
  if (/^[0-9.]+$/.test(h) || net.isIP(h)) return true;               // IPv4 litterale
  if (!h.includes('.')) return true;                                 // un seul libelle
  return h === 'localhost' || SUFFIXES_INTERNES.test(h);
}

/** https, port 443, sans identifiants, nom de domaine public. `null` sinon. */
export function urlMediaSure(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port && u.port !== '443') return null;
    if (hoteNonPublic(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/**
 * LES PLAGES JAMAIS CONTACTEES — tout ce qui n'est pas de l'Internet public routable :
 * prive, boucle locale, lien-local (dont les metadonnees cloud 169.254.169.254),
 * CGNAT (dont 100.100.100.200), documentation, multicast, reserve, et les formes IPv6
 * qui ENCAPSULENT une adresse IPv4 (mappee, NAT64, 6to4, Teredo) : refusees en bloc
 * plutot que decodees, aucun CDN legitime ne repond par elles.
 */
// ⚠️ DEUX listes SEPAREES : une `BlockList` compare une adresse IPv4 aux regles IPv6 via
// sa forme mappee (`::ffff:a.b.c.d`) — une regle `::ffff:0:0/96` y bloquerait donc TOUT
// l'IPv4. Chaque famille n'est jamais verifiee que contre sa propre liste.
const INTERDITES_V4 = (() => {
  const b = new BlockList();
  for (const [reseau, prefixe] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) b.addSubnet(reseau, prefixe, 'ipv4');
  return b;
})();

const INTERDITES_V6 = (() => {
  const b = new BlockList();
  for (const [reseau, prefixe] of [
    ['::', 96],             // non specifiee, boucle locale (::1), IPv4-compatible
    ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64
    ['100::', 64],          // rejet
    ['2001::', 23],         // usages speciaux IETF (dont Teredo 2001::/32)
    ['2001:db8::', 32],     // documentation
    ['3fff::', 20],         // documentation (RFC 9637)
    ['5f00::', 16],         // segment routing SRv6
    ['2002::', 16],         // 6to4
    ['fc00::', 7],          // adresses uniques locales (dont fd00:ec2::254)
    ['fe80::', 10], ['fec0::', 10], // lien-local, site-local
    ['ff00::', 8],          // multicast
  ] as const) b.addSubnet(reseau, prefixe, 'ipv6');
  return b;
})();

/** Une adresse IP (texte) est-elle hors de l'Internet public ? Toute forme illisible : oui. */
export function adresseInterdite(ip: string): boolean {
  const famille = net.isIP(ip);
  if (famille === 4) return INTERDITES_V4.check(ip, 'ipv4');
  if (famille !== 6) return true;
  // Forme canonique (`::ffff:7f00:1`, minuscules, zeros compresses) avant tout motif.
  let canonique: string;
  try { canonique = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return true; }
  if (/^::ffff:/.test(canonique)) return true;            // IPv4 mappee : refusee en bloc
  return INTERDITES_V6.check(canonique, 'ipv6');
}

export class DestinationInterdite extends Error {
  readonly interdit = true;
  constructor(message: string) { super(message); this.name = 'DestinationInterdite'; }
}

export type AdresseResolue = { address: string; family: number };
export type Resolveur = (hote: string) => Promise<AdresseResolue[]>;

const resolveurSysteme: Resolveur = (hote) => dns.promises.lookup(hote, { all: true, verbatim: true });

/**
 * LA RESOLUTION DE LA CONNEXION ELLE-MEME. Si UNE SEULE des adresses rendues est
 * interdite, le nom entier est refuse (un nom qui melange public et prive est suspect).
 * Accepte les deux conventions de `net` (`all: true` ou une seule adresse).
 */
export function lookupSur(resoudre: Resolveur = resolveurSysteme): LookupFunction {
  return ((hote: string, options: unknown, rappel?: unknown) => {
    const cb = (typeof options === 'function' ? options : rappel) as (...a: unknown[]) => void;
    const opts = (typeof options === 'object' && options ? options : {}) as { all?: boolean; family?: number };
    resoudre(hote).then((adresses) => {
      const candidates = adresses.filter((a) => !opts.family || a.family === opts.family);
      if (!candidates.length) throw new DestinationInterdite(`destination reseau sans adresse (${hote})`);
      const interdite = candidates.find((a) => adresseInterdite(a.address));
      if (interdite) throw new DestinationInterdite(`destination reseau interne refusee (${hote})`);
      if (opts.all) cb(null, candidates);
      else cb(null, candidates[0].address, candidates[0].family);
    }).catch((e: unknown) => {
      const err = e instanceof Error ? e : new Error('resolution impossible');
      if (opts.all) cb(err, []); else cb(err, '', 4);
    });
  }) as unknown as LookupFunction;
}

/** UN saut, sans redirection : la primitive reseau (injectable pour les tests). */
export type Envoi = (url: string, init: InitTransfert, lookup: LookupFunction) => Promise<Response>;

/**
 * En-tetes que le fournisseur NE PEUT PAS nous faire envoyer : ceux qui changent la cible
 * logique (`Host`), la longueur ou le cadrage du corps, la connexion, ou qui portent un
 * secret (`Authorization`, `Cookie`). Un depot presigne n'a besoin que de `Content-Type` et
 * d'en-tetes de signature (`x-amz-*`, `x-goog-*`...). Comparaison insensible a la casse.
 */
const EN_TETES_INTERDITS = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te',
  'trailer', 'expect', 'proxy-authorization', 'proxy-connection', 'authorization', 'cookie', 'cookie2',
]);
export function entetesSurs(entetes: Record<string, string> | undefined): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [nom, valeur] of Object.entries(entetes ?? {})) {
    if (typeof valeur !== 'string' || EN_TETES_INTERDITS.has(nom.toLowerCase())) continue;
    // Pas de saut de ligne dans un en-tete (injection d'en-tetes).
    if (/[\r\n]/.test(nom) || /[\r\n]/.test(valeur)) continue;
    sortie[nom] = valeur;
  }
  return sortie;
}

export type InitTransfert = {
  method: 'GET' | 'PUT';
  headers?: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
};

type Requete = (options: https.RequestOptions, rappel: (res: IncomingMessage) => void) => ClientRequest;

/** L'envoi de production : `https.request`, dont la resolution passe par `lookupSur`. */
export function envoyerHttps(requete: Requete = https.request): Envoi {
  return (url, init, lookup) => new Promise<Response>((resoudre, rejeter) => {
    const u = new URL(url);
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
      // `net` ne resout pas une IP litterale : elle ne passerait jamais par `lookup`.
      rejeter(new DestinationInterdite('adresse IP litterale refusee'));
      return;
    }
    const entetes: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.body) entetes['Content-Length'] = String(init.body.byteLength);
    const req = requete({
      protocol: 'https:', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`,
      method: init.method, headers: entetes, lookup, servername: u.hostname,
      agent: false, // aucune socket reutilisee : chaque connexion repasse par `lookup`
    }, (res) => {
      const statut = res.statusCode ?? 0;
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) v.forEach((x) => h.append(k, x)); else if (v !== undefined) h.set(k, String(v));
      }
      const sansCorps = statut === 204 || statut === 205 || statut === 304 || (statut >= 100 && statut < 200);
      if (sansCorps) res.resume();
      try {
        resoudre(new Response(sansCorps ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), {
          status: statut, headers: h,
        }));
      } catch (e) { res.destroy(); rejeter(e); }
    });
    const abandon = () => req.destroy(new Error('transfert interrompu (delai)'));
    if (init.signal) {
      if (init.signal.aborted) { abandon(); } else init.signal.addEventListener('abort', abandon, { once: true });
    }
    req.on('error', rejeter);
    req.end(init.body ? Buffer.from(init.body) : undefined);
  });
}

export const REDIRECTIONS_MAX = 3;

/**
 * UN TRANSFERT COMPLET. Chaque saut : URL re-verifiee, adresse verifiee a la connexion.
 * `redirectionsMax: 0` (depot) : la premiere redirection est un refus.
 * Leve `DestinationInterdite` pour toute cible refusee ; une autre erreur pour le reste.
 */
export async function transfertSur(
  url: string,
  init: InitTransfert,
  options: { redirectionsMax?: number; envoyer?: Envoi; resoudre?: Resolveur } = {},
): Promise<Response> {
  const max = options.redirectionsMax ?? REDIRECTIONS_MAX;
  const envoyer = options.envoyer ?? envoyerHttps();
  const lookup = lookupSur(options.resoudre);
  let courante = urlMediaSure(url);
  if (!courante) throw new DestinationInterdite('URL de media refusee');
  // Appliques ICI, une fois : tout `Envoi` (reel ou simule) ne voit que des en-tetes surs.
  init = { ...init, headers: entetesSurs(init.headers) };

  for (let saut = 0; ; saut++) {
    const r = await envoyer(courante, init, lookup);
    if (r.status < 300 || r.status >= 400 || r.status === 304) return r;
    // Une redirection : jamais suivie a l'aveugle.
    await r.body?.cancel().catch(() => {});
    const cible = r.headers.get('location');
    if (!cible) throw new Error(`redirection sans destination (HTTP ${r.status})`);
    if (init.method !== 'GET' || saut >= max) {
      throw new DestinationInterdite(init.method !== 'GET' ? 'redirection refusee pour un depot' : 'trop de redirections');
    }
    let absolue: string;
    try { absolue = new URL(cible, courante).toString(); } catch { throw new DestinationInterdite('redirection illisible'); }
    const suivante = urlMediaSure(absolue);
    if (!suivante) throw new DestinationInterdite('redirection vers une destination refusee');
    courante = suivante;
  }
}
