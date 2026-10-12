// @vitest-environment node
/**
 * PUBLICATION — la confiance vaut pour le CHEMIN d'objet de stockage, pas
 * pour toute l'origine ; et aucune autre route de l'application ne sert sans
 * session l'objet d'un autre compte.
 *
 *  1. `lireMediaPublication` : quand l'URL de départ est notre stockage, les
 *     origines configurées sont « de confiance » (aucun contrôle d'adresse).
 *     Un saut vers une AUTRE route d'une de ces origines était suivi sans
 *     contrôle d'adresse ni de propriété. Désormais refusé.
 *  2. `/_next/image?url=/storage/v1/object/public/…` : l'optimiseur d'images
 *     de Next.js servait sans session toute image locale, donc celle d'un
 *     autre compte, sous une URL que la garde jugeait « hors stockage ».
 *     L'optimiseur est coupé (`images.unoptimized`).
 *  3. Le cron n'écrit plus de conversion sous le préfixe COMMUN `converted/`
 *     (clé horodatée, devinable) : `<userId>/converted/…`.
 *
 * Aucun réseau réel : serveur HTTP local sur 127.0.0.1.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { readFileSync } from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';

import { lireMediaPublication, ErreurMediaPublication, verdictStockagePublication } from '@/lib/social/media-publication';

const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const MP4 = Buffer.from(`ftypisom-${'q'.repeat(256)}`);
const hits: string[] = [];
let port = 0;
let serveur: http.Server;
let O = '';

beforeAll(async () => {
  serveur = http.createServer((req, res) => {
    const chemin = req.url ?? '/';
    hits.push(chemin);
    if (chemin.includes('/redirige-interne')) {
      res.writeHead(302, { Location: '/interne/secret' }); res.end(); return;
    }
    if (chemin.includes('/redirige-objet-propre')) {
      res.writeHead(302, { Location: `/storage/v1/object/public/media/${B}/library/b.mp4` }); res.end(); return;
    }
    if (chemin.startsWith('/interne/')) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('SECRET-INTERNE'); return; }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) });
    res.end(MP4);
  });
  port = await new Promise((r) => serveur.listen(0, '127.0.0.1', () => r((serveur.address() as AddressInfo).port)));
  O = `http://127.0.0.1:${port}`;
});
afterAll(async () => { await new Promise((r) => serveur.close(r)); });
beforeEach(() => {
  hits.length = 0;
  // Origine CONFIGURÉE = serveur local : elle est « de confiance » (aucun
  // contrôle d'adresse), exactement comme `NEXT_PUBLIC_APP_URL` en production.
  vi.stubEnv('NEXT_PUBLIC_APP_URL', O);
  vi.stubEnv('NEXTAUTH_URL', '');
  vi.stubEnv('PUBLIC_STORAGE_URL', '');
  vi.stubEnv('SUPABASE_LEGACY_STORAGE_URL', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('lireMediaPublication : confiance limitée au chemin d’objet de stockage', () => {
  it('son objet, sur l’origine configurée : servi', async () => {
    const r = await lireMediaPublication(`${O}/storage/v1/object/public/media/${B}/library/b.mp4`, { userId: B });
    expect(Buffer.from(r.octets).equals(MP4)).toBe(true);
  });

  it('objet de stockage qui redirige vers une AUTRE route de l’origine de confiance → refus, la route n’est jamais demandée', async () => {
    const e = await lireMediaPublication(
      `${O}/storage/v1/object/public/media/${B}/library/redirige-interne.mp4`, { userId: B },
    ).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurMediaPublication);
    expect((e as ErreurMediaPublication).code).toBe('refuse');
    expect(hits.some((h) => h.startsWith('/interne/'))).toBe(false);
  });

  it('redirection vers SON objet de stockage, même origine : suivie', async () => {
    const r = await lireMediaPublication(
      `${O}/storage/v1/object/public/media/${B}/library/redirige-objet-propre.mp4`, { userId: B },
    );
    expect(Buffer.from(r.octets).equals(MP4)).toBe(true);
  });
});

describe('optimiseur d’images de Next.js : coupé', () => {
  it('`images.unoptimized` est vrai (sinon `/_next/image?url=<objet d’un autre compte>` le sert sans session)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(path.join(process.cwd(), 'next.config.js'));
    expect(config.images?.unoptimized).toBe(true);
  });
  it('la garde de chemin ne voit pas l’objet derrière `/_next/image` — d’où la coupure à la source', () => {
    const u = `https://studiio.pro/_next/image?url=${encodeURIComponent(`/storage/v1/object/public/media/${A}/library/photo.jpg`)}&w=3840&q=100`;
    expect(verdictStockagePublication(u, B)).toBe('hors-stockage');
  });
});

describe('cron : les conversions sont écrites sous le préfixe du propriétaire', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/app/api/cron/publish/route.ts'), 'utf8');
  it('aucune clé `converted/<…>` commune n’est plus écrite', () => {
    expect(source).not.toMatch(/storagePath\s*=\s*`converted\//);
  });
  it('les deux écritures (conversion MP4, muxage audio) portent `${userId}/converted/`', () => {
    expect(source.match(/storagePath\s*=\s*`\$\{userId\}\/converted\//g)?.length).toBe(2);
  });
});
