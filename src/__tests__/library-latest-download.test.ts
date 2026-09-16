import { describe, it, expect } from 'vitest';
import { pickLatestDownloadable } from '@/lib/library/latest-download';

/**
 * « Télécharger pour publier » doit mener au FICHIER, pas seulement à la
 * Bibliothèque. Tout repose sur ce choix : la dernière création qui porte
 * réellement un fichier. Quand il n'y en a aucune, `null` — l'appelant garde
 * alors son repli vers /dashboard/library (comportement de #254).
 */

describe('pickLatestDownloadable', () => {
  it('retourne la création la plus récente qui porte un fichier', () => {
    const latest = pickLatestDownloadable([
      { id: 'a', created_at: '2026-07-10T10:00:00Z', status: 'published', video_url: 'https://x/a.webm' },
      { id: 'b', created_at: '2026-07-28T10:00:00Z', status: 'draft', video_url: 'https://x/b.webm' },
      { id: 'c', created_at: '2026-07-20T10:00:00Z', status: 'completed', video_url: 'https://x/c.webm' },
    ]);
    expect(latest?.id).toBe('b');
  });

  it('ne se fie pas à l ordre reçu de l API', () => {
    const latest = pickLatestDownloadable([
      { id: 'vieux', created_at: '2026-01-01T00:00:00Z', video_url: 'https://x/1.webm' },
      { id: 'recent', created_at: '2026-07-29T00:00:00Z', video_url: 'https://x/2.webm' },
    ]);
    expect(latest?.id).toBe('recent');
  });

  it('ignore un rendu en cours ou échoué, même plus récent', () => {
    const latest = pickLatestDownloadable([
      { id: 'en-cours', created_at: '2026-07-30T10:00:00Z', status: 'rendering', video_url: 'https://x/tmp.webm' },
      { id: 'echec', created_at: '2026-07-29T10:00:00Z', status: 'failed', video_url: 'https://x/ko.webm' },
      { id: 'fini', created_at: '2026-07-01T10:00:00Z', status: 'completed', video_url: 'https://x/ok.webm' },
    ]);
    expect(latest?.id).toBe('fini');
  });

  it('garde les brouillons : un montage fini reste souvent en draft dans Studiio', () => {
    const latest = pickLatestDownloadable([
      { id: 'brouillon', created_at: '2026-07-30T10:00:00Z', status: 'draft', video_url: 'https://x/d.webm' },
    ]);
    expect(latest?.id).toBe('brouillon');
  });

  it('ignore une création sans fichier', () => {
    const latest = pickLatestDownloadable([
      { id: 'sans-url', created_at: '2026-07-30T10:00:00Z', status: 'completed', video_url: null },
      { id: 'url-vide', created_at: '2026-07-29T10:00:00Z', status: 'completed', video_url: '   ' },
      { id: 'avec-url', created_at: '2026-07-28T10:00:00Z', status: 'completed', video_url: 'https://x/ok.webm' },
    ]);
    expect(latest?.id).toBe('avec-url');
  });

  it('retourne null quand rien n est téléchargeable — le repli Bibliothèque prend le relais', () => {
    expect(pickLatestDownloadable([])).toBeNull();
    expect(pickLatestDownloadable([{ id: 'a', status: 'rendering', video_url: 'https://x/a.webm' }])).toBeNull();
    expect(pickLatestDownloadable([{ id: 'a', video_url: null }])).toBeNull();
  });

  it('ne casse pas sur une réponse inattendue', () => {
    expect(pickLatestDownloadable(null)).toBeNull();
    expect(pickLatestDownloadable(undefined)).toBeNull();
    expect(pickLatestDownloadable({ oups: true } as any)).toBeNull();
  });

  it('accepte une date absente ou illisible sans perdre l élément', () => {
    const latest = pickLatestDownloadable([
      { id: 'sans-date', video_url: 'https://x/a.webm' },
    ]);
    expect(latest?.id).toBe('sans-date');
  });
});
