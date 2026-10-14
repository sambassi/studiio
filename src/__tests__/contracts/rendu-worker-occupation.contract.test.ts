/**
 * A2.3 (P-a) — le compteur passif `rendusRemotionActifs()` ne change RIEN au
 * worker.
 *
 * `renderVideo`, appelé comme l'Autopilote l'appelle (via `renderCreerSimple`,
 * sans `cancelSignal`), doit passer à `selectComposition` et `renderMedia`
 * EXACTEMENT les options de 1a1a044 (oracle littéral ci-dessous, recopié de
 * `src/lib/render/worker.ts` à ce commit). Le compteur revient à 0 après un
 * succès comme après une exception.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'os';
import path from 'path';

const selectComposition = vi.fn();
const renderMedia = vi.fn();
vi.mock('@remotion/renderer', () => ({
  selectComposition: (...a: unknown[]) => selectComposition(...a),
  renderMedia: (...a: unknown[]) => renderMedia(...a),
}));
vi.mock('@remotion/bundler', () => ({ bundle: async () => '/tmp/bundle-de-test' }));
vi.mock('@/lib/render/webpackOverride', () => ({ remotionWebpackOverride: (c: unknown) => c }));
vi.mock('@/lib/storage/jeton-relais', () => ({
  signerUrlsRelaisProfond: (p: unknown) => p,
  DUREE_JETON_RENDU_MS: 1,
}));
vi.mock('@/lib/db/supabase', () => {
  const q = { update: () => q, eq: async () => ({ error: null }) };
  return { supabaseAdmin: { from: () => q } };
});

const { renderVideo, rendusRemotionActifs } = await import('@/lib/render/worker');
const { renderCreerSimple } = await import('@/lib/render/creerSimple');

const COMPOSITION = { id: 'creer-simple-montage', width: 1080, height: 1920, fps: 30, durationInFrames: 300 };

beforeEach(() => {
  selectComposition.mockReset();
  selectComposition.mockResolvedValue(COMPOSITION);
  renderMedia.mockReset();
  renderMedia.mockResolvedValue({ buffer: null });
});

describe('Options Remotion identiques à 1a1a044', () => {
  it('appel « Autopilote » (renderCreerSimple sans cancelSignal)', async () => {
    let vuPendant = -1;
    renderMedia.mockImplementation(async () => { vuPendant = rendusRemotionActifs(); return { buffer: null }; });
    const r = await renderCreerSimple({ jobId: 'auto-1', userId: 'u1', design: { title: 'T', format: '9:16' } });
    const sortie = path.join(os.tmpdir(), 'studiio-render-auto-1.mp4');
    expect(r.outputPath).toBe(sortie);
    expect(vuPendant).toBe(1);

    expect(selectComposition).toHaveBeenCalledTimes(1);
    const sel = selectComposition.mock.calls[0][0];
    expect(Object.keys(sel)).toEqual(['serveUrl', 'id', 'inputProps', 'timeoutInMilliseconds']);
    expect(sel).toStrictEqual({
      serveUrl: '/tmp/bundle-de-test', id: 'creer-simple-montage',
      inputProps: sel.inputProps, timeoutInMilliseconds: 120000,
    });

    expect(renderMedia).toHaveBeenCalledTimes(1);
    const rm = renderMedia.mock.calls[0][0];
    expect(Object.keys(rm)).toEqual([
      'composition', 'serveUrl', 'codec', 'outputLocation', 'inputProps', 'timeoutInMilliseconds',
      'videoBitrate', 'encodingMaxRate', 'encodingBufferSize', 'pixelFormat', 'colorSpace',
      'chromiumOptions', 'onProgress',
    ]);
    expect(rm).toStrictEqual({
      composition: COMPOSITION,
      serveUrl: '/tmp/bundle-de-test',
      codec: 'h264',
      outputLocation: sortie,
      inputProps: sel.inputProps,
      timeoutInMilliseconds: 240000,
      videoBitrate: '8M',
      encodingMaxRate: '12M',
      encodingBufferSize: '16M',
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      chromiumOptions: { disableWebSecurity: true, gl: 'angle' },
      onProgress: expect.any(Function),
    });
    expect('cancelSignal' in rm).toBe(false);
    expect(rendusRemotionActifs()).toBe(0);
  });

  it('avec cancelSignal : relayé à renderMedia seulement', async () => {
    const cancelSignal = () => undefined;
    await renderVideo({ jobId: 'a23', compositionId: 'creer-simple-montage', inputProps: {}, proprietaire: 'u', cancelSignal });
    expect(renderMedia.mock.calls[0][0].cancelSignal).toBe(cancelSignal);
    expect('cancelSignal' in selectComposition.mock.calls[0][0]).toBe(false);
    expect(rendusRemotionActifs()).toBe(0);
  });
});

describe('Compteur passif', () => {
  it('revient à 0 après une exception de renderMedia', async () => {
    renderMedia.mockRejectedValue(new Error('chromium'));
    await expect(renderVideo({ jobId: 'x', compositionId: 'c', inputProps: {}, proprietaire: 'u' })).rejects.toThrow('chromium');
    expect(rendusRemotionActifs()).toBe(0);
  });

  it('revient à 0 après une exception de selectComposition', async () => {
    selectComposition.mockRejectedValue(new Error('composition'));
    await expect(renderVideo({ jobId: 'y', compositionId: 'c', inputProps: {}, proprietaire: 'u' })).rejects.toThrow('composition');
    expect(rendusRemotionActifs()).toBe(0);
  });

  it('compte les rendus simultanés, sans en refuser aucun', async () => {
    const lachers: Array<() => void> = [];
    renderMedia.mockImplementation(() => new Promise((ok) => { lachers.push(() => ok({ buffer: null })); }));
    const a = renderVideo({ jobId: 'p1', compositionId: 'c', inputProps: {}, proprietaire: 'u' });
    const b = renderVideo({ jobId: 'p2', compositionId: 'c', inputProps: {}, proprietaire: 'u' });
    await vi.waitFor(() => expect(lachers).toHaveLength(2));
    expect(rendusRemotionActifs()).toBe(2);
    lachers.forEach((l) => l());
    await Promise.all([a, b]);
    expect(rendusRemotionActifs()).toBe(0);
  });
});
