// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * L'URL média TEMPORAIRE et SIGNÉE qu'un fournisseur reçoit — et la route qui
 * la sert. N'ouvre qu'un objet PRIVÉ du dossier avatar (source, consentement,
 * audio), jamais une vidéo générée ni un autre domaine ; expire ; toute
 * altération ferme. Le relais public, lui, refuse ces trois objets.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const G = '55555555-5555-4555-8555-000000000001';
const NONCE = 'a'.repeat(32);
const SOURCE = `${U}/avatar/source-1700000000000-${NONCE}.mp4`;
const CONSENT = `${U}/avatar/consent-1700000000001-${NONCE}.mov`;
const AUDIO = `${U}/avatar/audio-${G}.mp3`;
const GENEREE = `${U}/avatar/${G}.mp4`;

const env = { AUTH_SECRET: 'secret-de-test-tres-long', NEXT_PUBLIC_APP_URL: 'https://studiio.pro' } as unknown as NodeJS.ProcessEnv;

const stockage = vi.hoisted(() => ({ objets: new Map<string, { taille: number }>() }));
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    async statObject(_b: string, cle: string) { const o = stockage.objets.get(cle); if (!o) throw new Error('NotFound'); return { size: o.taille }; },
    async putObject() { return {}; },
  }),
  lecteurMinio: () => ({
    async getObject(_b: string, cle: string) { const { Readable } = await import('stream'); return Readable.from([Buffer.from(`OBJET:${cle}`)]); },
  }),
}));

const { jetonMediaAvatar, clePourJetonMedia, urlMediaTemporaire, DUREE_JETON_MEDIA_MS } = await import('@/lib/avatar/jeton-media');
const { cleSourceAvatarPrivee } = await import('@/lib/storage/acces-objet');
const route = await import('@/app/api/avatar/media/[jeton]/[nom]/route');

beforeEach(() => { stockage.objets.clear(); process.env.AUTH_SECRET = env.AUTH_SECRET; process.env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL; });

describe('jeton-media — signer, relire', () => {
  it('⚠️ ouvre la source, le consentement et l’audio ; refuse une vidéo générée, autrui hors dossier, un autre domaine', () => {
    const t0 = 1_700_000_000_000;
    for (const cle of [SOURCE, CONSENT, AUDIO]) {
      const jeton = jetonMediaAvatar({ cle, expireLe: t0 + 1000 }, env);
      expect(clePourJetonMedia(jeton, t0, env)).toBe(cle);
    }
    expect(() => jetonMediaAvatar({ cle: GENEREE, expireLe: t0 + 1000 }, env)).toThrow();
    expect(() => jetonMediaAvatar({ cle: `${U}/rendus/x.mp4`, expireLe: t0 + 1000 }, env)).toThrow();
    expect(() => jetonMediaAvatar({ cle: `../${SOURCE}`, expireLe: t0 + 1000 }, env)).toThrow();
  });

  it('⚠️ expiré, altéré, signé avec un autre secret, malformé → null', () => {
    const t0 = 1_700_000_000_000;
    const jeton = jetonMediaAvatar({ cle: SOURCE, expireLe: t0 + 1000 }, env);
    expect(clePourJetonMedia(jeton, t0 + 1000, env)).toBeNull();
    expect(clePourJetonMedia(jeton, t0 + 5000, env)).toBeNull();
    const [corps, sig] = jeton.split('.');
    expect(clePourJetonMedia(`${corps}x.${sig}`, t0, env)).toBeNull();
    expect(clePourJetonMedia(`${corps}.${sig.slice(0, -2)}zz`, t0, env)).toBeNull();
    expect(clePourJetonMedia(jeton, t0, { ...env, AUTH_SECRET: 'autre' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    // Corps forgé vers une vidéo générée, avec la vraie signature d'un autre corps : refusé.
    const forge = Buffer.from(`${GENEREE}|${t0 + 1000}`).toString('base64url');
    expect(clePourJetonMedia(`${forge}.${sig}`, t0, env)).toBeNull();
    for (const mauvais of ['', '.', 'abc', 'abc.', '.def', 'a b.c', null, 42, 'x'.repeat(2000)]) expect(clePourJetonMedia(mauvais, t0, env)).toBeNull();
    // Sans secret : aucune signature possible.
    expect(() => jetonMediaAvatar({ cle: SOURCE, expireLe: t0 + 1 }, {} as unknown as NodeJS.ProcessEnv)).toThrow(/AUTH_SECRET/);
  });

  it('⚠️ l’URL est HTTPS sur NEXT_PUBLIC_APP_URL et se termine par le nom de l’objet (extension pour le fournisseur) ; 2 h par défaut', () => {
    const t0 = 1_700_000_000_000;
    const url = urlMediaTemporaire(CONSENT, { maintenant: t0 }, env);
    expect(url).toMatch(new RegExp(`^https://studiio\\.pro/api/avatar/media/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/consent-1700000000001-${NONCE}\\.mov$`));
    const jeton = url.split('/')[6];
    expect(clePourJetonMedia(jeton, t0 + DUREE_JETON_MEDIA_MS - 1, env)).toBe(CONSENT);
    expect(clePourJetonMedia(jeton, t0 + DUREE_JETON_MEDIA_MS, env)).toBeNull();
    expect(() => urlMediaTemporaire(CONSENT, {}, { ...env, NEXT_PUBLIC_APP_URL: 'http://studiio.pro' } as unknown as NodeJS.ProcessEnv)).toThrow(/HTTPS/);
    expect(url).not.toContain(env.AUTH_SECRET as string);
  });

  it('⚠️ le relais public refuse la source, le consentement ET l’audio ; il sert toujours la vidéo générée', () => {
    expect(cleSourceAvatarPrivee('media', SOURCE)).toBe(true);
    expect(cleSourceAvatarPrivee('media', CONSENT)).toBe(true);
    expect(cleSourceAvatarPrivee('media', AUDIO)).toBe(true);
    expect(cleSourceAvatarPrivee('media', encodeURIComponent(CONSENT))).toBe(true);
    expect(cleSourceAvatarPrivee('media', GENEREE)).toBe(false);
  });
});

describe('GET /api/avatar/media/[jeton]/[nom]', () => {
  const t0 = Date.now();
  const appeler = (jeton: string, nom: string) =>
    route.GET(new NextRequest(`https://studiio.pro/api/avatar/media/${jeton}/${nom}`), { params: { jeton, nom } });

  it('⚠️ jeton valide + objet présent → 200, type d’après le nom, no-store, sandbox', async () => {
    stockage.objets.set(AUDIO, { taille: 1234 });
    const jeton = jetonMediaAvatar({ cle: AUDIO, expireLe: t0 + 60_000 }, env);
    const res = await appeler(jeton, `audio-${G}.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-length')).toBe('1234');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(await res.text()).toBe(`OBJET:${AUDIO}`);
    stockage.objets.set(CONSENT, { taille: 10 });
    const r2 = await appeler(jetonMediaAvatar({ cle: CONSENT, expireLe: t0 + 60_000 }, env), `consent-1700000000001-${NONCE}.mov`);
    expect(r2.headers.get('content-type')).toBe('video/quicktime');
  });

  it('⚠️ jeton faux / expiré / nom différent / objet absent ou vide → 404, sans détail', async () => {
    stockage.objets.set(SOURCE, { taille: 10 });
    const bon = jetonMediaAvatar({ cle: SOURCE, expireLe: t0 + 60_000 }, env);
    expect((await appeler('faux.jeton', 'x.mp4')).status).toBe(404);
    expect((await appeler(jetonMediaAvatar({ cle: SOURCE, expireLe: t0 - 1 }, env), `source-1700000000000-${NONCE}.mp4`)).status).toBe(404);
    expect((await appeler(bon, 'autre.mp4')).status).toBe(404);
    stockage.objets.delete(SOURCE);
    expect((await appeler(bon, `source-1700000000000-${NONCE}.mp4`)).status).toBe(404);
    stockage.objets.set(SOURCE, { taille: 0 });
    const res = await appeler(bon, `source-1700000000000-${NONCE}.mp4`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/avatar\/source|NotFound/);
  });
});
