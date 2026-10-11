// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { normaliserConfigSources, urlStockAutorisee } from '@/lib/autopilot/sources';

/**
 * Garde SSRF des médias stock retenus : le serveur les SONDE puis le rendu les
 * TÉLÉCHARGE. Une URL libre ne doit jamais atteindre le réseau interne.
 */
describe('urlStockAutorisee', () => {
  it('accepte nos vidéos stockées (bucket media) et les photos des CDN Pexels / Unsplash', () => {
    expect(urlStockAutorisee('https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-42.mp4', 'video')).toBe(true);
    expect(urlStockAutorisee('https://images.pexels.com/photos/1/a.jpeg', 'photo')).toBe(true);
    expect(urlStockAutorisee('https://images.unsplash.com/photo-1?w=1080', 'photo')).toBe(true);
  });

  it.each([
    ['http://studiio-postgrest:3000/users', 'video'],
    ['http://169.254.169.254/latest/meta-data/', 'video'],
    ['http://localhost:3000/storage/v1/object/public/media/x.mp4', 'video'],
    ['https://studiio.pro/storage/v1/object/public/audio/x.mp3', 'video'],
    ['https://studiio.pro/storage/v1/object/public/media/../../etc', 'video'],
    ['https://evil.example/storage/v1/object/public/media/x.mp4', 'video'],
    ['https://user:pw@studiio.pro/storage/v1/object/public/media/x.mp4', 'video'],
    ['http://images.pexels.com/photos/1.jpg', 'photo'],
    ['https://images.pexels.com.evil.example/1.jpg', 'photo'],
    ['https://studiio.pro/storage/v1/object/public/media/x.jpg', 'photo'],
  ] as const)('refuse %s (%s)', (url, type) => {
    expect(urlStockAutorisee(url, type)).toBe(false);
  });

  it('normaliserConfigSources écarte à l’enregistrement toute URL hors liste', () => {
    const c = normaliserConfigSources({
      actives: { stock: true },
      stock: [
        { url: 'http://studiio-postgrest:3000/users', type: 'video', provider: 'pexels', providerAssetId: '1' },
        { url: 'https://images.unsplash.com/photo-2', type: 'photo', provider: 'unsplash', providerAssetId: '2' },
      ],
    })!;
    expect(c.stock.map((m) => m.providerAssetId)).toEqual(['2']);
  });
});
