/**
 * IDOR — LECTURE SERVEUR D'UN OBJET DE STOCKAGE AU NOM D'UN COMPTE.
 *
 * `urlDeLecture` signait (MinIO interne, 600 s) N'IMPORTE QUELLE adresse
 * `/storage/v1/object/public/<bucket>/<clé>` : ni la politique du relais
 * public (`cibleRecevable`), ni la propriété. Un compte A pouvait poser dans
 * `rush_urls` l'adresse d'un objet PRIVÉ de B (source d'avatar, montage, LUT,
 * analyse, audio payé…) et le faire lire, analyser et monter dans SON montage.
 *
 * Verrouille :
 *  - la matrice des règles (`cibleLisibleParCompte`, `classerUrlLecture`) ;
 *  - AUCUNE signature (espion) avant la validation, et aucune sur refus ;
 *  - le proxy de rendu ne touche pas le stockage (ni `statObject`) sur refus ;
 *  - `produireUnMontage` lâche le rush / la musique de B, monte ceux de A,
 *    et ne sonde, n'analyse, ne rend, n'écrit RIEN de B.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Stockage doublé : on ESPIONNE la signature et le `statObject` ───────────
const presignedGetObject = vi.fn(async (b: string, c: string, _t: number) => `http://studiio-minio:9000/${b}/${c}?X-Amz-Signature=x`);
const statObject = vi.fn(async (_b: string, _c: string) => ({ size: 1000 }));
vi.mock('@/lib/storage/minio-client', () => ({
  signeurInterne: () => ({ presignedGetObject: (b: string, c: string, t: number) => presignedGetObject(b, c, t) }),
  clientMinio: () => ({ statObject: (b: string, c: string) => statObject(b, c) }),
}));

// Copie des médias externes doublée : jamais de réseau.
const localiserMedia = vi.fn(async (_u: string, _o?: unknown) => 'https://studiio.pro/storage/v1/object/public/media/externes/abc123.mp4');
vi.mock('@/lib/securite/medias-externes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/medias-externes')>();
  return { ...actual, localiserMedia: (u: string, o?: unknown) => localiserMedia(u, o) };
});

// `parseMedia` (proxy) : jamais atteint sur refus ; sinon « pas besoin de proxy ».
const parseMedia = vi.fn(async () => ({ dimensions: { width: 1080, height: 1920 }, fps: 30 }));
vi.mock('@remotion/media-parser', () => ({ parseMedia: (...a: unknown[]) => parseMedia(...(a as [])) }));

import {
  classerUrlLecture, urlDeLecture, mediaLisiblePar, LectureRefusee, analyserRushServeurCache, analyserMusiqueServeur,
} from '@/lib/creer/analyse-rush-serveur';
import { cibleLisibleParCompte, cibleRecevable } from '@/lib/storage/acces-objet';
import { urlRenduPourRush } from '@/lib/render/proxy-rendu';

const O = 'https://studiio.pro';
const ORIGINES = [O];
const PUB = `${O}/storage/v1/object/public`;
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const NONCE = '0123456789abcdef0123456789abcdef';
const GEN = '12345678-1234-4234-8234-123456789abc';

const urls = {
  rushA: `${PUB}/media/${A}/library/rush-a.mp4`,
  rushA2: `${PUB}/media/${A}/library/rush-a2.mp4`,
  stockA: `${PUB}/media/${A}/library/stock-pexels-video-111.mp4`,
  externe: `${PUB}/media/externes/0f0e0d0c0b0a09080706050403020100aabbccdd.mp4`,
  proxyExterne: `${PUB}/media/externes/proxies/0f0e0d0c0b0a09080706-1080p30.mp4`,
  proxyA: `${PUB}/media/${A}/proxies/0f0e0d0c0b0a09080706-1080p30.mp4`,
  audioCompletA: `${PUB}/audio/audio-complet/${A}/0123456789abcdef01234567.mp3`,
  voixA: `${PUB}/audio/${A}/autopilote-job-1-titre.mp3`,
  avatarVideoA: `${PUB}/media/${A}/avatar/${GEN}.mp4`,
  relatifA: `/storage/v1/object/public/media/${A}/library/rush-a.mp4`,
  // ── objets de B ──
  rushB: `${PUB}/media/${B}/library/rush-b.mp4`,
  stockB: `${PUB}/media/${B}/library/stock-pexels-video-222.mp4`,
  avatarSourceB: `${PUB}/media/${B}/avatar/source-1700000000000-${NONCE}.jpg`,
  avatarSourceHistoriqueB: `${PUB}/media/${B}/avatar/source-1700000000000.mp4`,
  consentementB: `${PUB}/media/${B}/avatar/consent-1700000000000-${NONCE}.mp4`,
  maVoixB: `${PUB}/media/${B}/avatar/audio-${GEN}.mp3`,
  audioCompletB: `${PUB}/audio/audio-complet/${B}/0123456789abcdef01234567.mp3`,
  voixB: `${PUB}/audio/${B}/autopilote-job-9-titre.mp3`,
  montageB: `${PUB}/videos/${B}/montages/m-1/montage.mp4`,
  lutB: `${PUB}/media/${B}/lut/look.cube`,
  analyseB: `${PUB}/media/${B}/analyse/an-1/vignette-01.jpg`,
  attributionB: `${PUB}/media/stock-attributions/${B}/stock-1.mp4.json`,
  proxyB: `${PUB}/media/${B}/proxies/0f0e0d0c0b0a09080706-1080p30.mp4`,
  convertiCommun: `${PUB}/media/converted/1700000000-x.mp4`,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', O);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('règles de propriété (`cibleLisibleParCompte`) — pures', () => {
  it('le compte lit SES objets, ses copies partagées et ses espaces au 2e segment', () => {
    expect(cibleLisibleParCompte('media', `${A}/library/rush.mp4`, A)).toBe(true);
    expect(cibleLisibleParCompte('media', `${A}/library/stock-pexels-video-1.mp4`, A)).toBe(true);
    expect(cibleLisibleParCompte('audio', `${A}/voix.mp3`, A)).toBe(true);
    expect(cibleLisibleParCompte('audio', `audio-complet/${A}/0123456789abcdef01234567.mp3`, A)).toBe(true);
    expect(cibleLisibleParCompte('media', 'externes/abc.mp4', A)).toBe(true);
    expect(cibleLisibleParCompte('media', 'externes/proxies/abc-1080p30.mp4', A)).toBe(true);
    expect(cibleLisibleParCompte('media', `${A}/avatar/${GEN}.mp4`, A)).toBe(true);
  });

  it('refuse les objets d’un autre compte, les namespaces privés, le partagé non prouvé', () => {
    expect(cibleLisibleParCompte('media', `${B}/library/rush.mp4`, A)).toBe(false);
    expect(cibleLisibleParCompte('audio', `audio-complet/${B}/0123456789abcdef01234567.mp3`, A)).toBe(false);
    expect(cibleLisibleParCompte('media', `stock-attributions/${B}/x.json`, A)).toBe(false);
    expect(cibleLisibleParCompte('media', 'converted/x.mp4', A)).toBe(false);
    expect(cibleLisibleParCompte('videos', 'externes/abc.mp4', A)).toBe(false);
    expect(cibleLisibleParCompte('media', 'externes/a/b/c.mp4', A)).toBe(false);
    // Privés MÊME pour leur propriétaire : ils ont leurs routes authentifiées.
    expect(cibleLisibleParCompte('media', `${A}/avatar/source-1700000000000-${NONCE}.jpg`, A)).toBe(false);
    expect(cibleLisibleParCompte('videos', `${A}/montages/m/x.mp4`, A)).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}/lut/x.cube`, A)).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}/analyse/a/vignette-01.jpg`, A)).toBe(false);
  });

  it('compte absent ou forgé → refus', () => {
    expect(cibleLisibleParCompte('media', `${A}/x.mp4`, '')).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}/x.mp4`, undefined)).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}/x/y.mp4`, `${A}/x`)).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}/`, A)).toBe(false);
    expect(cibleLisibleParCompte('media', `${A}x/y.mp4`, A)).toBe(false);
  });

  it('même politique que le relais public : tout refus du relais est un refus ici', () => {
    for (const [b, c] of [['media', `${A}/analyse/a/v.jpg`], ['secret', `${A}/x.mp4`], ['media', `${A}/../${B}/x.mp4`]] as const) {
      expect(cibleRecevable(b, c)).toBe(false);
      expect(cibleLisibleParCompte(b, c, A)).toBe(false);
    }
  });
});

describe('classement d’une URL (`classerUrlLecture`)', () => {
  const lisibles = ['rushA', 'stockA', 'externe', 'proxyExterne', 'proxyA', 'audioCompletA', 'voixA', 'avatarVideoA', 'relatifA'] as const;
  const refuses = [
    'rushB', 'stockB', 'avatarSourceB', 'avatarSourceHistoriqueB', 'consentementB', 'maVoixB', 'audioCompletB', 'voixB',
    'montageB', 'lutB', 'analyseB', 'attributionB', 'proxyB', 'convertiCommun',
  ] as const;
  it.each(lisibles)('A lit %s', (k) => {
    expect(classerUrlLecture(urls[k], A, ORIGINES).genre).toBe('stockage');
  });
  it.each(refuses)('A ne lit PAS %s', (k) => {
    expect(classerUrlLecture(urls[k], A, ORIGINES)).toEqual({ genre: 'refus' });
  });

  it('traversée et segments encodés → refus', () => {
    for (const u of [
      `${PUB}/media/${A}/../${B}/library/rush-b.mp4`,
      `${PUB}/media/${A}/%2e%2e/${B}/library/rush-b.mp4`,
      `${PUB}/media/${A}/%252e%252e/${B}/library/rush-b.mp4`,
      `${PUB}/media/${A}%2F..%2F${B}/library/rush-b.mp4`,
      `${PUB}/media%2F${A}/x.mp4`,
      `${PUB}/media/${A}\\..\\${B}/x.mp4`,
      `${PUB}/media/${A}/%ZZ.mp4`,
      `${PUB}/media/${B}/avatar/%73ource-1700000000000-${NONCE}.jpg`,
      `${PUB}/media/${B}/av%61tar/consent-1700000000000-${NONCE}.mp4`,
      `${PUB}/videos/${A}/%6dontages/m/x.mp4`,
    ]) expect(classerUrlLecture(u, A, ORIGINES).genre, u).toBe('refus');
  });

  it('chaîne de requête / fragment sur NOTRE origine : jugée sans eux (pas de contournement « externe »)', () => {
    expect(classerUrlLecture(`${urls.rushB}?x=1`, A, ORIGINES).genre).toBe('refus');
    expect(classerUrlLecture(`${urls.rushB}#t=2`, A, ORIGINES).genre).toBe('refus');
    expect(classerUrlLecture(`${urls.rushA}?v=2`, A, ORIGINES).genre).toBe('stockage');
  });

  it('schémas et formes exotiques → refus ; hôte étranger → externe (copié par le fetch sûr)', () => {
    for (const u of ['/etc/passwd', 'file:///etc/passwd', '//evil.test/storage/v1/object/public/media/x', ' ' + urls.rushA, 'ftp://x/y', '', `https://user:pw@studiio.pro/storage/v1/object/public/media/${A}/x.mp4`]) {
      expect(classerUrlLecture(u, A, ORIGINES).genre, u).toBe('refus');
    }
    // Le CHEMIN fait foi, pas l'hôte : un chemin d'objet de stockage sur un
    // hôte non configuré passe la propriété (avant : « externe », copié
    // depuis le relais public sans propriétaire — voir
    // `securite-stockage-chemin-fait-foi.test.ts`).
    expect(classerUrlLecture(`https://cdn.pexels.com/storage/v1/object/public/media/${B}/x.mp4`, A, ORIGINES).genre).toBe('refus');
    expect(classerUrlLecture('https://videos.pexels.com/v.mp4', A, ORIGINES).genre).toBe('externe');
  });

  it('URL Supabase historique (origine configurée) : mêmes règles que notre stockage', () => {
    const H = 'https://lhuqdmlkhezdwzwlpfqo.supabase.co';
    expect(classerUrlLecture(`${H}/storage/v1/object/public/media/${A}/rush.mp4`, A, [O, H]).genre).toBe('stockage');
    expect(classerUrlLecture(`${H}/storage/v1/object/public/media/${B}/rush.mp4`, A, [O, H]).genre).toBe('refus');
    // Origine historique coupée (`SUPABASE_LEGACY_STORAGE_URL` vide) : le
    // chemin fait toujours foi — propriété exigée, lecture dans NOTRE stockage.
    expect(classerUrlLecture(`${H}/storage/v1/object/public/media/${A}/rush.mp4`, A, [O]).genre).toBe('stockage');
    expect(classerUrlLecture(`${H}/storage/v1/object/public/media/${B}/rush.mp4`, A, [O]).genre).toBe('refus');
  });

  it('origines lues dans l’environnement par défaut', () => {
    expect(mediaLisiblePar(urls.rushA, A)).toBe(true);
    expect(mediaLisiblePar(urls.rushB, A)).toBe(false);
  });
});

describe('`urlDeLecture` : la garde AVANT toute signature', () => {
  it('A, son propre rush → signé en interne (bucket + clé exacts)', async () => {
    const u = await urlDeLecture(urls.rushA, A);
    expect(u).toMatch(/^http:\/\/studiio-minio:9000\//);
    expect(presignedGetObject).toHaveBeenCalledWith('media', `${A}/library/rush-a.mp4`, 600);
  });

  it('A, son stock importé et une copie partagée `externes/` → signés', async () => {
    await urlDeLecture(urls.stockA, A);
    await urlDeLecture(urls.externe, A);
    expect(presignedGetObject.mock.calls.map((c) => c[1])).toEqual([
      `${A}/library/stock-pexels-video-111.mp4`, 'externes/0f0e0d0c0b0a09080706050403020100aabbccdd.mp4',
    ]);
  });

  it.each([
    'rushB', 'avatarSourceB', 'consentementB', 'maVoixB', 'audioCompletB', 'voixB', 'montageB', 'lutB', 'analyseB', 'proxyB',
  ] as const)('A avec %s → LectureRefusee, AUCUNE signature, aucune copie', async (k) => {
    const err = await urlDeLecture(urls[k], A).catch((e) => e);
    expect(err).toBeInstanceOf(LectureRefusee);
    // Message neutre : ni clé, ni identifiant de B, ni adresse interne.
    expect(String(err.message)).not.toContain(B);
    expect(String(err.message)).not.toMatch(/minio|storage|http/i);
    expect(presignedGetObject).not.toHaveBeenCalled();
    expect(localiserMedia).not.toHaveBeenCalled();
  });

  it('média externe : copié par le fetch sûr, puis la COPIE est signée', async () => {
    await urlDeLecture('https://videos.pexels.com/v.mp4', A);
    expect(localiserMedia).toHaveBeenCalledTimes(1);
    expect(presignedGetObject).toHaveBeenCalledWith('media', 'externes/abc123.mp4', 600);
  });

  it('analyse et musique : refus → `null`, sans lecture ; le cache est cloisonné par compte', async () => {
    expect(await analyserRushServeurCache(urls.rushB, 12, A)).toBeNull();
    expect(await analyserMusiqueServeur(urls.audioCompletB, A)).toBeNull();
    expect(presignedGetObject).not.toHaveBeenCalled();
    const src = readFileSync(resolve(process.cwd(), 'src/lib/creer/analyse-rush-serveur.ts'), 'utf-8');
    expect(src).toContain('const cle = `${userId}|${url}@${dureeSecondes ?? \'\'}`;');
    expect(src).toContain('const cleCache = `${userId}|${url}`;');
  });
});

describe('proxy de rendu (`urlRenduPourRush`)', () => {
  it('objet de B → URL rendue telle quelle, ni `statObject`, ni signature, ni `parseMedia`', async () => {
    for (const k of ['rushB', 'montageB', 'avatarSourceB'] as const) {
      expect(await urlRenduPourRush(urls[k], A)).toEqual({ url: urls[k], proxy: false, cree: false });
    }
    expect(statObject).not.toHaveBeenCalled();
    expect(presignedGetObject).not.toHaveBeenCalled();
    expect(parseMedia).not.toHaveBeenCalled();
  });

  it('rush de A → lu (stat + signature) pour décider du proxy', async () => {
    statObject.mockImplementation(async (_b: string, c: string) => {
      if (c.includes('/proxies/')) throw new Error('NotFound');
      return { size: 1000 };
    });
    const r = await urlRenduPourRush(urls.rushA, A);
    expect(r).toEqual({ url: urls.rushA, proxy: false, cree: false });
    expect(statObject).toHaveBeenCalledWith('media', `${A}/library/rush-a.mp4`);
    expect(presignedGetObject).toHaveBeenCalledWith('media', `${A}/library/rush-a.mp4`, 600);
  });
});

describe('rendu hybride : sources lues au nom du compte', () => {
  it('câblage : `rendreHybride` reçoit le compte et le passe à `urlDeLecture`', () => {
    const h = readFileSync(resolve(process.cwd(), 'src/lib/render/hybride/rendu.ts'), 'utf-8');
    expect(h).toContain('copieLocale(await urlDeLecture(u, input.userId), dossier, k, input.userId)');
    const r = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/render.ts'), 'utf-8');
    expect(r).toContain('rendreHybride({ jobId: input.jobId, userId: input.userId, design: input.design, onProgress })');
  });

  it('une source de B fait échouer la copie (repli Remotion) sans aucune signature', async () => {
    await expect(urlDeLecture(urls.rushB, A)).rejects.toBeInstanceOf(LectureRefusee);
    expect(presignedGetObject).not.toHaveBeenCalled();
  });
});

describe('le commentaire d’acces-objet ne prétend plus la source d’avatar ouverte', () => {
  it('plus de « PAS ENCORE FERMÉE »', () => {
    const s = readFileSync(resolve(process.cwd(), 'src/lib/storage/acces-objet.ts'), 'utf-8');
    expect(s).not.toContain('PAS ENCORE FERMÉE');
  });
});
