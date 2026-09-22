import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/creer/rush/keep — protéger un rush de brouillon.
 *
 * Ce que ces tests protègent : la route n'enregistre QUE des cibles de
 * stockage appartenant au compte connecté. Une URL d'un autre compte, un hôte
 * étranger, ou un namespace privé n'écrivent RIEN en base. Et la clé stockée
 * est bien la forme `<bucket>/<clé>` que le nettoyage compare.
 */

const authMock = vi.fn();

interface Upsert { payload: Record<string, unknown>; opts: unknown }
const upserts: Upsert[] = [];
let upsertError: unknown = null;

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, opts: unknown) => {
        if (table !== 'creer_draft_rushes') throw new Error(`table inattendue: ${table}`);
        upserts.push({ payload, opts });
        return Promise.resolve({ error: upsertError });
      },
    }),
  },
}));

// Origines de stockage : aucune configurée → seules les URL RELATIVES de
// relais public sont des cibles du compte. C'est suffisant et déterministe.
const { POST } = await import('@/app/api/creer/rush/keep/route');

const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  authMock.mockReset();
  upserts.length = 0;
  upsertError = null;
  authMock.mockResolvedValue({ user: { id: 'u1' } });
});

describe('Authentification', () => {
  it('sans session → 401, rien en base', async () => {
    authMock.mockResolvedValue(null);
    const r = await post({ url: '/storage/v1/object/public/media/u1/library/r.mp4' });
    expect(r.status).toBe(401);
    expect(upserts).toHaveLength(0);
  });
});

describe('Validation de la cible', () => {
  it('URL absente → 400', async () => {
    const r = await post({});
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('corps illisible → 400', async () => {
    const res = await POST({ json: async () => { throw new Error('x'); } } as never);
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("le rush d'un AUTRE compte → 400, rien en base", async () => {
    const r = await post({ url: '/storage/v1/object/public/media/u2/library/r.mp4' });
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('un hôte étranger (pexels) → 400', async () => {
    const r = await post({ url: 'https://images.pexels.com/photo.jpg' });
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('un namespace privé (analyse) → 400', async () => {
    const r = await post({ url: '/storage/v1/object/public/media/u1/analyse/a1/vignette-01.jpg' });
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('une traversée `..` → 400', async () => {
    const r = await post({ url: '/storage/v1/object/public/media/u1/../u2/library/r.mp4' });
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
});

describe('Enregistrement', () => {
  it("le rush DU compte → 200 et upsert de la clé `<bucket>/<clé>`", async () => {
    const r = await post({ url: '/storage/v1/object/public/media/u1/library/r.mp4' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload.user_id).toBe('u1');
    expect(upserts[0].payload.object_key).toBe('media/u1/library/r.mp4');
    expect(typeof upserts[0].payload.updated_at).toBe('string');
    // Upsert sur la clé composite : re-protéger réécrit `updated_at`.
    expect(upserts[0].opts).toMatchObject({ onConflict: 'user_id,object_key' });
  });

  it('une URL absolue vers un autre hôte que le compte reste refusée', async () => {
    // `//evil.com/...` déguisé en chemin relatif de protocole.
    const r = await post({ url: '//evil.com/storage/v1/object/public/media/u1/library/r.mp4' });
    expect(r.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('un échec base → 500, mais la validation a bien eu lieu', async () => {
    upsertError = { message: 'boom' };
    const r = await post({ url: '/storage/v1/object/public/media/u1/library/r.mp4' });
    expect(r.status).toBe(500);
    expect(upserts).toHaveLength(1);
  });
});
