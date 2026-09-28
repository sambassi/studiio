import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Rafraichissement Meta : un jeton de PAGE ne doit jamais etre echange ni
 * ecrase.
 *
 * Le callback OAuth stocke le jeton de PAGE Facebook (celui qui publie sur la
 * Page ou le compte Instagram Business), avec un `expires_at` a +60 jours qui
 * est en realite celui du jeton utilisateur. Passe ce delai, l'ancien
 * `refreshMetaToken` envoyait ce jeton de page a `fb_exchange_token` et
 * ecrivait la reponse dans `access_token`. Tous les appels reseau et Supabase
 * sont mockes ici.
 */

const updates: Array<{ patch: Record<string, unknown>; id: unknown }> = [];
let accountRow: Record<string, unknown> | null = null;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: accountRow, error: accountRow ? null : { message: 'nf' } }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ patch, id });
          return { error: null };
        },
      }),
    }),
  },
}));

import { getValidToken } from '@/lib/social/token-refresh';

const fetchMock = vi.fn();

function reponse(json: unknown) {
  return { json: async () => json } as Response;
}

function compteExpire(platform: 'facebook' | 'instagram', token = 'PAGE_TOKEN') {
  return {
    id: 'acc-1',
    platform,
    account_id: platform === 'facebook' ? 'page-123' : 'ig-456',
    access_token: token,
    refresh_token: null,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

beforeEach(() => {
  updates.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.FACEBOOK_CLIENT_ID = 'app-id';
  process.env.FACEBOOK_CLIENT_SECRET = 'app-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshMetaToken — jeton de page', () => {
  for (const platform of ['facebook', 'instagram'] as const) {
    it(`${platform} : garde le jeton de page, n appelle jamais fb_exchange_token`, async () => {
      accountRow = compteExpire(platform);
      fetchMock.mockResolvedValueOnce(
        reponse({ data: { type: 'PAGE', is_valid: true, expires_at: 0, profile_id: 'page-123' } }),
      );

      const token = await getValidToken('acc-1');

      expect(token).toBe('PAGE_TOKEN');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('/debug_token?');
      expect(url).not.toContain('fb_exchange_token');

      expect(updates).toHaveLength(1);
      expect(updates[0].id).toBe('acc-1');
      expect(updates[0].patch).not.toHaveProperty('access_token');
      // expires_at: 0 = n'expire jamais -> null, plus de refresh inutile
      expect(updates[0].patch.expires_at).toBeNull();
    });
  }

  it('jeton de page avec expiration reelle : la reporte sans toucher au jeton', async () => {
    accountRow = compteExpire('facebook');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce(reponse({ data: { type: 'PAGE', is_valid: true, expires_at: exp } }));

    expect(await getValidToken('acc-1')).toBe('PAGE_TOKEN');
    expect(updates[0].patch).not.toHaveProperty('access_token');
    expect(updates[0].patch.expires_at).toBe(new Date(exp * 1000).toISOString());
  });

  it('jeton invalide : leve une erreur et n ecrit rien', async () => {
    accountRow = compteExpire('instagram');
    fetchMock.mockResolvedValueOnce(reponse({ data: { type: 'PAGE', is_valid: false } }));

    await expect(getValidToken('acc-1')).rejects.toThrow(/invalid/i);
    expect(updates).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('echec du diagnostic Meta : leve sans rien ecrire (les appelants gardent le jeton stocke)', async () => {
    accountRow = compteExpire('facebook');
    fetchMock.mockResolvedValueOnce(reponse({ error: { message: 'boom' } }));

    await expect(getValidToken('acc-1')).rejects.toThrow(/inspection failed/);
    expect(updates).toHaveLength(0);
  });
});

describe('refreshMetaToken — jeton utilisateur (flux documente)', () => {
  it('echange via fb_exchange_token et persiste le nouveau jeton', async () => {
    accountRow = compteExpire('facebook', 'USER_TOKEN');
    fetchMock
      .mockResolvedValueOnce(reponse({ data: { type: 'USER', is_valid: true, expires_at: 123 } }))
      .mockResolvedValueOnce(reponse({ access_token: 'NEW_USER_TOKEN', expires_in: 5184000 }));

    expect(await getValidToken('acc-1')).toBe('NEW_USER_TOKEN');
    expect(String(fetchMock.mock.calls[1][0])).toContain('grant_type=fb_exchange_token');
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.access_token).toBe('NEW_USER_TOKEN');
  });
});

describe('getValidToken — jeton non expire', () => {
  it('ne fait aucun appel reseau', async () => {
    accountRow = { ...compteExpire('facebook'), expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    expect(await getValidToken('acc-1')).toBe('PAGE_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
