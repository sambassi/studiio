// @vitest-environment node
/**
 * CÂBLAGE — `renderAndUpload` (Autopilote) localise TOUTES les entrées média
 * AVANT Remotion / le rendu hybride : le moteur de rendu ne reçoit que des URL
 * de notre stockage, et une cible interne fait échouer le rendu SANS l'avoir
 * lancé (aucun repli sur l'URL d'origine).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

const ORIGINES = ['https://stockage.example'];
const S = 'https://stockage.example/storage/v1/object/public/media/u1/';

let recu: CreerSimpleRenderInput | null = null;
const renderCreerSimple = vi.fn(async (i: { design: CreerSimpleRenderInput }) => {
  recu = i.design;
  return { outputPath: '/tmp/studiio-inexistant.mp4', durationFrames: 30 };
});
vi.mock('@/lib/render/creerSimple', () => ({ renderCreerSimple: (i: { design: CreerSimpleRenderInput }) => renderCreerSimple(i) }));
const rendreHybride = vi.fn();
vi.mock('@/lib/render/hybride/rendu', () => ({ raisonNonEligibleHybride: () => 'test', rendreHybride: (...a: unknown[]) => rendreHybride(...a) }));
vi.mock('@/lib/storage/upload', () => ({ uploadToStorage: async (o: { bucket: string; storagePath: string }) => `${ORIGINES[0]}/storage/v1/object/public/${o.bucket}/${o.storagePath}` }));
vi.mock('@/lib/render/audio-fichier', () => ({ mesurerAudioFichier: async () => null }));

// Copies déjà en cache pour les médias légitimes (aucun réseau) ; tout autre
// média part au fetch sûr, avec ses DÉFAUTS de production.
const EN_CACHE = new Set<string>();
vi.mock('@/lib/securite/medias-externes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/securite/medias-externes')>();
  const depot = {
    existe: async (_b: string, c: string) => EN_CACHE.has(c),
    deposer: async () => undefined,
    urlPublique: (b: string, c: string) => `${ORIGINES[0]}/storage/v1/object/public/${b}/${c}`,
  };
  return {
    ...actual,
    localiserEntreesRendu: (d: CreerSimpleRenderInput) => actual.localiserEntreesRendu(d, { depot, origines: ORIGINES }),
  };
});

import { renderAndUpload } from '@/lib/autopilot/render';
import { mediasEntreeRendu, estNotreStockage, cleMediaExterne } from '@/lib/securite/medias-externes';

beforeEach(() => { recu = null; vi.clearAllMocks(); EN_CACHE.clear(); });

describe('renderAndUpload : entrées du rendu localisées', () => {
  it('rushes, stock, photo, musique, avatar, affiche : le moteur ne reçoit que notre stockage', async () => {
    const ext = {
      affiche: 'https://images.unsplash.com/photo-9',
      photo: 'https://images.pexels.com/photos/9/x.jpeg',
      avatar: 'https://avatar-cdn.example/gen.mp4',
      musique: 'https://files.example/m.mp3',
    };
    EN_CACHE.add(cleMediaExterne(ext.affiche, 'image'));
    EN_CACHE.add(cleMediaExterne(ext.photo, 'image'));
    EN_CACHE.add(cleMediaExterne(ext.avatar, 'video'));
    EN_CACHE.add(cleMediaExterne(ext.musique, 'audio'));
    const design: CreerSimpleRenderInput = {
      title: 'T',
      posterUrl: ext.affiche,
      videoUrl: ext.avatar,
      rushs: [{ url: `${S}rush.mp4` }],
      montage: [
        { url: ext.avatar, debut: 0, fin: 2, kind: 'avatar' } as never,
        { url: `${S}rush.mp4`, debut: 2, fin: 4 } as never,
        { url: ext.photo, debut: 4, fin: 6, kind: 'image' } as never,
      ],
      musicUrl: ext.musique,
      sequenceVoiceUrls: { video: ext.avatar },
    };
    await renderAndUpload({ userId: 'u1', jobId: 'j1', design });
    expect(renderCreerSimple).toHaveBeenCalledTimes(1);
    const medias = mediasEntreeRendu(recu as CreerSimpleRenderInput);
    expect(medias.length).toBe(8);
    for (const m of medias) expect(estNotreStockage(m.url, ORIGINES), m.url).toBe(true);
    expect(JSON.stringify(recu)).not.toMatch(/unsplash|pexels|avatar-cdn|files\.example/);
  });

  it.each([
    ['169.254.169.254', 'http://169.254.169.254/latest/meta-data/'],
    ['127.0.0.1', 'http://127.0.0.1:9000/media/x.mp4'],
    ['[::ffff:10.0.0.1]', 'http://[::ffff:10.0.0.1]/x.mp4'],
  ])('média interne (%s) : rendu jamais lancé, erreur levée', async (_n, url) => {
    await expect(renderAndUpload({ userId: 'u1', jobId: 'j2', design: { title: 'T', videoUrl: url } })).rejects.toMatchObject({ name: 'RefusSsrf' });
    expect(renderCreerSimple).not.toHaveBeenCalled();
    expect(rendreHybride).not.toHaveBeenCalled();
  });
});
