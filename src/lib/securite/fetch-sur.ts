/**
 * FETCH SÛR — la seule porte par laquelle le SERVEUR lit une URL qu'un
 * utilisateur peut influencer (rushes, musique, affiches, médias stock, vidéo
 * d'avatar, entrées de rendu).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST GARANTI, À CHAQUE SAUT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. Schéma `http:` / `https:` seulement ; jamais d'identifiants
 *      (`user:pass@hote`).
 *   2. Prédicat d'hôte FACULTATIF (`autorisee`) — ex. `urlStockAutorisee`
 *      pour le stock : rejoué sur l'URL de départ ET sur chaque `Location`.
 *   3. L'hôte est RÉSOLU (`dns.lookup`, toutes les adresses) et la requête
 *      est refusée si UNE SEULE adresse est privée, de boucle locale, de lien
 *      local, CGNAT, multicast, réservée, de documentation… en IPv4 comme en
 *      IPv6 (IPv4 mappée `::ffff:a.b.c.d`, compatible `::a.b.c.d`, NAT64
 *      `64:ff9b::/96`, 6to4 `2002::/16` : l'IPv4 embarquée est rejugée).
 *      Les formes encodées (décimal, hexa, octal, `127.1`) sont normalisées
 *      par l'analyseur WHATWG AVANT ce contrôle : `http://2130706433/` y
 *      arrive sous la forme `127.0.0.1`.
 *   4. ÉPINGLAGE DNS : la connexion part vers l'adresse VALIDÉE (option
 *      `lookup` du module `http(s)`), jamais vers une seconde résolution. Un
 *      DNS qui répond « public » puis « privé » (rebinding) ne peut donc pas
 *      détourner la connexion. TLS garde le NOM d'hôte (SNI + certificat).
 *   5. Redirections : jamais suivies en silence. Au plus `maxSauts` (3),
 *      suivies à la main, chaque `Location` repassant 1 → 4 en entier.
 *   6. Délai TOTAL (redirections comprises) et plafond d'octets (annonce
 *      `Content-Length` ET compteur pendant la lecture).
 *
 * Origines de CONFIANCE : notre propre stockage (`originesStockageConfigurees`
 * — application, CDN configuré, Supabase historique) est désigné par la
 * CONFIGURATION, pas par l'utilisateur. Son hôte n'est pas soumis au contrôle
 * d'adresse (dans un réseau Docker, le domaine de l'application peut résoudre
 * vers une adresse interne) ; tout le reste (schéma, identifiants,
 * redirections revalidées) s'applique. Une redirection qui en SORT est jugée
 * comme n'importe quelle URL.
 *
 * ⚠️ INJECTIONS DE TEST : `resoudre` (faux DNS) et `connexionVers` (envoyer
 * la connexion épinglée vers un serveur local) n'existent que pour les tests.
 * Aucun appelant de production ne les passe ; aucun défaut n'autorise une
 * adresse locale.
 */
import http from 'http';
import https from 'https';
import { lookup as dnsLookup } from 'dns';
import { isIP } from 'net';
import { Transform, type Readable } from 'stream';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { originesStockageConfigurees } from '@/lib/storage/acces-objet';

export const MAX_SAUTS_SUR = 3;
const STATUTS_REDIRECTION = new Set([301, 302, 303, 307, 308]);

// ─────────────────────────────────────────────────────────────────────────
// Politique d'adresses
// ─────────────────────────────────────────────────────────────────────────

/** Plages IPv4 interdites : [réseau, longueur du préfixe]. */
const PLAGES_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],        // « ce réseau »
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // CGNAT (RFC 6598)
  ['127.0.0.0', 8],      // boucle locale
  ['169.254.0.0', 16],   // lien local — métadonnées cloud
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF
  ['192.0.2.0', 24],     // documentation
  ['192.88.99.0', 24],   // relais 6to4
  ['192.168.0.0', 16],   // RFC 1918
  ['198.18.0.0', 15],    // bancs d'essai
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // réservé + diffusion 255.255.255.255
];

function v4EnEntier(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

function v4Interdite(ip: string): boolean {
  const n = v4EnEntier(ip);
  if (n === null) return true; // malformée : jamais « publique »
  return PLAGES_V4.some(([reseau, long]) => {
    const r = v4EnEntier(reseau) as number;
    const masque = long === 0 ? 0 : (~0 << (32 - long)) >>> 0;
    return ((n & masque) >>> 0) === ((r & masque) >>> 0);
  });
}

/** IPv6 → 16 octets, ou `null`. Gère `::`, la queue IPv4 pointée et la zone `%eth0`. */
export function octetsIpv6(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!s.includes(':')) return null;
  let queueV4: number[] = [];
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const n = v4EnEntier(v4[1]);
    if (n === null) return null;
    queueV4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    s = s.slice(0, s.length - v4[1].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const moitie = s.split('::');
  if (moitie.length > 2) return null;
  const groupes = (x: string) => (x === '' ? [] : x.split(':'));
  const tete = groupes(moitie[0]);
  const queue = moitie.length === 2 ? groupes(moitie[1]) : [];
  const nbGroupes = 8 - queueV4.length / 2;
  const manquants = nbGroupes - tete.length - queue.length;
  if (moitie.length === 1 ? manquants !== 0 : manquants < 0) return null;
  const tous = [...tete, ...Array(moitie.length === 2 ? manquants : 0).fill('0'), ...queue];
  const octets: number[] = [];
  for (const g of tous) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    octets.push((v >> 8) & 255, v & 255);
  }
  octets.push(...queueV4);
  return octets.length === 16 ? octets : null;
}

function v6Interdite(ip: string): boolean {
  const o = octetsIpv6(ip);
  if (!o) return true;
  const zeros = (de: number, a: number) => o.slice(de, a).every((x) => x === 0);
  const v4De = (de: number) => `${o[de]}.${o[de + 1]}.${o[de + 2]}.${o[de + 3]}`;
  if (zeros(0, 16)) return true;                                   // ::
  if (zeros(0, 15) && o[15] === 1) return true;                    // ::1
  if (zeros(0, 10) && o[10] === 0xff && o[11] === 0xff) return v4Interdite(v4De(12)); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return v4Interdite(v4De(12));                  // ::a.b.c.d (compatible, obsolète)
  if (o[0] === 0x00 && o[1] === 0x64 && o[2] === 0xff && o[3] === 0x9b && zeros(4, 12)) return v4Interdite(v4De(12)); // NAT64
  if (o[0] === 0x20 && o[1] === 0x02) return v4Interdite(v4De(2)); // 6to4
  if (o[0] === 0x20 && o[1] === 0x01 && o[2] === 0x00 && o[3] === 0x00) return true; // Teredo
  if (o[0] === 0x20 && o[1] === 0x01 && o[2] === 0x0d && o[3] === 0xb8) return true; // documentation
  if (o[0] === 0x01 && o[1] === 0x00 && zeros(2, 8)) return true;  // 100::/64 (rejet)
  if ((o[0] & 0xfe) === 0xfc) return true;                         // fc00::/7 (ULA)
  if (o[0] === 0xfe && (o[1] & 0xc0) === 0x80) return true;        // fe80::/10 (lien local)
  if (o[0] === 0xfe && (o[1] & 0xc0) === 0xc0) return true;        // fec0::/10 (site local)
  if (o[0] === 0xff) return true;                                  // multicast
  return false;
}

/** Vrai si cette adresse IP (v4 ou v6) ne doit JAMAIS être contactée. Pure. */
export function ipInterdite(ip: string): boolean {
  const brute = ip.replace(/^\[|\]$/g, '');
  const famille = isIP(brute.split('%')[0]);
  if (famille === 4) return v4Interdite(brute);
  if (famille === 6) return v6Interdite(brute);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Erreurs
// ─────────────────────────────────────────────────────────────────────────

export type MotifRefusSsrf =
  | 'url-invalide' | 'schema' | 'identifiants' | 'hote-refuse' | 'ip-interdite'
  | 'redirection-invalide' | 'trop-de-redirections';

/** Refus de POLITIQUE : aucune requête n'est partie vers la cible refusée. */
export class RefusSsrf extends Error {
  readonly motif: MotifRefusSsrf;
  constructor(motif: MotifRefusSsrf) {
    super(`requête sortante refusée (${motif})`);
    this.name = 'RefusSsrf';
    this.motif = motif;
  }
}

export type MotifEchecReseau = 'injoignable' | 'delai' | 'trop-volumineux' | 'statut';

/** Échec RÉSEAU (cible autorisée mais injoignable, trop lourde, statut d'erreur). */
export class EchecFetchSur extends Error {
  readonly motif: MotifEchecReseau;
  readonly status: number | null;
  constructor(motif: MotifEchecReseau, status: number | null = null) {
    super(`téléchargement impossible (${motif}${status ? ` ${status}` : ''})`);
    this.name = 'EchecFetchSur';
    this.motif = motif;
    this.status = status;
  }
}

export function estRefusSsrf(e: unknown): e is RefusSsrf {
  return e instanceof RefusSsrf;
}

// ─────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────

export interface AdresseResolue { address: string; family: number }
export type Resolveur = (hote: string) => Promise<AdresseResolue[]>;

export interface OptionsFetchSur {
  methode?: 'GET' | 'HEAD';
  /** Prédicat d'hôte supplémentaire (liste blanche), rejoué à chaque saut. */
  autorisee?: (url: URL) => boolean;
  /** Origines de confiance (notre stockage). Défaut : `originesStockageConfigurees()`. */
  originesDeConfiance?: readonly string[];
  maxSauts?: number;
  /** Délai TOTAL, redirections et lecture du corps comprises. */
  timeoutMs?: number;
  /** Plafond d'octets du corps (GET). */
  maxOctets?: number;
  entetes?: Record<string, string>;
  /** TEST SEULEMENT — faux DNS. Défaut : `dns.lookup(…, { all: true })`. */
  resoudre?: Resolveur;
  /** TEST SEULEMENT — redirige la connexion ÉPINGLÉE vers un serveur local. */
  connexionVers?: (ip: string, port: number) => { host: string; port: number };
}

const resoudreDns: Resolveur = (hote) => new Promise((resolve, reject) => {
  dnsLookup(hote, { all: true, verbatim: true }, (err, adresses) => {
    if (err) reject(err);
    else resolve((adresses as AdresseResolue[]) ?? []);
  });
});

interface CibleValidee {
  url: URL;
  /** Adresse épinglée ; `null` = origine de confiance (DNS système). */
  adresse: AdresseResolue | null;
}

function hoteNu(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/**
 * Contrôle COMPLET d'une URL (départ ou saut) : schéma, identifiants,
 * prédicat, DNS + adresses. Rejette `RefusSsrf` ; aucune requête vers la
 * cible n'est émise ici (seule la résolution DNS).
 */
export async function verifierCibleSure(brute: string | URL, opts: OptionsFetchSur = {}): Promise<CibleValidee> {
  let url: URL;
  try { url = typeof brute === 'string' ? new URL(brute) : new URL(brute.href); } catch { throw new RefusSsrf('url-invalide'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RefusSsrf('schema');
  if (url.username || url.password) throw new RefusSsrf('identifiants');
  if (opts.autorisee && !opts.autorisee(url)) throw new RefusSsrf('hote-refuse');

  const confiance = opts.originesDeConfiance ?? originesStockageConfigurees();
  if (confiance.includes(url.origin)) return { url, adresse: null };

  const hote = hoteNu(url);
  if (!hote) throw new RefusSsrf('url-invalide');
  if (isIP(hote)) {
    if (ipInterdite(hote)) throw new RefusSsrf('ip-interdite');
    return { url, adresse: { address: hote, family: isIP(hote) } };
  }
  let adresses: AdresseResolue[];
  try {
    adresses = await (opts.resoudre ?? resoudreDns)(hote);
  } catch {
    // Nom introuvable / DNS muet : on ne sait PAS où l'URL mène — échec
    // RÉSEAU (aucune requête partie), pas un refus de politique : un rush
    // personnel ne doit pas être déclaré mort sur un hoquet DNS.
    throw new EchecFetchSur('injoignable');
  }
  if (!adresses.length) throw new EchecFetchSur('injoignable');
  // UNE adresse interdite suffit : un enregistrement mixte public + privé est
  // la forme la plus simple de rebinding.
  if (adresses.some((a) => ipInterdite(a.address))) throw new RefusSsrf('ip-interdite');
  return { url, adresse: adresses[0] };
}

// ─────────────────────────────────────────────────────────────────────────
// Transport épinglé
// ─────────────────────────────────────────────────────────────────────────

export interface ReponseSure {
  status: number;
  entetes: Record<string, string>;
  /** URL réellement lue (après redirections validées). */
  url: string;
  sauts: number;
  /** Corps (flux Node). Toujours le consommer ou l'annuler (`annuler`). */
  corps: Readable;
  annuler(): void;
}

/**
 * `lookup` du module `http(s)` qui répond TOUJOURS l'adresse validée :
 * quelle que soit la question posée (nom, famille, `all`), aucune seconde
 * résolution n'a lieu — c'est l'épinglage qui défait le DNS rebinding.
 */
export function lookupEpingle(adresse: AdresseResolue) {
  return (_hote: string, o: unknown, cb: (...a: unknown[]) => void): void => {
    const rappel = typeof o === 'function' ? (o as (...a: unknown[]) => void) : cb;
    const tous = !!(o && typeof o === 'object' && (o as { all?: boolean }).all);
    if (tous) rappel(null, [{ address: adresse.address, family: adresse.family }]);
    else rappel(null, adresse.address, adresse.family);
  };
}

function requeteUnique(
  cible: CibleValidee,
  methode: 'GET' | 'HEAD',
  entetes: Record<string, string>,
  signal: AbortSignal,
  opts: OptionsFetchSur,
): Promise<http.IncomingMessage> {
  const { url, adresse } = cible;
  const module = url.protocol === 'https:' ? https : http;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  let host = hoteNu(url);
  let portConnexion = port;
  let lookup: ((h: string, o: unknown, cb: (...a: unknown[]) => void) => void) | undefined;
  if (adresse) {
    if (opts.connexionVers) {
      const dest = opts.connexionVers(adresse.address, port);
      host = dest.host;
      portConnexion = dest.port;
    } else {
      lookup = lookupEpingle(adresse);
    }
  }
  return new Promise((resolve, reject) => {
    const req = module.request({
      method: methode,
      host,
      port: portConnexion,
      path: `${url.pathname}${url.search}`,
      headers: {
        host: url.host,
        'accept-encoding': 'identity',
        'user-agent': 'Studiio/1.0',
        ...entetes,
      },
      ...(lookup ? { lookup: lookup as never } : {}),
      ...(url.protocol === 'https:' ? { servername: isIP(hoteNu(url)) ? undefined : hoteNu(url) } : {}),
      signal,
      agent: false,
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/**
 * Requête sûre : contrôles complets, connexion épinglée, redirections
 * revalidées. Rejette `RefusSsrf` (politique) ou `EchecFetchSur` (réseau).
 * Le statut final est rendu tel quel (404, 500…) : à l'appelant d'en juger.
 */
export async function requeteSure(url: string, opts: OptionsFetchSur = {}): Promise<ReponseSure> {
  const methode = opts.methode ?? 'GET';
  const maxSauts = opts.maxSauts ?? MAX_SAUTS_SUR;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), opts.timeoutMs ?? 15_000);
  if (typeof minuteur.unref === 'function') minuteur.unref();
  let courante: URL | string = url;
  try {
    for (let sauts = 0; ; sauts += 1) {
      let cible: CibleValidee;
      try {
        cible = await verifierCibleSure(courante, opts);
      } catch (e) {
        if (e instanceof EchecFetchSur) throw e;
        if (sauts > 0 && e instanceof RefusSsrf && e.motif === 'url-invalide') throw new RefusSsrf('redirection-invalide');
        throw e;
      }
      let res: http.IncomingMessage;
      try {
        res = await requeteUnique(cible, methode, opts.entetes ?? {}, controleur.signal, opts);
      } catch {
        throw new EchecFetchSur(controleur.signal.aborted ? 'delai' : 'injoignable');
      }
      const status = res.statusCode ?? 0;
      if (STATUTS_REDIRECTION.has(status)) {
        res.resume();
        res.destroy();
        const location = res.headers.location;
        if (!location) throw new RefusSsrf('redirection-invalide');
        let suivante: URL;
        try { suivante = new URL(location, cible.url); } catch { throw new RefusSsrf('redirection-invalide'); }
        if (sauts + 1 > maxSauts) throw new RefusSsrf('trop-de-redirections');
        courante = suivante;
        continue;
      }
      const entetes: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === 'string') entetes[k.toLowerCase()] = v;
        else if (Array.isArray(v)) entetes[k.toLowerCase()] = v.join(', ');
      }
      // Le minuteur reste armé pendant la lecture du corps : il est levé
      // quand le flux se termine.
      const lever = () => clearTimeout(minuteur);
      res.once('end', lever);
      res.once('close', lever);
      res.once('error', lever);
      return {
        status, entetes, url: cible.url.href, sauts, corps: res,
        annuler: () => { lever(); res.destroy(); },
      };
    }
  } catch (e) {
    clearTimeout(minuteur);
    throw e;
  }
}

/** HEAD sûr : statut et URL finale, corps annulé. */
export async function sonderSur(url: string, opts: OptionsFetchSur = {}): Promise<{ status: number; url: string; sauts: number; entetes: Record<string, string> }> {
  const r = await requeteSure(url, { timeoutMs: 8_000, ...opts, methode: 'HEAD' });
  r.annuler();
  return { status: r.status, url: r.url, sauts: r.sauts, entetes: r.entetes };
}

class CompteurBorne extends Transform {
  octets = 0;
  constructor(private readonly plafond: number) { super(); }
  _transform(morceau: Buffer, _enc: BufferEncoding, suite: (e?: Error | null, d?: Buffer) => void) {
    this.octets += morceau.length;
    if (this.octets > this.plafond) { suite(new EchecFetchSur('trop-volumineux')); return; }
    suite(null, morceau);
  }
}

/** Plafond par défaut d'un téléchargement de média (512 Mo, celui des envois). */
export const MAX_OCTETS_MEDIA = 512 * 1024 * 1024;

/**
 * Télécharge une URL dans `destination` (GET sûr, statut 2xx exigé, plafond
 * d'octets). Le fichier partiel est effacé à la moindre erreur.
 */
export async function telechargerSur(
  url: string,
  destination: string,
  opts: OptionsFetchSur = {},
): Promise<{ url: string; octets: number; typeContenu: string | null }> {
  const plafond = opts.maxOctets ?? MAX_OCTETS_MEDIA;
  const r = await requeteSure(url, { timeoutMs: 120_000, ...opts, methode: 'GET' });
  if (r.status < 200 || r.status >= 300) {
    r.annuler();
    throw new EchecFetchSur('statut', r.status);
  }
  const annonce = Number(r.entetes['content-length']);
  if (Number.isFinite(annonce) && annonce > plafond) {
    r.annuler();
    throw new EchecFetchSur('trop-volumineux');
  }
  const compteur = new CompteurBorne(plafond);
  try {
    await pipeline(r.corps, compteur, createWriteStream(destination));
  } catch (e) {
    r.annuler();
    await unlink(destination).catch(() => undefined);
    if (e instanceof EchecFetchSur || e instanceof RefusSsrf) throw e;
    throw new EchecFetchSur('injoignable');
  }
  return { url: r.url, octets: compteur.octets, typeContenu: r.entetes['content-type'] ?? null };
}

/** Lit le corps en mémoire (petits fichiers : images de référence…), plafonné. */
export async function lireSur(url: string, opts: OptionsFetchSur = {}): Promise<{ url: string; octets: Uint8Array; typeContenu: string | null }> {
  const plafond = opts.maxOctets ?? 20 * 1024 * 1024;
  const r = await requeteSure(url, { timeoutMs: 30_000, ...opts, methode: 'GET' });
  if (r.status < 200 || r.status >= 300) { r.annuler(); throw new EchecFetchSur('statut', r.status); }
  const annonce = Number(r.entetes['content-length']);
  if (Number.isFinite(annonce) && annonce > plafond) { r.annuler(); throw new EchecFetchSur('trop-volumineux'); }
  const morceaux: Buffer[] = [];
  let total = 0;
  try {
    for await (const m of r.corps) {
      const b = m as Buffer;
      total += b.length;
      if (total > plafond) { r.annuler(); throw new EchecFetchSur('trop-volumineux'); }
      morceaux.push(b);
    }
  } catch (e) {
    if (e instanceof EchecFetchSur) throw e;
    throw new EchecFetchSur('injoignable');
  }
  return { url: r.url, octets: new Uint8Array(Buffer.concat(morceaux)), typeContenu: r.entetes['content-type'] ?? null };
}
