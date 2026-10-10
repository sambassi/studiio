// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * EMBELLIR UNE PHOTO WEBP — le parcours RÉEL : la vraie route, le VRAI ffmpeg
 * (`cheminFfmpeg`), de vrais fichiers WebP (générés hors ligne avec Pillow).
 * Seul le stockage est simulé. Aucun fournisseur.
 *
 * Fixtures (600 × 800, portrait) : un « visage » géométrique (contour, deux
 * yeux, nez, bouche), un cadre rouge et un carré BLEU en haut à gauche.
 *   portrait.webp        — l'image droite, sans EXIF ;
 *   portrait-exif6.webp  — la MÊME image stockée couchée (800 × 600) avec
 *                          l'orientation EXIF 6, comme un téléphone : le
 *                          navigateur l'affiche droite, la sortie doit l'être.
 *
 * Ignoré si ffmpeg est absent de la machine.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const cle = (n: string) => `${U}/avatar/source-1111111111111-${n.repeat(32).slice(0, 32)}.webp`;
const FIXTURES = resolve(__dirname, 'fixtures/avatar');

const stockage = vi.hoisted(() => ({ objets: new Map<string, Buffer>(), deposes: [] as string[] }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } }) }));
vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: { storage: { from: () => ({ upload: async (k: string, o: Buffer) => { stockage.deposes.push(k); stockage.objets.set(k, Buffer.from(o)); return { data: { path: k }, error: null }; } }) } },
}));
vi.mock('@/lib/avatar/source', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/source')>();
  const { Readable } = await import('node:stream');
  return {
    ...reel,
    ouvrirSourceAvatar: async (userId: string, k: unknown) => {
      if (!reel.cleSourceAvatarDuCompte(k, userId) || !stockage.objets.has(k)) return null;
      const o = stockage.objets.get(k)!;
      return { flux: Readable.from([o]), type: 'image/webp', taille: o.length };
    },
  };
});

const { cheminFfmpeg } = await import('@/lib/ffmpeg/binaires');
const route = await import('@/app/api/avatar/sources/photo/traiter/route');
const { orientationExifWebp, orientationPhoto } = await import('@/lib/avatar/preparation-photo-regles');

const FFMPEG = (() => { try { return cheminFfmpeg(); } catch { return ''; } })();
const ffmpegPresent = !!FFMPEG && spawnSync(FFMPEG, ['-hide_banner', '-version']).status === 0;

/** Les pixels RGB d'une image (décodée par ffmpeg), avec ses dimensions. */
function pixels(octets: Buffer): { l: number; h: number; px: (x: number, y: number) => [number, number, number] } {
  const sonde = spawnSync(FFMPEG, ['-hide_banner', '-i', 'pipe:0', '-f', 'null', '-'], { input: octets });
  const m = /, (\d+)x(\d+)/.exec(String(sonde.stderr));
  const l = Number(m?.[1]); const h = Number(m?.[2]);
  const brut = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: octets, maxBuffer: 64 * 1024 * 1024 }).stdout as Buffer;
  return { l, h, px: (x, y) => { const i = (y * l + x) * 3; return [brut[i], brut[i + 1], brut[i + 2]]; } };
}
const sombre = ([r, g, b]: number[]) => r + g + b < 3 * 90;
const bleu = ([r, g, b]: number[]) => b > 180 && r < 80 && g < 80;

const traiter = (cleOriginal: string, lissage: number) => route.POST(new NextRequest('https://studiio.pro/api/avatar/sources/photo/traiter', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cleOriginal, lissage }),
}));

beforeEach(() => {
  stockage.objets.clear(); stockage.deposes.length = 0;
  stockage.objets.set(cle('a'), readFileSync(resolve(FIXTURES, 'portrait.webp')));
  stockage.objets.set(cle('b'), readFileSync(resolve(FIXTURES, 'portrait-exif6.webp')));
});

describe('Orientation EXIF d’un WebP (lecture pure)', () => {
  it('⚠️ le bloc EXIF du conteneur RIFF est lu ; sans bloc : 1', () => {
    expect(orientationExifWebp(readFileSync(resolve(FIXTURES, 'portrait-exif6.webp')))).toBe(6);
    expect(orientationExifWebp(readFileSync(resolve(FIXTURES, 'portrait.webp')))).toBe(1);
    expect(orientationPhoto(readFileSync(resolve(FIXTURES, 'portrait-exif6.webp')), 'webp')).toBe(6);
    expect(orientationExifWebp(Buffer.from('RIFF....WEBPVP8 '))).toBe(1);
  });
});

describe.skipIf(!ffmpegPresent)('Embellir une photo WebP — vrai ffmpeg', () => {
  it('⚠️ 0 % : l’original lui-même, sans traitement ni nouvel objet', async () => {
    const r = await (await traiter(cle('a'), 0)).json();
    expect(r.data).toMatchObject({ cleOriginal: cle('a'), cleTraitee: cle('a'), lissage: 0 });
    expect(stockage.deposes).toEqual([]);
  });

  for (const niveau of [10, 25, 50, 75, 100] as const) {
    for (const [fichier, n] of [['portrait.webp', 'a'], ['portrait-exif6.webp', 'b']] as const) {
      it(`⚠️ ${niveau} % sur ${fichier} : traité, lisible, droit, non déformé, original intact`, async () => {
        const original = Buffer.from(stockage.objets.get(cle(n))!);
        const res = await traiter(cle(n), niveau);
        expect(res.status).toBe(200);
        const r = await res.json();
        expect(r.data.cleTraitee).toMatch(/\.jpg$/);
        const sortie = stockage.objets.get(r.data.cleTraitee)!;
        // Lisible, et au FORMAT AFFICHÉ (portrait 600 × 800), même pour la photo couchée + EXIF.
        const p = pixels(sortie);
        expect([p.l, p.h]).toEqual([600, 800]);
        // Droite : le repère bleu est en haut à gauche.
        expect(bleu(p.px(40, 40))).toBe(true);
        expect(bleu(p.px(560, 40))).toBe(false);
        // Traits intacts, aux mêmes places : les deux yeux, le nez ; la peau autour reste claire.
        expect(sombre(p.px(250, 305))).toBe(true);
        expect(sombre(p.px(350, 305))).toBe(true);
        expect(sombre(p.px(300, 375))).toBe(true);
        expect(sombre(p.px(300, 240))).toBe(false);
        // L'original n'a pas bougé d'un octet.
        expect(stockage.objets.get(cle(n))!.equals(original)).toBe(true);
      });
    }
  }

  it('⚠️ le lissage est CONTINU : le grain de peau décroît à chaque palier 0 → 10 → 25 → 40 → 60 → 80 → 100 % (à chaîne égale)', async () => {
    const { traiterPhoto } = await import('@/lib/avatar/preparation-photo');
    const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dossier = await mkdtemp(join(tmpdir(), 'webp-'));
    try {
      const entree = join(dossier, 'o.webp');
      await writeFile(entree, readFileSync(resolve(FIXTURES, 'portrait.webp')));
      // Variation locale de la peau (zone sans trait), sur la MÊME chaîne (JPEG) : seul le filtre diffère.
      const rugosite = async (lissage: number) => {
        const sortie = join(dossier, `${lissage}.jpg`);
        await traiterPhoto(entree, sortie, lissage, 1);
        const p = pixels(await readFile(sortie));
        let somme = 0;
        for (let y = 600; y < 700; y += 1) for (let x = 100; x < 500; x += 1) somme += Math.abs(p.px(x, y)[0] - p.px(x + 1, y)[0]);
        return somme;
      };
      const paliers = [0, 10, 25, 40, 60, 80, 100];
      const r: number[] = [];
      for (const l of paliers) r.push(await rugosite(l));
      for (let i = 1; i < r.length; i += 1) expect(r[i]).toBeLessThan(r[i - 1]);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  });
});
