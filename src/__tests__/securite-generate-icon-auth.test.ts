/**
 * `/api/content/generate-icon` appelait Anthropic sans aucune session : un
 * inconnu pouvait consommer notre clé à volonté. Invariant : sans session,
 * 401 AVANT la lecture du corps et avant tout appel au fournisseur.
 * Anthropic est doublé (fetch) — aucun appel réel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

const fetchEspion = vi.fn(async () =>
  new Response(JSON.stringify({ content: [{ type: 'text', text: 'Droplet' }] }), { status: 200 }),
);

beforeEach(() => {
  authMock.mockReset();
  fetchEspion.mockClear();
  vi.stubGlobal('fetch', fetchEspion);
  vi.stubEnv('ANTHROPIC_API_KEY', 'cle-de-test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function requete(corps: unknown = { prompt: 'eau' }) {
  return new NextRequest('http://localhost/api/content/generate-icon', {
    method: 'POST',
    body: JSON.stringify(corps),
    headers: { 'content-type': 'application/json' },
  });
}

describe('generate-icon — session obligatoire', () => {
  for (const session of [null, undefined, {}, { user: {} }, { user: { email: 'x@y.z' } }]) {
    it(`session ${JSON.stringify(session)} → 401, Anthropic jamais appelé`, async () => {
      authMock.mockResolvedValue(session);
      const { POST } = await import('@/app/api/content/generate-icon/route');
      const req = requete();
      const lecture = vi.spyOn(req, 'json');
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(fetchEspion).not.toHaveBeenCalled();
      expect(lecture).not.toHaveBeenCalled();
    });
  }

  it('session valide → la route appelle Anthropic (doublé) et renvoie une icône', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-1', email: 'a@b.c' } });
    const { POST } = await import('@/app/api/content/generate-icon/route');
    const res = await POST(requete());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ icon: 'Droplet' });
    expect(fetchEspion).toHaveBeenCalledTimes(1);
  });
});
