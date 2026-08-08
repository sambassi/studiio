import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Le garde d'accès des routes, exercé POUR DE VRAI.
 *
 * ⚠️ GREPPER LE SOURCE NE SUFFIT PAS ICI, et une mutation l'a prouvé :
 * remplacer `if (!droit.autorise)` par `if (false)` laissait passer un test
 * qui se contentait de chercher `droitDePublier` et `status: 403` dans le
 * fichier — les deux chaînes restaient présentes ailleurs. Le seul test qui
 * distingue les deux versions APPELLE la route.
 *
 * Ce que ça protège : sans ce contrôle, n'importe quel compte ferait créer un
 * profil Zernio — que Studiio paie.
 */

interface Ligne { [k: string]: unknown }
const base: Record<string, Ligne[]> = { users: [], zernio_accounts: [], site_settings: [] };

function requete(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  const resultat = () => ({ data: base[table].filter((l) => filtres.every((f) => f(l))), error: null });
  const b: Record<string, unknown> = {
    eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return b; },
    order: () => b,
    limit: () => resultat(),
    select: () => b,
    then: (res: (v: unknown) => unknown) => Promise.resolve(resultat()).then(res),
  };
  return b;
}

let session: { user?: { id?: string; email?: string } } | null = null;

vi.mock('@/lib/auth/config', () => ({ auth: async () => session }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => ({
      select: () => requete(t),
      update: () => requete(t),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));
vi.mock('@/lib/admin', () => ({
  isAdmin: (email?: string | null) => email === 'contact.artboost@gmail.com',
  requireAdmin: async () => ({ error: null, session: null }),
  logAdminAction: () => {},
}));

const connectUrlAppels: string[] = [];
vi.mock('@/lib/social/zernio', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
  return {
    ...actual,
    zernioConfigured: () => true,
    createProfile: async (name: string) => ({ _id: `prof_${name}`, name }),
    findProfileByName: async () => null,
    getConnectUrl: async (p: string) => { connectUrlAppels.push(p); return `https://oauth.test/${p}`; },
  };
});

import { POST as connect } from '@/app/api/social/zernio/connect/route';

const USER = '11111111-1111-1111-1111-111111111111';

function requete_(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof connect>[0];
}

beforeEach(() => {
  connectUrlAppels.length = 0;
  base.users = [{ id: USER, zernio_profile_id: 'prof_x', publishing_enabled: false }];
  base.site_settings = [{ key: 'user_publishing_enabled', value: 'false' }];
  session = { user: { id: USER, email: 'user@test.fr' } };
  process.env.ZERNIO_API_KEY = 'sk_test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
});
afterEach(() => { delete process.env.ZERNIO_API_KEY; });

describe('POST /api/social/zernio/connect', () => {
  it('sans session : 401', async () => {
    session = null;
    const r = await connect(requete_({ platform: 'instagram' }));
    expect(r.status).toBe(401);
  });

  it('sans les deux drapeaux : 403, et AUCUN appel à Zernio', async () => {
    // ⚠️ LE SECOND POINT COMPTE AUTANT QUE LE PREMIER : un appel parti
    // malgre le refus creerait un profil facture.
    const r = await connect(requete_({ platform: 'instagram' }));
    expect(r.status).toBe(403);
    expect(connectUrlAppels).toEqual([]);
  });

  it('avec le seul interrupteur global : toujours 403', async () => {
    base.site_settings[0].value = 'true';
    const r = await connect(requete_({ platform: 'instagram' }));
    expect(r.status).toBe(403);
    expect(connectUrlAppels).toEqual([]);
  });

  it('avec les deux drapeaux : une URL d autorisation', async () => {
    base.site_settings[0].value = 'true';
    base.users[0].publishing_enabled = true;
    const r = await connect(requete_({ platform: 'instagram' }));
    expect(r.status).toBe(200);
    expect((await r.json()).authUrl).toContain('instagram');
    expect(connectUrlAppels).toEqual(['instagram']);
  });

  it('l administrateur passe sans les drapeaux', async () => {
    session = { user: { id: USER, email: 'contact.artboost@gmail.com' } };
    const r = await connect(requete_({ platform: 'youtube' }));
    expect(r.status).toBe(200);
  });

  it('une plateforme inconnue est refusée AVANT tout appel', async () => {
    base.site_settings[0].value = 'true';
    base.users[0].publishing_enabled = true;
    const r = await connect(requete_({ platform: 'myspace' }));
    expect(r.status).toBe(400);
    expect(connectUrlAppels).toEqual([]);
  });
});
