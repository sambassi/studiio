/**
 * M3-a PR2 — navigateur : les silences de 50 ms sont calculés sur le buffer
 * DÉJÀ décodé par `decodeAudioData` (un seul téléchargement, un seul
 * décodage), l'énergie 0,5 s reste celle d'avant, et un décodage impossible
 * donne `pisteAudio: null` (jamais un silence).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sonDuRush, energieAudio } from '@/lib/creer/analyse-rush';

const SR = 22050;
function canal(): Float32Array {
  // 1 s de silence, 2 s de son, 0,6 s de silence, 1,4 s de son.
  const f = new Float32Array(5 * SR);
  for (let i = 0; i < f.length; i++) {
    const t = i / SR;
    const son = (t >= 1 && t < 3) || t >= 3.6;
    f[i] = son ? 0.2 * Math.sin(2 * Math.PI * 220 * t) : 0;
  }
  return f;
}

function installer(decode: () => Promise<unknown>) {
  const fetchMock = vi.fn(async (_u: string, init?: { method?: string }) => (init?.method === 'HEAD'
    ? { ok: true, headers: { get: (): string => '1000' } }
    : { ok: true, headers: { get: (): string => '1000' }, arrayBuffer: async () => new ArrayBuffer(1000) }));
  vi.stubGlobal('fetch', fetchMock);
  const decodeMock = vi.fn(decode);
  (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = class { decodeAudioData = decodeMock; };
  return { fetchMock, decodeMock };
}

afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext; });

describe('PR2 — son du rush dans le navigateur', () => {
  it('silences mesurés sur le MÊME buffer : un seul GET, un seul décodage ; énergie inchangée', async () => {
    const data = canal();
    const { fetchMock, decodeMock } = installer(async () => ({ sampleRate: SR, getChannelData: () => data }));
    const son = await sonDuRush('https://x/r.mp4', 5, 0.5);
    expect(fetchMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method !== 'HEAD').length).toBe(1);
    expect(decodeMock).toHaveBeenCalledTimes(1);
    expect(son.pisteAudio).toBe(true);
    expect(son.silences).toEqual([[0, 1], [3, 3.6]]);
    expect(son.sonContinu).toBe(false);
    expect(son.energie.length).toBe(10);
    expect(son.energie[0]).toBe(0);
    expect(son.energie[3]).toBeGreaterThan(0.4);
    // `energieAudio` (API d'avant) rend exactement la même énergie.
    installer(async () => ({ sampleRate: SR, getChannelData: () => data }));
    expect(await energieAudio('https://x/r.mp4', 5, 0.5)).toEqual(son.energie);
  });

  it('silences bornés à la durée analysée (panneau Qualité : 180 s au plus)', async () => {
    const data = canal();
    installer(async () => ({ sampleRate: SR, getChannelData: () => data }));
    const son = await sonDuRush('https://x/r.mp4', 2, 0.5);
    expect(son.silences).toEqual([[0, 1]]);
  });

  it('décodage impossible (pas de piste, codec) : énergie vide comme avant, `pisteAudio: null`, aucun silence', async () => {
    installer(async () => { throw new Error('EncodingError'); });
    expect(await sonDuRush('https://x/r.mp4', 5, 0.5)).toEqual({ energie: [], pisteAudio: null });
    installer(async () => { throw new Error('EncodingError'); });
    expect(await energieAudio('https://x/r.mp4', 5, 0.5)).toEqual([]);
  });
});
