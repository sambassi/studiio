import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AFFICHE À PARTIR D'UNE PHOTO (Autopilote, `genererAfficheReference`) —
 * le correctif « Racine A » (`wait: { mode: 'poll' }`) doit AUSSI s'appliquer
 * ici, pas seulement dans `/api/ai/image` (#425).
 *
 * On garde le VRAI SDK `replicate` 1.4.0 ; seul `fetch` est doublé. Le POST de
 * création rend une prédiction encore `processing` sans sortie (ce que l'API
 * rend quand `Prefer: wait` expire) ; les GET suivants rendent `succeeded`.
 * Sans `poll`, `run()` croit la prédiction finie et rend `null` → échec
 * « sans image exploitable ». Avec `poll`, l'affiche est générée et stockée.
 * Aucun appel réseau réel.
 */

const uploadToStorage = vi.fn(async (o: { storagePath: string }) => `https://studiio.test/storage/v1/object/public/media/${o.storagePath}`);
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorage: (o: { storagePath: string }) => uploadToStorage(o),
}));

import { genererAfficheReference } from '@/lib/ai/affiche-reference';

const MEDIA = 'https://replicate.delivery/xyz/affiche.webp';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const URLS = { get: 'https://api.replicate.com/v1/predictions/p1', cancel: 'https://api.replicate.com/v1/predictions/p1/cancel' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fetchDouble() {
  const appels: Array<{ method: string; url: string }> = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);
    const method = (init?.method || 'GET').toUpperCase();
    appels.push({ method, url: u });
    if (u.startsWith(MEDIA)) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    if (method === 'POST' && u.includes('/cancel')) return json({ id: 'p1', urls: URLS, status: 'canceled', output: null });
    if (method === 'POST' && u.includes('predictions')) return json({ id: 'p1', urls: URLS, status: 'processing', output: null });
    if (method === 'GET' && u.includes('/predictions/p1')) return json({ id: 'p1', urls: URLS, status: 'succeeded', output: MEDIA });
    return json({ detail: 'not found' }, 404);
  });
  return { f, appels };
}

const ARGS = {
  userId: '11111111-1111-4111-8111-111111111111',
  jobId: 'job-1',
  referenceUrl: 'https://studiio.test/storage/v1/object/public/media/u/photo.jpg',
  prompt: 'ambiance studio',
  aspectRatio: '9:16',
};

describe('genererAfficheReference — attente réelle de la fin du job Replicate', () => {
  const envAvant = process.env.REPLICATE_API_TOKEN;
  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'r8_test_factice';
    uploadToStorage.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (envAvant === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = envAvant;
  });

  it('job encore `processing` après la création → sonde, puis rapatrie l’image (pas « sans image exploitable »)', async () => {
    const { f, appels } = fetchDouble();
    vi.stubGlobal('fetch', f);

    const r = await genererAfficheReference(ARGS);

    expect(r).toEqual({ ok: true, url: expect.stringContaining('/autopilote-affiche/job-1.png') });
    // Au moins un GET de sondage de la prédiction : preuve du mode `poll`.
    expect(appels.some((a) => a.method === 'GET' && a.url.includes('/predictions/p1'))).toBe(true);
    expect(uploadToStorage).toHaveBeenCalledTimes(1);
  });
});
