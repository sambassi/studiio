// @vitest-environment node
/**
 * DIFFÉRENTIEL D'ANALYSEUR — ce que notre garde CROIT désigner une URL contre
 * ce que le RELAIS PUBLIC sert réellement pour elle.
 *
 * Le relais `/storage/v1/object/public/[bucket]/[...path]` sert sans session.
 * Une URL de média (écrite par le navigateur) que `cibleStockageParChemin`
 * juge « hors stockage » n'a AUCUN contrôle de propriété : si le relais la
 * sert quand même, l'objet d'un autre compte est lu puis publié (Zernio,
 * YouTube, Meta / TikTok), ou copié dans les copies PARTAGÉES.
 *
 * Le côté « relais » est reproduit avec le VRAI code de Next.js 14 :
 *   - le client HTTP envoie `new URL(u).pathname + search` (WHATWG — c'est ce
 *     que fait `requeteUnique` du fetch sûr) ;
 *   - le routeur (`resolve-routes.js`) répond 308 sur `\` ou `//`
 *     (`normalizeRepeatedSlashes`), 308 sur la barre finale, puis associe le
 *     chemin BRUT (`url.parse`, non décodé) à la regex de la route dynamique
 *     (`getRouteRegex`) et décode chaque segment (`getRouteMatcher`, qui
 *     lève `DecodeError` → 400 sur un échappement invalide) ;
 *   - le relais refuse ce que `cibleRecevable` refuse (404).
 *
 * Propriété exigée, pour chaque URL candidate et le compte B (attaquant) :
 *   - si le relais sert un objet, la garde ne dit JAMAIS « hors stockage » ;
 *   - si la garde autorise, l'objet SERVI appartient à B.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { parse as parseLegacy } from 'url';
import type { AddressInfo } from 'net';
import type { AdresseResolue, OptionsFetchSur } from '@/lib/securite/fetch-sur';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRouteRegex } = require('next/dist/shared/lib/router/utils/route-regex');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRouteMatcher } = require('next/dist/shared/lib/router/utils/route-matcher');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeRepeatedSlashes } = require('next/dist/shared/lib/utils');

const MP4 = Buffer.from(`ftypisom-FAUX-MP4-${'z'.repeat(512)}`);
const relais = { hits: 0, chemins: [] as string[] };
let portRelais = 0;
let serveur: http.Server;
const IP_APP = '93.184.216.34';
const resoudre = async (hote: string): Promise<AdresseResolue[]> => {
  if (['studiio.pro', 'alias.example', 'studiio.pro.'].includes(hote.toLowerCase())) return [{ address: IP_APP, family: 4 }];
  throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
};
const connexionVers = () => ({ host: '127.0.0.1', port: portRelais });

vi.mock('@/lib/securite/fetch-sur', async (orig) => {
  const actual = await orig<typeof import('@/lib/securite/fetch-sur')>();
  const injecte = (opts: OptionsFetchSur = {}) => ({ ...opts, resoudre, connexionVers, timeoutMs: 5_000 });
  return {
    ...actual,
    telechargerSur: (url: string, dest: string, opts?: OptionsFetchSur) => actual.telechargerSur(url, dest, injecte(opts)),
  };
});
const createSignedUrl = vi.fn(async (c: string) => ({ data: { signedUrl: `https://signe.example/${c}?token=t` }, error: null }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { storage: { from: () => ({ createSignedUrl: (c: string) => createSignedUrl(c) }) } },
}));

import { cibleRecevable, cibleLisibleParCompte, cibleStockageParChemin } from '@/lib/storage/acces-objet';
import { verdictStockagePublication, lireMediaPublication, ErreurMediaPublication } from '@/lib/social/media-publication';
import { ensurePublicUrl } from '@/lib/social/url-publication';
import { classerUrlLecture } from '@/lib/creer/analyse-rush-serveur';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';

const O = 'https://studiio.pro';
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; // victime
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'; // attaquant
const CLE_A = `${A}/library/secret.mp4`;

// ── Le relais, tel que Next.js 14 l'atteint ─────────────────────────────────
const MATCHER_RELAIS = getRouteMatcher(getRouteRegex('/storage/v1/object/public/[bucket]/[...path]'));

/** L'objet que le relais SERVIRAIT pour cette URL, ou `null` (404 / 400 / autre route). */
function objetServi(url: string): { bucket: string; cle: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let cible = `${u.pathname}${u.search}`;
  for (let saut = 0; saut < 5; saut++) {
    const sansRequete = cible.split('?', 1)[0];
    if (/(\\|\/\/)/.test(sansRequete)) { cible = normalizeRepeatedSlashes(cible); continue; } // 308
    const chemin = parseLegacy(cible).pathname ?? '/';
    if (chemin.length > 1 && chemin.endsWith('/')) { cible = chemin.replace(/\/+$/, '') + (u.search || ''); continue; } // 308
    let params: { bucket: string; path: string[] } | false;
    try { params = MATCHER_RELAIS(chemin); } catch { return null; } // DecodeError → 400
    if (!params) return null;
    const cle = Array.isArray(params.path) ? params.path.join('/') : '';
    if (!cibleRecevable(params.bucket, cle)) return null; // 404 du relais
    return { bucket: params.bucket, cle };
  }
  return null;
}

// ── Les URL candidates ──────────────────────────────────────────────────────
const AUTORITES = [
  'https://studiio.pro', 'http://studiio.pro', 'https://STUDIIO.PRO.', 'https://studiio.pro:443',
  'https://alias.example', `http://${IP_APP}`, 'http://[::ffff:5db8:d822]', 'https://u:p@studiio.pro',
  // Formes que WHATWG accepte et qu'une lecture brute ne découpe pas.
  'https:studiio.pro', 'https:/studiio.pro', 'HTTPS:studiio.pro', 'https:\\\\studiio.pro', 'https:/\\studiio.pro',
  'ht\ttps://studiio.pro', 'https\n://studiio.pro', '\u0001https://studiio.pro', '\u0000https://studiio.pro',
  'https://studi\tio.pro', 'https://studiio.pro\t',
];
const P = '/storage/v1/object/public';
const CHEMINS = [
  `${P}/media/${CLE_A}`,
  `${P}/media/${CLE_A}/`,
  `${P}/media/${CLE_A};x`,
  `${P}/media;x/${CLE_A}`,
  `${P}/media/${A}%3B/library/secret.mp4`,
  `${P}/media/${CLE_A}%3Fx=1`,
  `${P}/media/${CLE_A}%23x`,
  `${P}/media//${CLE_A}`,
  `${P}//media/${CLE_A}`,
  `/storage//v1/object/public/media/${CLE_A}`,
  `${P}/./media/${CLE_A}`,
  `${P}/media/./${CLE_A}`,
  `${P}/media/%2e/${CLE_A}`,
  `${P}/x/../media/${CLE_A}`,
  `${P}/x/%2e%2e/media/${CLE_A}`,
  `${P}/x/.%2E/media/${CLE_A}`,
  `/x/../storage/v1/object/public/media/${CLE_A}`,
  `/storage/v1/object/sign/../public/media/${CLE_A}`,
  `${P}/media/${B}/../${CLE_A}`,
  `${P}/media/${B}/%2e%2e/${CLE_A}`,
  `${P}/media/${B}%2F..%2F${CLE_A}`,
  `${P}/media/${B}/%252e%252e/${CLE_A}`,
  `${P}/media%2F${CLE_A}`,
  `${P}/media/${A}%2Flibrary%2Fsecret.mp4`,
  `${P}/media/${A}%252Flibrary%252Fsecret.mp4`,
  `${P}\\media\\${A}\\library\\secret.mp4`,
  `\\storage\\v1\\object\\public\\media\\${CLE_A}`,
  `/Storage/v1/object/public/media/${CLE_A}`,
  `/storage/v1/object/PUBLIC/media/${CLE_A}`,
  `/storage\uFF0Fv1/object/public/media/${CLE_A}`,
  `${P}/media/${A}\uFF0Flibrary/secret.mp4`,
  `${P}/media/${CLE_A}%00`,
  `${P}/media/${A}%00/library/secret.mp4`,
  `${P}/media/${A}/library/se\tcret.mp4`,
  `${P}/media/${A}/library/se\ncret.mp4`,
  `/stor\tage/v1/object/public/media/${CLE_A}`,
  `/%73torage/v1/object/public/media/${CLE_A}`,
  `/%73torage/v1/object/public/media/${A}/library/x%ZZ.mp4`,
  `${P}/medi%61/${CLE_A}`,
  `${P}/media/%61${A.slice(1)}/library/secret.mp4`,
  `${P}/media/${A}/library/secret.mp4?download=1`,
  `${P}/media/${A}/library/secret.mp4#frag`,
  `/fr${P}/media/${CLE_A}`,
  `/_next${P}/media/${CLE_A}`,
  `${P}/media/converted/converted_1712345678.mp4`,
];
const CANDIDATES: string[] = [
  ...CHEMINS, // relatives : complétées par `toAbsoluteMediaUrl`, comme à la publication
  ...AUTORITES.flatMap((a) => CHEMINS.map((c) => `${a}${c}`)),
];

beforeAll(async () => {
  serveur = http.createServer((req, res) => {
    relais.hits += 1;
    relais.chemins.push(req.url ?? '/');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) });
    res.end(MP4);
  });
  portRelais = await new Promise((r) => serveur.listen(0, '127.0.0.1', () => r((serveur.address() as AddressInfo).port)));
});
afterAll(async () => { await new Promise((r) => serveur.close(r)); });
beforeEach(() => {
  vi.clearAllMocks();
  relais.hits = 0; relais.chemins.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', O);
  vi.stubEnv('NEXTAUTH_URL', '');
  vi.stubEnv('PUBLIC_STORAGE_URL', '');
  vi.stubEnv('SUPABASE_LEGACY_STORAGE_URL', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// Une ancienne conversion `converted/…` (sans compte) n'est plus jamais
// autorisée : le verdict doit être `refuse` (voir le candidat dédié).
const CONVERSION_HISTORIQUE = /^converted\/[^/]+$/;

describe('différentiel : la garde et le relais désignent le même objet', () => {
  it('le banc reproduit bien le relais (sanité)', () => {
    expect(objetServi(`${O}${P}/media/${CLE_A}`)).toEqual({ bucket: 'media', cle: CLE_A });
    expect(objetServi(`https:studiio.pro${P}/media/${CLE_A}`)).toEqual({ bucket: 'media', cle: CLE_A });
    expect(objetServi(`${O}${P}/media/${A}%2Flibrary%2Fsecret.mp4`)).toEqual({ bucket: 'media', cle: CLE_A });
    expect(objetServi(`${O}${P}/media//${CLE_A}`)).toEqual({ bucket: 'media', cle: CLE_A }); // après 308
    expect(objetServi(`${O}/Storage/v1/object/public/media/${CLE_A}`)).toBeNull();
    expect(objetServi(`${O}/%73torage/v1/object/public/media/${CLE_A}`)).toBeNull();
  });

  it.each(CANDIDATES.map((c) => [JSON.stringify(c), c]))('%s', (_n, candidate) => {
    const absolue = toAbsoluteMediaUrl(candidate);
    const servi = objetServi(absolue);
    const verdict = verdictStockagePublication(absolue, B);
    const parChemin = cibleStockageParChemin(absolue);
    if (servi) {
      expect(parChemin, 'servi par le relais mais jugé hors stockage').not.toBeNull();
      expect(verdict, 'servi par le relais mais jugé hors stockage').not.toBe('hors-stockage');
      if (verdict === 'autorise') {
        const aB = cibleLisibleParCompte(servi.bucket, servi.cle, B);
        expect(aB, `autorisé pour B mais le relais sert ${servi.bucket}/${servi.cle}`).toBe(true);
      }
      const lecture = classerUrlLecture(absolue, B, [O]);
      expect(lecture.genre, 'lecture au nom de B : jamais « externe »').not.toBe('externe');
      if (lecture.genre === 'stockage') expect(cibleLisibleParCompte(lecture.bucket, lecture.cle, B)).toBe(true);
    }
    // Quoi qu'il arrive, l'objet de A n'est jamais autorisé pour B.
    if (servi && servi.cle === CLE_A) expect(verdict).toBe('refuse');
    // Ni une ancienne conversion sans compte.
    if (servi && CONVERSION_HISTORIQUE.test(servi.cle)) expect(verdict).toBe('refuse');
  });
});

describe('bout en bout : formes WHATWG non découpées par la lecture brute', () => {
  const FORMES = [
    `https:studiio.pro${P}/media/${CLE_A}`,
    `https:/studiio.pro${P}/media/${CLE_A}`,
    `ht\ttps://studiio.pro${P}/media/${CLE_A}`,
    `\u0001https://studiio.pro${P}/media/${CLE_A}`,
  ];
  it.each(FORMES.map((f) => [JSON.stringify(f), f]))('lireMediaPublication(%s) par B → refus, 0 requête au relais', async (_n, u) => {
    const e = await lireMediaPublication(u, { userId: B }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurMediaPublication);
    expect((e as ErreurMediaPublication).code).toBe('refuse');
    expect(relais.hits).toBe(0);
  });
  it.each(FORMES.map((f) => [JSON.stringify(f), f]))('ensurePublicUrl(%s) par B → refus, jamais rendue telle quelle', async (_n, u) => {
    await expect(ensurePublicUrl(u, B)).rejects.toBeInstanceOf(ErreurMediaPublication);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it('A publie SON objet sous la forme canonique : toujours servi', async () => {
    const r = await lireMediaPublication(`http://studiio.pro${P}/media/${CLE_A}`, { userId: A });
    expect(Buffer.from(r.octets).equals(MP4)).toBe(true);
    expect(relais.hits).toBe(1);
  });
});
