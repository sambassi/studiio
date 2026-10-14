/**
 * CONTRAT — C-SOCIAL-MEDIA-FILE (octets).
 *
 * (J/K/L) Le VRAI `uploadMedia` (zernio.ts) dépose chez Zernio EXACTEMENT les
 * octets lus du stockage — 9:16, 1:1, 16:9 : aucune conversion, aucun
 * recadrage. Et la conversion WebM → MP4 (transcode-to-mp4.ts) conserve le
 * ratio (force_original_aspect_ratio=decrease, dimensions paires).
 *
 * Aucun réseau : la lecture du média et le `fetch` Zernio sont simulés,
 * FFmpeg n'est jamais lancé (child_process simulé).
 * Ne pas modifier pour faire passer la CI (docs/FEATURE_LOCKS.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

const fichiers = new Map<string, Uint8Array>();
const execFile = vi.fn();

vi.mock('@/lib/social/media-publication', async (orig) => ({
  ...(await orig<typeof import('@/lib/social/media-publication')>()),
  lireMediaPublication: async (url: string) => {
    const octets = fichiers.get(url);
    if (!octets) throw new Error(`fichier inconnu ${url}`);
    return { octets, typeContenu: 'video/mp4' };
  },
}));
vi.mock('child_process', async (orig) => {
  const vrai = await orig<typeof import('child_process')>();
  return { ...vrai, default: { ...vrai, execFile }, execFile };
});

let requetes: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'cle-test';
  fichiers.clear();
  requetes = [];
  execFile.mockReset().mockImplementation((...a: unknown[]) => {
    const cb = a[a.length - 1];
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    requetes.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers ?? {} });
    if (String(url).endsWith('/media/presign')) {
      return new Response(JSON.stringify({ uploadUrl: 'https://depot.zernio.example/presigne?sig=1', publicUrl: 'https://zernio.example/tmp/x.mp4' }), { status: 200 });
    }
    if (String(url).startsWith('https://depot.zernio.example/')) return new Response('', { status: 200 });
    throw new Error(`reseau ferme en test : ${url}`);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.ZERNIO_API_KEY; });

describe.each([
  { nom: '9:16', url: 'https://cdn.example/user-1/reel-1080x1920.mp4' },
  { nom: '1:1', url: 'https://cdn.example/user-1/carre-1080x1080.mp4' },
  { nom: '16:9', url: 'https://cdn.example/user-1/tv-1920x1080.mp4' },
])('C-SOCIAL-MEDIA-FILE — uploadMedia $nom', ({ url }) => {
  it('les octets déposés chez Zernio sont exactement ceux du fichier', async () => {
    const octets = new Uint8Array(randomBytes(64 * 1024));
    fichiers.set(url, octets);
    const { uploadMedia } = await import('@/lib/social/zernio');
    const rendue = await uploadMedia(url, 'studiio-p1.mp4', 'video/mp4', 'user-1');
    expect(rendue).toBe('https://zernio.example/tmp/x.mp4');
    const presign = requetes.find((r) => r.url.endsWith('/media/presign'))!;
    expect(JSON.parse(String(presign.body))).toEqual({ filename: 'studiio-p1.mp4', contentType: 'video/mp4' });
    const depot = requetes.find((r) => r.method === 'PUT')!;
    expect(depot.headers).toEqual({ 'Content-Type': 'video/mp4' }); // pas d'Authorization sur l'URL présignée
    expect(Buffer.from(depot.body as Uint8Array).equals(Buffer.from(octets))).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('C-SOCIAL-MEDIA-FILE — conversion WebM → MP4 : ratio conservé', () => {
  it('chaque palier borne la taille SANS déformer (force_original_aspect_ratio=decrease, dimensions paires)', async () => {
    execFile.mockReset()
      .mockImplementationOnce((...a: unknown[]) => { (a[a.length - 1] as any)(Object.assign(new Error('x'), { code: 1 })); })
      .mockImplementationOnce((...a: unknown[]) => { (a[a.length - 1] as any)(Object.assign(new Error('x'), { code: 1 })); })
      .mockImplementationOnce((...a: unknown[]) => { (a[a.length - 1] as any)(null, { stdout: '', stderr: '' }); });
    const { transcodeWebmToMp4WithLadder } = await import('@/lib/ffmpeg/transcode-to-mp4');
    const r = await transcodeWebmToMp4WithLadder('ffmpeg', '/tmp/in.webm', '/tmp/out.mp4', '[T]');
    expect(r.attempt).toMatch(/540p/);
    expect(execFile).toHaveBeenCalledTimes(3);
    for (const appel of execFile.mock.calls) {
      const args = appel[1] as string[];
      const vf = args[args.indexOf('-vf') + 1];
      expect(vf).toContain('force_original_aspect_ratio=decrease');
      expect(vf).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2');
      // Ni recadrage, ni remplissage : le cadre d'origine est gardé entier.
      expect(vf).not.toMatch(/crop|pad=/);
      expect(args).toContain('libx264');
      expect(args.at(-1)).toBe('/tmp/out.mp4');
    }
  });
});
