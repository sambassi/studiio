// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * EMBELLIR LE VISAGE — PHOTO. Même filtre que la vidéo (bilatéral ffmpeg,
 * serveur Studiio), aucun fournisseur. L'original n'est jamais modifié ;
 * « Aucun » rend l'original lui-même. ffmpeg et le stockage sont simulés.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const cleJpg = (u: string) => `${u}/avatar/source-1111111111111-${'a'.repeat(32)}.jpg`;

const stockage = vi.hoisted(() => ({ objets: new Map<string, Buffer>(), deposes: [] as string[] }));
const ffmpeg = vi.hoisted(() => ({ appels: [] as Array<{ lissage: number; orientation: number }>, echec: false }));
const session = vi.hoisted(() => ({ courante: null as unknown }));

vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));
vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: { storage: { from: () => ({ upload: async (cle: string, octets: Buffer) => { stockage.deposes.push(cle); stockage.objets.set(cle, octets); return { data: { path: cle }, error: null }; } }) } },
}));
vi.mock('@/lib/avatar/source', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/source')>();
  const { Readable } = await import('node:stream');
  return {
    ...reel,
    ouvrirSourceAvatar: async (userId: string, cle: unknown) => {
      if (!reel.cleSourceAvatarDuCompte(cle, userId) || !stockage.objets.has(cle)) return null;
      const o = stockage.objets.get(cle)!;
      return { flux: Readable.from([o]), type: 'image/jpeg', taille: o.length };
    },
  };
});
vi.mock('@/lib/avatar/preparation-photo', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/preparation-photo')>();
  const { writeFile } = await import('node:fs/promises');
  return {
    ...reel,
    traiterPhoto: async (_e: string, sortie: string, lissage: number, orientation: number) => {
      ffmpeg.appels.push({ lissage, orientation });
      if (ffmpeg.echec) throw new Error('ffmpeg: échec simulé');
      await writeFile(sortie, Buffer.from(`lissee:${lissage}`));
    },
  };
});

const {
  argumentsFfmpegPhoto, orientationExif, filtresOrientation, bornerLissagePhoto,
} = await import('@/lib/avatar/preparation-photo-regles');
const { filtreLissage } = await import('@/lib/avatar/preparation-source-regles');
const depotRoute = await import('@/app/api/avatar/sources/photo/route');
const traiterRoute = await import('@/app/api/avatar/sources/photo/traiter/route');

/** Un JPEG minimal portant une étiquette EXIF d'orientation. */
function jpegAvecOrientation(o: number, petitBoutiste = false): Buffer {
  const u16 = (n: number) => (petitBoutiste ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (petitBoutiste ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const tiff = [...(petitBoutiste ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0, ...u32(0)];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

const traiter = (corps: unknown) => traiterRoute.POST(new NextRequest('https://studiio.pro/api/avatar/sources/photo/traiter', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
}));

beforeEach(() => {
  stockage.objets.clear(); stockage.deposes.length = 0;
  ffmpeg.appels.length = 0; ffmpeg.echec = false;
  session.courante = { user: { id: U } };
  stockage.objets.set(cleJpg(U), jpegAvecOrientation(6));
});

describe('Règles pures — photo', () => {
  it('⚠️ chaque lissage > 0 : un seul filtre bilatéral ; 0 % : aucun lissage', () => {
    for (const l of [10, 25, 50, 75, 100]) {
      const a = argumentsFfmpegPhoto('o.jpg', 's.jpg', l, 1);
      const vf = a[a.indexOf('-vf') + 1];
      expect(vf).toBe(`${filtreLissage(l)},format=yuvj444p`);
      expect(vf).not.toMatch(/crop|scale|perspective|lenscorrection|remap|displace/);
    }
    const a0 = argumentsFfmpegPhoto('o.jpg', 's.jpg', 0, 1);
    expect(a0[a0.indexOf('-vf') + 1]).toBe('format=yuvj444p');
  });

  it('⚠️ non destructif : l’original en ENTRÉE, une autre sortie, métadonnées retirées, rotation auto désactivée', () => {
    const a = argumentsFfmpegPhoto('original.jpg', 'lissee.jpg', 50, 1);
    expect(a[a.indexOf('-i') + 1]).toBe('original.jpg');
    expect(a[a.length - 1]).toBe('lissee.jpg');
    expect(a).toContain('-noautorotate');
    expect(a[a.indexOf('-map_metadata') + 1]).toBe('-1');
  });

  it('orientation EXIF lue (gros et petit boutiste) et redressée sans déformation', () => {
    expect(orientationExif(jpegAvecOrientation(6))).toBe(6);
    expect(orientationExif(jpegAvecOrientation(8, true))).toBe(8);
    expect(orientationExif(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(orientationExif(jpegAvecOrientation(6).subarray(0, 12))).toBe(1);
    expect(filtresOrientation(6)).toEqual(['transpose=1']);
    expect(filtresOrientation(1)).toEqual([]);
    expect(argumentsFfmpegPhoto('o.jpg', 's.jpg', 25, 6).join(' ')).toContain('transpose=1,bilateral=');
  });

  it('lissage borné 0–100 ; illisible → 0 ; anciens niveaux encore compris', () => {
    expect(bornerLissagePhoto({ lissage: 250 })).toBe(100);
    expect(bornerLissagePhoto({ lissage: -3 })).toBe(0);
    expect(bornerLissagePhoto({ lissage: 'n’importe quoi' })).toBe(0);
    expect(bornerLissagePhoto({ embellissement: 'lisse' })).toBe(75);
    expect(bornerLissagePhoto({ embellissement: 'remodeler' })).toBe(0);
    expect(bornerLissagePhoto({})).toBe(0);
  });
});

describe('POST /api/avatar/sources/photo/traiter', () => {
  it('⚠️ 0 % : l’original lui-même — ni ffmpeg, ni nouvel objet', async () => {
    const r = await (await traiter({ cleOriginal: cleJpg(U), lissage: 0 })).json();
    expect(r.data).toEqual({ cleOriginal: cleJpg(U), cleTraitee: cleJpg(U), lissage: 0 });
    expect(ffmpeg.appels).toEqual([]);
    expect(stockage.deposes).toEqual([]);
  });

  for (const lissage of [10, 25, 50, 75, 100]) {
    it(`⚠️ ${lissage} % : traité par le serveur, déposé comme SECOND objet ; l’original intact`, async () => {
      const original = Buffer.from(stockage.objets.get(cleJpg(U))!);
      const r = await (await traiter({ cleOriginal: cleJpg(U), lissage })).json();
      expect(r.success).toBe(true);
      expect(r.data.cleTraitee).not.toBe(cleJpg(U));
      expect(r.data.cleTraitee).toMatch(new RegExp(`^${U}/avatar/source-\\d+-[0-9a-f]{32}\\.jpg$`));
      expect(ffmpeg.appels).toEqual([{ lissage, orientation: 6 }]);
      expect(stockage.objets.get(r.data.cleTraitee)!.toString()).toBe(`lissee:${lissage}`);
      expect(stockage.objets.get(cleJpg(U))!.equals(original)).toBe(true);
    });
  }

  it('⚠️ la photo d’un autre compte : 404, ni lecture ni traitement', async () => {
    session.courante = { user: { id: AUTRUI } };
    expect((await traiter({ cleOriginal: cleJpg(U), lissage: 50 })).status).toBe(404);
    expect(ffmpeg.appels).toEqual([]);
  });

  it('échec ffmpeg : 422 clair, rien de déposé', async () => {
    ffmpeg.echec = true;
    const res = await traiter({ cleOriginal: cleJpg(U), lissage: 50 });
    expect(res.status).toBe(422);
    expect(stockage.deposes).toEqual([]);
  });
});

describe('POST /api/avatar/sources/photo — dépôt de l’original', () => {
  const deposer = (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    return depotRoute.POST(new NextRequest('https://studiio.pro/api/avatar/sources/photo', { method: 'POST', body: fd }));
  };
  it('⚠️ dépose l’original TEL QUEL (octet pour octet) sous une clé du compte', async () => {
    const octets = jpegAvecOrientation(1);
    const r = await (await deposer(new File([new Uint8Array(octets)], "moi.jpg", { type: "image/jpeg" }))).json();
    expect(r.success).toBe(true);
    expect(stockage.objets.get(r.data.cleOriginal)!.equals(octets)).toBe(true);
  });
  it('refuse ce qui n’est pas une photo', async () => {
    expect((await deposer(new File(['x'], 'v.mp4', { type: 'video/mp4' }))).status).toBe(415);
  });
});
