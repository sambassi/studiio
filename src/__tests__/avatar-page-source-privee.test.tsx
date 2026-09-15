import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * AVATAR-2B — la page Avatar n'affiche plus la source par une URL publique.
 *
 * L'aperçu (photo OU vidéo) pointe `/api/avatar/source`, la route
 * authentifiée ; aucune balise de la page ne lit plus `avatar.source_url`.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import AvatarPage from '../app/dashboard/avatar/page';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const URL_PUBLIQUE = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/source-1.jpg`;

function stubApi(avatar: Record<string, unknown> | null) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/api/avatar/create')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { avatar, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1' } }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { generations: [] } }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('/dashboard/avatar — aperçu de la source', () => {
  it('⚠️ un avatar PHOTO : l’aperçu <img> lit /api/avatar/source, jamais source_url', async () => {
    // Le serveur ne renvoie plus `source_url` ; on le simule QUAND MÊME pour
    // prouver que la page ne s'en servirait pas s'il revenait.
    stubApi({ id: A, name: 'Mon avatar', status: 'completed', avatar_type: 'photo', source_url: URL_PUBLIQUE, created_at: '2026-09-01T00:00:00Z' });
    render(<AvatarPage />);
    const img = await waitFor(() => {
      const el = document.querySelector('[data-avatar-source-apercu="image"]') as HTMLImageElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(img.getAttribute('src')).toMatch(/^\/api\/avatar\/source(\?v=[^&]+)?$/);
    expect(document.body.innerHTML).not.toContain('/storage/v1/object/public/');
    expect(document.body.innerHTML).not.toContain(URL_PUBLIQUE);
  });

  it('⚠️ un avatar VIDÉO : l’aperçu <video> lit /api/avatar/source, jamais source_url', async () => {
    stubApi({ id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', source_url: URL_PUBLIQUE, created_at: '2026-09-01T00:00:00Z' });
    render(<AvatarPage />);
    const video = await waitFor(() => {
      const el = document.querySelector('[data-avatar-source-apercu="video"]') as HTMLVideoElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(video.getAttribute('src')).toMatch(/^\/api\/avatar\/source(\?v=[^&]+)?$/);
    expect(document.body.innerHTML).not.toContain('/storage/v1/object/public/');
  });

  it('⚠️ le code de la page ne lit plus `source_url` nulle part', () => {
    const source = readFileSync(resolve(__dirname, '../app/dashboard/avatar/page.tsx'), 'utf8');
    const lignesCode = source.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    expect(lignesCode.some((l) => /\.source_url\b/.test(l))).toBe(false);
    expect(lignesCode.some((l) => /src=\{avatar\.source_url\}/.test(l))).toBe(false);
  });
});
